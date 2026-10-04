-- Phase 3: master data.
--
-- Isi migrasi ini:
--   * subtests       : master subtes (extensible, BUKAN enum)
--   * rooms          : master ruangan + kapasitas
--   * session_slots  : slot sesi harian (nomor, jam mulai, durasi), configurable
--   * calendar_days  : hari aktif (1 = Senin ... 7 = Minggu, ISO)
--   * set_active_days(): ubah hari aktif secara atomik
--
-- Keputusan keamanan (docs/phase-0/04-security-rls.md):
--   * Baca  : semua user AKTIF (admin dan tutor). User nonaktif / anon tidak melihat apa pun.
--   * Tulis : hanya admin. Tutor tidak punya hak tulis sama sekali.
--   * Tidak ada DELETE (tidak ada grant): nonaktifkan lewat is_active. Tabel ini akan
--     direferensikan jadwal/attendance/payroll, jadi histori tidak boleh hilang.
--   * Grant kolom dibatasi: id dan created_at tidak bisa diubah dari client.
--
-- Data awal (7 subtes, 15 ruangan, 8 slot) ada di supabase/seed/001_master_data.sql,
-- BUKAN di migrasi ini: itu data yang boleh diubah admin, bukan struktur.
--
-- Belum ada di fase ini (sengaja): audit log perubahan (Phase 17), validasi "ruangan dipakai
-- jadwal" (Phase 6 dan 10), special session dan period (Phase 7 dan 10), aturan break (TBD-02).

-- ---------------------------------------------------------------------------
-- subtests
-- ---------------------------------------------------------------------------

create table public.subtests (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subtests_code_key unique (code),
  constraint subtests_code_format check (code ~ '^[A-Z0-9_]{1,20}$'),
  constraint subtests_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint subtests_sort_order_range check (sort_order between 0 and 9999)
);

create unique index subtests_name_lower_key on public.subtests (lower(btrim(name)));

comment on table public.subtests is
  'Master subtes. Extensible: admin dapat menambah/mengubah/menonaktifkan. Dirujuk lewat id, bukan string bebas.';

create trigger subtests_set_updated_at
  before update on public.subtests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  capacity integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint rooms_capacity_range check (capacity between 1 and 500)
);

create unique index rooms_name_lower_key on public.rooms (lower(btrim(name)));

comment on table public.rooms is
  'Master ruangan. Kapasitas adalah HARD CONSTRAINT scheduler (capacity >= jumlah siswa rombel).';

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_slots
-- ---------------------------------------------------------------------------

create table public.session_slots (
  id uuid primary key default gen_random_uuid(),
  slot_no smallint not null,
  start_time time(0) not null,
  duration_minutes smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_slots_slot_no_key unique (slot_no),
  constraint session_slots_slot_no_range check (slot_no between 1 and 99),
  constraint session_slots_duration_range check (duration_minutes between 15 and 480),
  constraint session_slots_start_whole_minute check (extract(second from start_time) = 0),
  -- Slot harus selesai di hari yang sama (tidak melewati tengah malam).
  constraint session_slots_ends_same_day check (
    extract(hour from start_time)::int * 60
      + extract(minute from start_time)::int
      + duration_minutes <= 1440
  ),
  -- Slot AKTIF tidak boleh tumpang tindih. Rentang setengah terbuka [mulai, selesai),
  -- jadi 07:00-08:30 dan 08:30-10:00 boleh bersebelahan (tidak ada aturan break; TBD-02).
  constraint session_slots_no_overlap exclude using gist (
    int4range(
      extract(hour from start_time)::int * 60 + extract(minute from start_time)::int,
      extract(hour from start_time)::int * 60 + extract(minute from start_time)::int
        + duration_minutes
    ) with &&
  ) where (is_active)
);

comment on table public.session_slots is
  'Slot sesi harian (configurable). Jumlah sesi per hari = jumlah slot aktif. Jam selesai = mulai + durasi.';

