-- Phase 4: struktur akademik.
--
-- Hierarki (master prompt bagian 4 dan 5):  Program -> Tipe Kelas (template) -> Rombel (instance) -> Siswa
--
-- Isi migrasi ini:
--   * programs, class_types, rombels, students
--   * student_rombel_history : riwayat penempatan/pemindahan siswa (diisi trigger, tidak bisa diubah user)
--   * rombel_student_counts  : view jumlah siswa per rombel (security_invoker, ikut RLS)
--   * move_student()         : satu-satunya jalur memindahkan siswa (alasan opsional, riwayat otomatis)
--
-- Keputusan (docs/phase-0):
--   * Nama rombel adalah DATA (Junior A, B, ...), bukan kode. Tidak ada enum / hardcode.
--   * Baca  : programs dan class_types untuk semua user aktif. rombels, students, riwayat HANYA admin
--             (DEC-07: tutor tidak melihat data siswa). Akses tutor ke rombel yang diajarnya
--             ditambahkan di Phase 12, saat tabel sesi mengajar sudah ada.
--   * Tulis : hanya admin. Tidak ada DELETE (tidak ada grant): nonaktifkan lewat is_active,
--             supaya histori jadwal/attendance/payroll tetap utuh.
--   * Immutable setelah dibuat: class_types.program_id dan rombels.class_type_id (tidak ada grant UPDATE).
--   * students.rombel_id TIDAK bisa di-UPDATE langsung; hanya lewat move_student() sehingga
--     SETIAP perpindahan pasti tercatat di riwayat.
--   * Ukuran standar tipe kelas (default_size) BUKAN batas keras: jumlah siswa yang melebihinya
--     hanya diberi peringatan di UI. Aturan itu belum ditetapkan, jadi tidak diblokir.
--
-- Belum ada di fase ini (sengaja): default sesi/hari per tipe kelas (Phase 7), fixed room rombel (Phase 6),
-- kebutuhan akademik/subtes per siswa (Phase 7), audit log umum (Phase 17).

-- ---------------------------------------------------------------------------
-- programs
-- ---------------------------------------------------------------------------

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint programs_sort_order_range check (sort_order between 0 and 9999)
);

create unique index programs_name_lower_key on public.programs (lower(btrim(name)));

comment on table public.programs is 'Program pendidikan (mis. Gap Year). Level teratas hierarki akademik.';

create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- class_types
-- ---------------------------------------------------------------------------

create table public.class_types (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete restrict,
  name text not null,
  default_size integer not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_types_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint class_types_default_size_range check (default_size between 1 and 500),
  constraint class_types_sort_order_range check (sort_order between 0 and 9999)
);

create unique index class_types_program_name_key on public.class_types (program_id, lower(btrim(name)));
create index class_types_program_id_idx on public.class_types (program_id);

comment on table public.class_types is
  'Tipe kelas = TEMPLATE (mis. Junior, ukuran standar 20). Rombel adalah instance nyatanya. default_size = ukuran standar, bukan batas keras.';

create trigger class_types_set_updated_at
  before update on public.class_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- rombels
-- ---------------------------------------------------------------------------

create table public.rombels (
  id uuid primary key default gen_random_uuid(),
  class_type_id uuid not null references public.class_types (id) on delete restrict,
  name text not null,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rombels_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint rombels_dates_order check (start_date is null or end_date is null or end_date >= start_date)
);

create unique index rombels_class_type_name_key on public.rombels (class_type_id, lower(btrim(name)));
create index rombels_class_type_id_idx on public.rombels (class_type_id);

comment on table public.rombels is
  'Rombel = instance nyata dari tipe kelas (Junior A, Junior B, ...). Dibuat admin tanpa coding.';

create trigger rombels_set_updated_at
  before update on public.rombels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

