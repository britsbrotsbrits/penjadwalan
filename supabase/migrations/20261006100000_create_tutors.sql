-- Phase 5: tutor (mentor), kompetensi, dan availability.
--
-- Prasyarat: migrasi Phase 2 (profiles), Phase 3 (subtests, session_slots).
--
-- Keputusan desain (lihat juga README):
--   * Setiap profile ber-role 'tutor' otomatis punya SATU baris tutor_profiles (trigger + backfill),
--     jadi admin tidak perlu membuat baris tutor secara manual.
--   * tutor_profiles.is_active ("dapat dijadwalkan") default FALSE: tutor baru tidak masuk penjadwalan
--     sebelum admin memeriksa level dan rate. Ini terpisah dari profiles.is_active (boleh login).
--   * level = peringkat seniority bilangan bulat 0..99 (lebih tinggi = lebih senior). Arti dan bobotnya
--     adalah konfigurasi (Phase 7); skema ini tidak menentukan nama level. Seniority BUKAN hard constraint.
--   * rate_per_session dalam Rupiah (bilangan bulat); NULL = belum diisi (tidak dikarang).
--   * Availability mingguan berulang (hari ISO 1..7 x nomor sesi). Kolom period_id dari rancangan awal
--     SENGAJA belum ada karena tabel schedule_periods baru dibuat nanti; ditambahkan lewat migrasi
--     tersendiri (kolom nullable) saat periode dibangun.
--   * Kompetensi dan availability ditulis HANYA lewat fungsi (atomik, validasi, cek hak akses),
--     bukan INSERT/UPDATE/DELETE langsung. Tidak ada DELETE untuk siapa pun.

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------

create table public.tutor_profiles (
  id uuid primary key default gen_random_uuid(),
  -- CASCADE aman: data jadwal/payroll kelak mereferensikan tutor_profiles.id dengan RESTRICT,
  -- jadi akun yang sudah punya riwayat tidak bisa terhapus diam-diam.
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  level smallint not null default 0,
  rate_per_session integer,
  is_active boolean not null default false,
  availability_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tutor_profiles_level_range check (level between 0 and 99),
  constraint tutor_profiles_rate_range check (rate_per_session is null or rate_per_session between 0 and 100000000)
);

create trigger tutor_profiles_set_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_updated_at();

create table public.tutor_competencies (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  subtest_id uuid not null references public.subtests (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tutor_id, subtest_id)
);

create index tutor_competencies_subtest_idx on public.tutor_competencies (subtest_id);

create table public.tutor_availability (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  day_of_week smallint not null,
  slot_no smallint not null,
  available boolean not null,
  primary key (tutor_id, day_of_week, slot_no),
  constraint tutor_availability_day_range check (day_of_week between 1 and 7),
  constraint tutor_availability_slot_range check (slot_no between 1 and 99)
);

-- ---------------------------------------------------------------------------
-- Baris tutor_profiles otomatis untuk setiap profile ber-role tutor
-- ---------------------------------------------------------------------------

create function public.profiles_ensure_tutor_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'tutor' then
    insert into public.tutor_profiles (profile_id)
    values (new.id)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_ensure_tutor_profile
  after insert or update of role on public.profiles
  for each row execute function public.profiles_ensure_tutor_profile();

-- Backfill: tutor yang sudah ada sebelum migrasi ini.
insert into public.tutor_profiles (profile_id)
select p.id from public.profiles p where p.role = 'tutor'
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Helper RLS: id tutor_profiles milik user saat ini (NULL bila bukan tutor aktif)
-- ---------------------------------------------------------------------------

create function public.current_tutor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tp.id
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.profile_id
  where tp.profile_id = (select auth.uid())
    and p.is_active
    and p.role = 'tutor'
$$;

-- ---------------------------------------------------------------------------
-- Fungsi tulis (SECURITY DEFINER, cek hak akses eksplisit)
-- ---------------------------------------------------------------------------