create trigger session_slots_set_updated_at
  before update on public.session_slots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- calendar_days (struktur tetap 7 baris; admin hanya mengubah is_active)
-- ---------------------------------------------------------------------------

create table public.calendar_days (
  day_of_week smallint primary key,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint calendar_days_day_range check (day_of_week between 1 and 7)
);

comment on table public.calendar_days is
  'Hari aktif penjadwalan. day_of_week ISO: 1 = Senin ... 7 = Minggu. Default aktif Senin-Sabtu.';

insert into public.calendar_days (day_of_week, is_active) values
  (1, true), (2, true), (3, true), (4, true), (5, true), (6, true), (7, false);

create trigger calendar_days_set_updated_at
  before update on public.calendar_days
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- set_active_days: ubah hari aktif secara atomik.
-- SECURITY INVOKER: berjalan dengan hak pemanggil, jadi RLS dan grant tetap berlaku.
-- Non-admin tidak mengubah apa pun; fungsi menolaknya secara eksplisit (bukan no-op diam-diam).
-- ---------------------------------------------------------------------------

create function public.set_active_days(p_days smallint[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_days is null or cardinality(p_days) = 0 then
    raise exception 'minimal satu hari aktif diperlukan' using errcode = '23514';
  end if;

  if exists (select 1 from unnest(p_days) as d where d is null or d not between 1 and 7) then
    raise exception 'hari harus bernilai 1 (Senin) sampai 7 (Minggu)' using errcode = '22023';
  end if;

  update public.calendar_days set is_active = (day_of_week = any (p_days));
  get diagnostics affected = row_count;

  if affected <> 7 then
    raise exception 'tidak diizinkan mengubah hari aktif' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.subtests enable row level security;
alter table public.rooms enable row level security;
alter table public.session_slots enable row level security;
alter table public.calendar_days enable row level security;

-- subtests
create policy subtests_select_active_users
  on public.subtests for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy subtests_insert_admin
  on public.subtests for insert to authenticated
  with check ((select public.is_admin()));
create policy subtests_update_admin
  on public.subtests for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- rooms
create policy rooms_select_active_users
  on public.rooms for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy rooms_insert_admin
  on public.rooms for insert to authenticated
  with check ((select public.is_admin()));
create policy rooms_update_admin
  on public.rooms for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- session_slots
create policy session_slots_select_active_users
  on public.session_slots for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy session_slots_insert_admin
  on public.session_slots for insert to authenticated
  with check ((select public.is_admin()));
create policy session_slots_update_admin
  on public.session_slots for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- calendar_days (tanpa INSERT/DELETE: struktur tetap 7 baris)
create policy calendar_days_select_active_users
  on public.calendar_days for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy calendar_days_update_admin
  on public.calendar_days for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants (least privilege)
-- ---------------------------------------------------------------------------

revoke all on table public.subtests, public.rooms, public.session_slots, public.calendar_days
  from public, anon, authenticated;

grant select on table public.subtests, public.rooms, public.session_slots, public.calendar_days
  to authenticated;

grant insert (code, name, sort_order, is_active) on table public.subtests to authenticated;
grant update (code, name, sort_order, is_active) on table public.subtests to authenticated;

grant insert (name, capacity, is_active) on table public.rooms to authenticated;
grant update (name, capacity, is_active) on table public.rooms to authenticated;

grant insert (slot_no, start_time, duration_minutes, is_active) on table public.session_slots to authenticated;
grant update (slot_no, start_time, duration_minutes, is_active) on table public.session_slots to authenticated;

grant update (is_active) on table public.calendar_days to authenticated;

grant all on table public.subtests, public.rooms, public.session_slots, public.calendar_days
  to service_role;

revoke all on function public.set_active_days(smallint[]) from public, anon, authenticated;
grant execute on function public.set_active_days(smallint[]) to authenticated, service_role;