create sequence public.student_code_seq;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  -- Identifier internal. Kosongkan saat input untuk dibuat otomatis (SIS000001, ...); boleh diisi manual.
  -- Catatan: nomor otomatis bisa melompat (bagian dari cara kerja sequence), itu normal.
  student_code text not null default ('SIS' || lpad(nextval('public.student_code_seq')::text, 6, '0')),
  full_name text not null,
  rombel_id uuid not null references public.rombels (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_student_code_key unique (student_code),
  constraint students_student_code_format check (student_code ~ '^[A-Z0-9._-]{1,30}$'),
  constraint students_full_name_length check (char_length(btrim(full_name)) between 1 and 200)
);

alter sequence public.student_code_seq owned by public.students.student_code;

create index students_rombel_id_idx on public.students (rombel_id);
create index students_active_name_idx on public.students (is_active, lower(full_name));

comment on table public.students is
  'Siswa (tanpa login). Program dan tipe kelas diturunkan dari rombel. Soft delete lewat is_active.';

create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- student_rombel_history
-- ---------------------------------------------------------------------------

create table public.student_rombel_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  from_rombel_id uuid references public.rombels (id) on delete restrict,
  to_rombel_id uuid not null references public.rombels (id) on delete restrict,
  changed_by uuid references auth.users (id) on delete set null,
  reason text,
  changed_at timestamptz not null default now(),
  constraint student_rombel_history_reason_length check (reason is null or char_length(reason) <= 500)
);

create index student_rombel_history_student_idx on public.student_rombel_history (student_id, changed_at desc);

comment on table public.student_rombel_history is
  'Riwayat penempatan siswa. from_rombel_id NULL = penempatan awal. Hanya diisi trigger; tidak bisa diubah/dihapus user.';

-- ---------------------------------------------------------------------------
-- Trigger siswa: validasi rombel tujuan + pencatatan riwayat
-- ---------------------------------------------------------------------------

-- Siswa hanya boleh ditempatkan/dipindah ke rombel yang ADA dan AKTIF.
-- (Tidak dicek saat hanya mengubah nama / status, jadi siswa di rombel yang kemudian dinonaktifkan tetap bisa diedit.)
create function public.students_check_target_rombel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.rombel_id is distinct from old.rombel_id then
    if not exists (
      select 1 from public.rombels r where r.id = new.rombel_id and r.is_active
    ) then
      raise exception 'students_target_rombel_active: rombel tujuan tidak ada atau tidak aktif'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger students_check_target_rombel
  before insert or update of rombel_id on public.students
  for each row execute function public.students_check_target_rombel();

create function public.students_record_rombel_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  move_reason text;
begin
  if tg_op = 'UPDATE' and new.rombel_id is not distinct from old.rombel_id then
    return null;
  end if;

  -- Alasan hanya relevan untuk perpindahan; diteruskan move_student() lewat setting transaksi.
  if tg_op = 'UPDATE' then
    move_reason := nullif(btrim(coalesce(current_setting('app.move_reason', true), '')), '');
  end if;

  insert into public.student_rombel_history (student_id, from_rombel_id, to_rombel_id, changed_by, reason)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.rombel_id else null end,
    new.rombel_id,
    auth.uid(),
    left(move_reason, 500)
  );
  return null;
end;
$$;

create trigger students_record_rombel_history
  after insert or update of rombel_id on public.students
  for each row execute function public.students_record_rombel_history();

-- ---------------------------------------------------------------------------
-- move_student: satu-satunya jalur memindahkan siswa.
-- SECURITY DEFINER karena kolom rombel_id sengaja tidak di-grant UPDATE ke user;
-- hak admin diperiksa eksplisit di dalam fungsi.
-- ---------------------------------------------------------------------------