-- Mengganti SELURUH availability seorang tutor dalam satu transaksi.
-- Boleh dipanggil admin (untuk tutor mana pun) atau tutor aktif untuk dirinya sendiri.
-- p_cells: array JSON [{"day":1,"slot_no":1,"available":true}, ...]
create function public.set_tutor_availability(p_tutor_id uuid, p_cells jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cell jsonb;
  d integer;
  s integer;
  seen text[] := array[]::text[];
  cell_key text;
begin
  -- coalesce: current_tutor_id() bisa NULL (bukan tutor aktif); tanpa ini kondisi menjadi NULL dan
  -- IF tidak menolak (logika tiga nilai).
  if not coalesce(public.is_admin() or p_tutor_id = public.current_tutor_id(), false) then
    raise exception 'tidak berhak mengubah availability tutor ini' using errcode = '42501';
  end if;

  if p_cells is null or jsonb_typeof(p_cells) <> 'array' then
    raise exception 'cells harus berupa array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cells) > 693 then
    raise exception 'terlalu banyak sel availability' using errcode = '22023';
  end if;

  perform 1 from public.tutor_profiles tp where tp.id = p_tutor_id for update;
  if not found then
    raise exception 'tutor tidak ditemukan' using errcode = 'P0002';
  end if;

  for cell in select value from jsonb_array_elements(p_cells) loop
    -- "is distinct from": kunci yang hilang memberi NULL, dan NULL <> 'number' tidak akan menolak.
    if jsonb_typeof(cell) is distinct from 'object'
       or jsonb_typeof(cell -> 'day') is distinct from 'number'
       or jsonb_typeof(cell -> 'slot_no') is distinct from 'number'
       or jsonb_typeof(cell -> 'available') is distinct from 'boolean' then
      raise exception 'bentuk sel availability tidak valid' using errcode = '22023';
    end if;
    if (cell ->> 'day')::numeric <> trunc((cell ->> 'day')::numeric)
       or (cell ->> 'slot_no')::numeric <> trunc((cell ->> 'slot_no')::numeric) then
      raise exception 'hari dan nomor sesi harus bilangan bulat' using errcode = '22023';
    end if;
    d := (cell ->> 'day')::numeric::integer;
    s := (cell ->> 'slot_no')::numeric::integer;
    if d not between 1 and 7 or s not between 1 and 99 then
      raise exception 'hari harus 1..7 dan nomor sesi 1..99' using errcode = '22023';
    end if;
    cell_key := d::text || '-' || s::text;
    if cell_key = any (seen) then
      raise exception 'sel availability ganda: hari % sesi %', d, s using errcode = '22023';
    end if;
    seen := seen || cell_key;
  end loop;

  delete from public.tutor_availability where tutor_id = p_tutor_id;

  insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
  select p_tutor_id, (c ->> 'day')::numeric::integer, (c ->> 'slot_no')::numeric::integer, (c ->> 'available')::boolean
  from jsonb_array_elements(p_cells) as c;

  update public.tutor_profiles set availability_updated_at = now() where id = p_tutor_id;
end;
$$;

-- Mengganti seluruh kompetensi seorang tutor. Hanya admin.
create function public.set_tutor_competencies(p_tutor_id uuid, p_subtest_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'hanya admin yang boleh mengubah kompetensi' using errcode = '42501';
  end if;

  if p_subtest_ids is null or cardinality(p_subtest_ids) > 100
     or array_position(p_subtest_ids, null) is not null then
    raise exception 'daftar subtes tidak valid' using errcode = '22023';
  end if;

  perform 1 from public.tutor_profiles tp where tp.id = p_tutor_id for update;
  if not found then
    raise exception 'tutor tidak ditemukan' using errcode = 'P0002';
  end if;

  delete from public.tutor_competencies where tutor_id = p_tutor_id;

  -- Subtes yang tidak ada ditolak oleh foreign key (23503) dan seluruh perubahan dibatalkan.
  insert into public.tutor_competencies (tutor_id, subtest_id)
  select distinct p_tutor_id, x from unnest(p_subtest_ids) as x;
end;
$$;

-- Mengubah data seorang tutor di DUA tabel sekaligus (profiles + tutor_profiles) dalam satu transaksi,
-- supaya tidak pernah tersimpan setengah. Hanya admin, dan hanya untuk akun ber-role tutor
-- (role tidak bisa diubah lewat fungsi ini).
create function public.admin_update_tutor(
  p_tutor_id uuid,
  p_full_name text,
  p_account_active boolean,
  p_level smallint,
  p_rate integer,
  p_schedulable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'hanya admin yang boleh mengubah data tutor' using errcode = '42501';
  end if;

  if p_full_name is null or p_account_active is null or p_level is null or p_schedulable is null then
    raise exception 'data tutor tidak lengkap' using errcode = '22023';
  end if;

  select tp.profile_id, p.role into v_profile_id, v_role
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.profile_id
  where tp.id = p_tutor_id
  for update of tp, p;

  if not found then
    raise exception 'tutor tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_role <> 'tutor' then
    raise exception 'akun ini bukan tutor' using errcode = '22023';
  end if;

  -- Pelanggaran constraint (nama > 200, level, rate) membatalkan kedua update.
  update public.profiles
  set full_name = btrim(p_full_name), is_active = p_account_active
  where id = v_profile_id;

  update public.tutor_profiles
  set level = p_level, rate_per_session = p_rate, is_active = p_schedulable
  where id = p_tutor_id;
end;
$$;

-- Email akun (ada di auth.users, tidak terbaca oleh role authenticated) agar admin bisa
-- membedakan akun tutor yang namanya masih kosong. Hanya admin.
create function public.admin_profile_emails(p_ids uuid[])
returns table (id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'hanya admin yang boleh melihat email akun' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) > 500 then
    raise exception 'daftar id tidak valid' using errcode = '22023';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u
    where u.id = any (p_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tutor_profiles enable row level security;
alter table public.tutor_competencies enable row level security;
alter table public.tutor_availability enable row level security;

-- tutor_profiles: admin membaca semua; tutor aktif hanya barisnya sendiri (termasuk rate sendiri).
create policy tutor_profiles_select_admin
  on public.tutor_profiles for select to authenticated
  using ((select public.is_admin()));
create policy tutor_profiles_select_own
  on public.tutor_profiles for select to authenticated
  using (id = (select public.current_tutor_id()));
-- Ubah: hanya admin. Tidak ada policy INSERT (baris dibuat trigger) dan DELETE.
create policy tutor_profiles_update_admin
  on public.tutor_profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- tutor_competencies, tutor_availability: baca saja. Tulis lewat fungsi di atas.
create policy tutor_competencies_select_admin
  on public.tutor_competencies for select to authenticated
  using ((select public.is_admin()));
create policy tutor_competencies_select_own
  on public.tutor_competencies for select to authenticated
  using (tutor_id = (select public.current_tutor_id()));

create policy tutor_availability_select_admin
  on public.tutor_availability for select to authenticated
  using ((select public.is_admin()));
create policy tutor_availability_select_own
  on public.tutor_availability for select to authenticated
  using (tutor_id = (select public.current_tutor_id()));

-- ---------------------------------------------------------------------------
-- Grants (least privilege; default privilege Supabase terlalu longgar)
-- ---------------------------------------------------------------------------

revoke all on table
  public.tutor_profiles, public.tutor_competencies, public.tutor_availability
  from public, anon, authenticated;

grant select on table
  public.tutor_profiles, public.tutor_competencies, public.tutor_availability
  to authenticated;

-- Hanya kolom ini yang bisa diubah (RLS membatasi ke admin). profile_id dan
-- availability_updated_at sengaja tidak termasuk.
grant update (level, rate_per_session, is_active) on table public.tutor_profiles to authenticated;

grant all on table
  public.tutor_profiles, public.tutor_competencies, public.tutor_availability
  to service_role;

revoke all on function public.profiles_ensure_tutor_profile() from public, anon, authenticated;

revoke all on function public.current_tutor_id() from public, anon, authenticated;
grant execute on function public.current_tutor_id() to authenticated, service_role;

revoke all on function public.set_tutor_availability(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_tutor_availability(uuid, jsonb) to authenticated, service_role;

revoke all on function public.set_tutor_competencies(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_tutor_competencies(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.admin_profile_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_profile_emails(uuid[]) to authenticated, service_role;

revoke all on function public.admin_update_tutor(uuid, text, boolean, smallint, integer, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_tutor(uuid, text, boolean, smallint, integer, boolean) to authenticated, service_role;