create function public.move_student(
  p_student_id uuid,
  p_to_rombel_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_rombel uuid;
begin
  if not public.is_admin() then
    raise exception 'hanya admin yang boleh memindahkan siswa' using errcode = '42501';
  end if;

  if p_reason is not null and char_length(btrim(p_reason)) > 500 then
    raise exception 'alasan maksimal 500 karakter' using errcode = '22023';
  end if;

  select s.rombel_id into current_rombel
  from public.students s
  where s.id = p_student_id
  for update;

  if not found then
    raise exception 'siswa tidak ditemukan' using errcode = 'P0002';
  end if;

  if current_rombel = p_to_rombel_id then
    raise exception 'students_same_rombel: siswa sudah berada di rombel tersebut' using errcode = '23514';
  end if;

  perform set_config('app.move_reason', coalesce(btrim(p_reason), ''), true);
  update public.students set rombel_id = p_to_rombel_id where id = p_student_id;
  perform set_config('app.move_reason', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- View jumlah siswa per rombel. security_invoker = true: RLS tabel students tetap berlaku
-- (tutor tidak mendapat angka apa pun). Rombel tanpa siswa tidak muncul (dianggap 0 oleh aplikasi).
-- ---------------------------------------------------------------------------

create view public.rombel_student_counts
with (security_invoker = true) as
select
  s.rombel_id,
  (count(*) filter (where s.is_active))::int as active_students,
  count(*)::int as total_students
from public.students s
group by s.rombel_id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.programs enable row level security;
alter table public.class_types enable row level security;
alter table public.rombels enable row level security;
alter table public.students enable row level security;
alter table public.student_rombel_history enable row level security;

-- programs, class_types: dibaca semua user aktif, ditulis admin
create policy programs_select_active_users
  on public.programs for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy programs_insert_admin
  on public.programs for insert to authenticated
  with check ((select public.is_admin()));
create policy programs_update_admin
  on public.programs for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy class_types_select_active_users
  on public.class_types for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy class_types_insert_admin
  on public.class_types for insert to authenticated
  with check ((select public.is_admin()));
create policy class_types_update_admin
  on public.class_types for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- rombels, students: hanya admin
create policy rombels_select_admin
  on public.rombels for select to authenticated
  using ((select public.is_admin()));
create policy rombels_insert_admin
  on public.rombels for insert to authenticated
  with check ((select public.is_admin()));
create policy rombels_update_admin
  on public.rombels for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy students_select_admin
  on public.students for select to authenticated
  using ((select public.is_admin()));
create policy students_insert_admin
  on public.students for insert to authenticated
  with check ((select public.is_admin()));
create policy students_update_admin
  on public.students for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- riwayat: admin hanya membaca (insert lewat trigger SECURITY DEFINER)
create policy student_rombel_history_select_admin
  on public.student_rombel_history for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants (least privilege)
-- ---------------------------------------------------------------------------

revoke all on table
  public.programs, public.class_types, public.rombels, public.students,
  public.student_rombel_history, public.rombel_student_counts
  from public, anon, authenticated;

grant select on table
  public.programs, public.class_types, public.rombels, public.students,
  public.student_rombel_history, public.rombel_student_counts
  to authenticated;

grant insert (name, sort_order, is_active) on table public.programs to authenticated;
grant update (name, sort_order, is_active) on table public.programs to authenticated;

grant insert (program_id, name, default_size, sort_order, is_active) on table public.class_types to authenticated;
grant update (name, default_size, sort_order, is_active) on table public.class_types to authenticated;

grant insert (class_type_id, name, start_date, end_date, is_active) on table public.rombels to authenticated;
grant update (name, start_date, end_date, is_active) on table public.rombels to authenticated;

grant insert (student_code, full_name, rombel_id, is_active) on table public.students to authenticated;
grant update (student_code, full_name, is_active) on table public.students to authenticated;

grant all on table
  public.programs, public.class_types, public.rombels, public.students,
  public.student_rombel_history, public.rombel_student_counts
  to service_role;

revoke all on sequence public.student_code_seq from public, anon, authenticated;
grant usage on sequence public.student_code_seq to authenticated, service_role;

revoke all on function public.students_check_target_rombel() from public, anon, authenticated;
revoke all on function public.students_record_rombel_history() from public, anon, authenticated;

revoke all on function public.move_student(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.move_student(uuid, uuid, text) to authenticated, service_role;
