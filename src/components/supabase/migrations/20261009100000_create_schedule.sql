-- Phase 10: jadwal bertanggal (DEC-01: sesi bertanggal per periode jadwal).
--
-- Isi:
--   * schedule_periods     : rentang tanggal + status (DRAFT/GENERATED/APPROVED/LOCKED/CANCELLED).
--   * scheduling_runs      : catatan tiap kali Generate Jadwal dijalankan (seed + ringkasan).
--   * teaching_sessions    : satu baris = satu pertemuan (tanggal, sesi, subtes, tutor, ruangan, rombel).
--   * unscheduled_requirements : kebutuhan yang belum terpenuhi pada run, lengkap dengan alasan.
--   * RPC: create/update_schedule_period, save_generated_schedule, create/update/cancel_teaching_session,
--          schedule_violations (laporan validasi sisi database).
--
-- Keputusan yang dicatat:
--   * Satu sesi = SATU rombel (kolom rombel_id). Sesi gabungan (TBD-01) belum dimodelkan.
--   * Tabel hanya bisa ditulis lewat RPC (admin dicek di database). Tidak ada grant tulis langsung.
--   * Pertahanan terakhir: indeks unik mencegah tutor/ruangan/rombel dobel pada tanggal+sesi yang sama.
--     Aturan lain (kapasitas, kompetensi, availability, ruangan tetap, data nonaktif) dicek oleh
--     _schedule_violations() setiap kali sesi dibuat/diubah.
--   * Periode APPROVED/LOCKED/CANCELLED tidak bisa diubah lewat RPC mana pun di sini.
--     Perpindahan status selain DRAFT -> GENERATED dibangun di Phase 11.
--   * Batas panjang periode 92 hari adalah pagar keamanan (ukuran payload), bukan aturan bisnis.
--   * TODO Phase 17: audit log perubahan jadwal. Belum ada mekanisme override pelanggaran.

-- ---------------------------------------------------------------------------
-- schedule_periods
-- ---------------------------------------------------------------------------

create table public.schedule_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'DRAFT',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_periods_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint schedule_periods_dates_order check (end_date >= start_date),
  constraint schedule_periods_max_length check (end_date - start_date <= 91),
  constraint schedule_periods_status check (status in ('DRAFT', 'GENERATED', 'APPROVED', 'LOCKED', 'CANCELLED')),
  -- Periode yang tidak dibatalkan tidak boleh tumpang tindih (jadwal global per tanggal).
  constraint schedule_periods_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'CANCELLED')
);

create unique index schedule_periods_name_lower_key on public.schedule_periods (lower(btrim(name)));

create trigger schedule_periods_set_updated_at
  before update on public.schedule_periods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- scheduling_runs
-- ---------------------------------------------------------------------------

create table public.scheduling_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.schedule_periods (id) on delete restrict,
  mode text not null default 'full',
  seed bigint not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint scheduling_runs_mode check (mode in ('full')),
  constraint scheduling_runs_seed_range check (seed between 0 and 4294967295)
);

create index scheduling_runs_period_idx on public.scheduling_runs (period_id, created_at desc);

-- ---------------------------------------------------------------------------
-- teaching_sessions
-- ---------------------------------------------------------------------------

create table public.teaching_sessions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.schedule_periods (id) on delete restrict,
  session_date date not null,
  slot_no smallint not null references public.session_slots (slot_no) on delete restrict,
  rombel_id uuid not null references public.rombels (id) on delete restrict,
  subtest_id uuid not null references public.subtests (id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles (id) on delete restrict,
  room_id uuid not null references public.rooms (id) on delete restrict,
  status text not null default 'SCHEDULED',
  source text not null default 'GENERATED',
  run_id uuid references public.scheduling_runs (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teaching_sessions_status check (status in ('SCHEDULED', 'CANCELLED')),
  constraint teaching_sessions_source check (source in ('GENERATED', 'MANUAL'))
);

-- Tidak ada dobel pada tanggal + sesi yang sama (hanya sesi SCHEDULED; yang dibatalkan membebaskan slot).
create unique index teaching_sessions_tutor_slot_key
  on public.teaching_sessions (tutor_id, session_date, slot_no) where status = 'SCHEDULED';
create unique index teaching_sessions_room_slot_key
  on public.teaching_sessions (room_id, session_date, slot_no) where status = 'SCHEDULED';
create unique index teaching_sessions_rombel_slot_key
  on public.teaching_sessions (rombel_id, session_date, slot_no) where status = 'SCHEDULED';

create index teaching_sessions_period_idx on public.teaching_sessions (period_id, session_date, slot_no);
create index teaching_sessions_run_idx on public.teaching_sessions (run_id) where run_id is not null;
create index teaching_sessions_subtest_idx on public.teaching_sessions (subtest_id);

create trigger teaching_sessions_set_updated_at
  before update on public.teaching_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- unscheduled_requirements (pola mingguan: kekurangan PER MINGGU)
-- ---------------------------------------------------------------------------

create table public.unscheduled_requirements (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scheduling_runs (id) on delete cascade,
  period_id uuid not null references public.schedule_periods (id) on delete restrict,
  rombel_id uuid not null references public.rombels (id) on delete restrict,
  label text not null,
  subtest_ids uuid[] not null default '{}',
  missing_per_week integer not null,
  reason_code text not null,
  detail text,
  constraint unscheduled_missing_range check (missing_per_week between 1 and 999),
  constraint unscheduled_reason_code check (reason_code in (
    'NO_COMPETENT_TUTOR', 'NO_AVAILABLE_TUTOR_SLOT', 'NO_ROMBEL_SLOT', 'NO_ROOM_CAPACITY',
    'NO_FREE_ROOM', 'FIXED_ROOM_BUSY', 'COMBINED_RULE_VIOLATION', 'DISTRIBUTION_MISMATCH',
    'SCHEDULER_NOT_AVAILABLE'
  ))
);

create index unscheduled_requirements_run_idx on public.unscheduled_requirements (run_id);
create index unscheduled_requirements_rombel_idx on public.unscheduled_requirements (rombel_id);

-- ---------------------------------------------------------------------------
-- RLS dan hak: baca admin saja; tulis hanya lewat RPC (security definer)
-- ---------------------------------------------------------------------------

alter table public.schedule_periods enable row level security;
alter table public.scheduling_runs enable row level security;
alter table public.teaching_sessions enable row level security;
alter table public.unscheduled_requirements enable row level security;

create policy schedule_periods_select_admin on public.schedule_periods
  for select to authenticated using ((select public.is_admin()));
create policy scheduling_runs_select_admin on public.scheduling_runs
  for select to authenticated using ((select public.is_admin()));
create policy teaching_sessions_select_admin on public.teaching_sessions
  for select to authenticated using ((select public.is_admin()));
create policy unscheduled_requirements_select_admin on public.unscheduled_requirements
  for select to authenticated using ((select public.is_admin()));

revoke all on table public.schedule_periods, public.scheduling_runs, public.teaching_sessions,
  public.unscheduled_requirements from public, anon, authenticated;
grant select on table public.schedule_periods, public.scheduling_runs, public.teaching_sessions,
  public.unscheduled_requirements to authenticated;
grant all on table public.schedule_periods, public.scheduling_runs, public.teaching_sessions,
  public.unscheduled_requirements to service_role;

-- ---------------------------------------------------------------------------
-- _schedule_violations: pemeriksaan aturan per sesi (set-based). Internal.
-- Mengembalikan (session_id, code) untuk sesi SCHEDULED:
--   p_session_id terisi -> hanya sesi itu; selain itu seluruh periode p_period_id.
-- ---------------------------------------------------------------------------

create or replace function public._schedule_violations(p_period_id uuid, p_session_id uuid)
returns table (session_id uuid, code text)
language sql
stable
set search_path = ''
as $$
  with s as (
    select ts.id, ts.period_id, ts.session_date, ts.slot_no, ts.rombel_id, ts.subtest_id,
           ts.tutor_id, ts.room_id,
           extract(isodow from ts.session_date)::smallint as dow
      from public.teaching_sessions ts
     where ts.status = 'SCHEDULED'
       and ((p_session_id is not null and ts.id = p_session_id)
         or (p_session_id is null and ts.period_id = p_period_id))
  )
  -- Kapasitas: siswa aktif aktual; bila belum ada siswa, ukuran standar tipe kelas (DEC-02).
  select s.id, 'CAPACITY'::text
    from s
    join public.rooms r on r.id = s.room_id
    join public.rombels rb on rb.id = s.rombel_id
    join public.class_types ct on ct.id = rb.class_type_id
   where r.capacity < (
     case
       when (select count(*) from public.students st where st.rombel_id = s.rombel_id and st.is_active) > 0
         then (select count(*) from public.students st where st.rombel_id = s.rombel_id and st.is_active)
       else ct.default_size
     end
   )
  union all
  select s.id, 'COMPETENCY' from s
   where not exists (
     select 1 from public.tutor_competencies c where c.tutor_id = s.tutor_id and c.subtest_id = s.subtest_id)
  union all
  select s.id, 'AVAILABILITY' from s
   where not exists (
     select 1 from public.tutor_availability a
      where a.tutor_id = s.tutor_id and a.day_of_week = s.dow and a.slot_no = s.slot_no and a.available)
  union all
  select s.id, 'FIXED_ROOM' from s
    join public.rombels rb on rb.id = s.rombel_id
   where rb.fixed_room_id is not null and rb.fixed_room_id <> s.room_id
  union all
  select s.id, 'INACTIVE_TUTOR' from s
    join public.tutor_profiles t on t.id = s.tutor_id where not t.is_active
  union all
  select s.id, 'INACTIVE_ROOM' from s
    join public.rooms r on r.id = s.room_id where not r.is_active
  union all
  select s.id, 'INACTIVE_ROMBEL' from s
    join public.rombels rb on rb.id = s.rombel_id where not rb.is_active
  union all
  select s.id, 'INACTIVE_SUBTEST' from s
    join public.subtests st on st.id = s.subtest_id where not st.is_active
  union all
  select s.id, 'DAY_INACTIVE' from s
   where not exists (select 1 from public.calendar_days d where d.day_of_week = s.dow and d.is_active)
  union all
  select s.id, 'SLOT_INACTIVE' from s
   where not exists (select 1 from public.session_slots sl where sl.slot_no = s.slot_no and sl.is_active)
  union all
  select s.id, 'OUT_OF_PERIOD' from s
    join public.schedule_periods p on p.id = s.period_id
   where s.session_date < p.start_date or s.session_date > p.end_date;
$$;

revoke all on function public._schedule_violations(uuid, uuid) from public, anon, authenticated;

-- Laporan untuk admin (seluruh periode).
create or replace function public.schedule_violations(p_period_id uuid)
returns table (session_id uuid, code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh melihat validasi jadwal' using errcode = '42501';
  end if;
  return query select v.session_id, v.code from public._schedule_violations(p_period_id, null) v;
end;
$$;

-- Dipakai RPC tulis: lempar error bila sesi ini melanggar aturan. Token dibaca aplikasi (mapDbError).
create or replace function public._assert_session_valid(p_session_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  codes text;
begin
  select string_agg(distinct v.code, ',' order by v.code) into codes
    from public._schedule_violations(null, p_session_id) v;
  if codes is not null then
    raise exception 'SCHED_VIOLATION:%', codes using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public._assert_session_valid(uuid) from public, anon, authenticated;

-- Periode harus ada dan masih bisa diedit (DRAFT/GENERATED). Mengunci barisnya selama transaksi.
create or replace function public._lock_editable_period(p_period_id uuid)
returns public.schedule_periods
language plpgsql
set search_path = ''
as $$
declare
  per public.schedule_periods;
begin
  select * into per from public.schedule_periods where id = p_period_id for update;
  if not found then
    raise exception 'periode jadwal tidak ditemukan' using errcode = 'P0002';
  end if;
  if per.status not in ('DRAFT', 'GENERATED') then
    raise exception 'SCHED_NOT_EDITABLE:%', per.status using errcode = '55000';
  end if;
  return per;
end;
$$;

revoke all on function public._lock_editable_period(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_schedule_period / update_schedule_period
-- ---------------------------------------------------------------------------

create or replace function public.create_schedule_period(p_name text, p_start date, p_end date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh membuat periode jadwal' using errcode = '42501';
  end if;
  insert into public.schedule_periods (name, start_date, end_date, created_by)
  values (p_name, p_start, p_end, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Nama boleh diubah selama periode masih bisa diedit. Tanggal hanya bila tidak ada sesi
-- SCHEDULED di luar rentang baru.
create or replace function public.update_schedule_period(p_id uuid, p_name text, p_start date, p_end date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah periode jadwal' using errcode = '42501';
  end if;
  perform public._lock_editable_period(p_id);

  if exists (
    select 1 from public.teaching_sessions ts
     where ts.period_id = p_id and ts.status = 'SCHEDULED'
       and (ts.session_date < p_start or ts.session_date > p_end)
  ) then
    raise exception 'SCHED_SESSIONS_OUTSIDE_RANGE' using errcode = 'P0001';
  end if;

  update public.schedule_periods
     set name = p_name, start_date = p_start, end_date = p_end
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_generated_schedule: ganti SELURUH jadwal periode dengan hasil Generate Jadwal (full).
-- p_sessions: [{session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id}]
-- p_unscheduled: [{rombel_id, label, subtest_ids[], missing_per_week, reason_code, detail?}]
-- Atomik: bila ada sesi melanggar aturan, seluruh penyimpanan dibatalkan dan jadwal lama utuh.
-- ---------------------------------------------------------------------------

create or replace function public.save_generated_schedule(
  p_period_id uuid,
  p_seed bigint,
  p_summary jsonb,
  p_sessions jsonb,
  p_unscheduled jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  bad text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh generate jadwal' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_typeof(p_unscheduled) is distinct from 'array' then
    raise exception 'format data jadwal tidak valid' using errcode = '22023';
  end if;

  perform public._lock_editable_period(p_period_id);

  -- Generate full menggantikan semua sesi periode ini (termasuk hasil edit manual).
  delete from public.teaching_sessions where period_id = p_period_id;

  insert into public.scheduling_runs (period_id, mode, seed, summary, created_by)
  values (p_period_id, 'full', p_seed, coalesce(p_summary, '{}'::jsonb), auth.uid())
  returning id into run_id;

  insert into public.teaching_sessions
    (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source, run_id, created_by)
  select p_period_id, x.session_date, x.slot_no, x.rombel_id, x.subtest_id, x.tutor_id, x.room_id,
         'GENERATED', run_id, auth.uid()
    from jsonb_to_recordset(p_sessions) as x(
      session_date date, slot_no smallint, rombel_id uuid, subtest_id uuid, tutor_id uuid, room_id uuid);

  select string_agg(distinct v.code, ',' order by v.code) into bad
    from public._schedule_violations(p_period_id, null) v;
  if bad is not null then
    raise exception 'SCHED_VIOLATION:%', bad using errcode = 'P0001';
  end if;

  insert into public.unscheduled_requirements
    (run_id, period_id, rombel_id, label, subtest_ids, missing_per_week, reason_code, detail)
  select run_id, p_period_id, u.rombel_id, u.label, coalesce(u.subtest_ids, '{}'), u.missing_per_week,
         u.reason_code, u.detail
    from jsonb_to_recordset(p_unscheduled) as u(
      rombel_id uuid, label text, subtest_ids uuid[], missing_per_week integer, reason_code text, detail text);

  update public.schedule_periods set status = 'GENERATED' where id = p_period_id;
  return run_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Penyesuaian manual: create / update / cancel (selalu melewati validasi)
-- ---------------------------------------------------------------------------

create or replace function public.create_teaching_session(
  p_period_id uuid,
  p_session_date date,
  p_slot_no smallint,
  p_rombel_id uuid,
  p_subtest_id uuid,
  p_tutor_id uuid,
  p_room_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah jadwal' using errcode = '42501';
  end if;
  perform public._lock_editable_period(p_period_id);

  insert into public.teaching_sessions
    (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source, created_by)
  values (p_period_id, p_session_date, p_slot_no, p_rombel_id, p_subtest_id, p_tutor_id, p_room_id, 'MANUAL', auth.uid())
  returning id into new_id;

  perform public._assert_session_valid(new_id);
  return new_id;
end;
$$;

-- Memindahkan / mengganti tutor, ruangan, subtes, tanggal, atau sesi. Rombel tidak berubah
-- (ganti rombel = batalkan lalu buat sesi baru).
create or replace function public.update_teaching_session(
  p_id uuid,
  p_session_date date,
  p_slot_no smallint,
  p_subtest_id uuid,
  p_tutor_id uuid,
  p_room_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah jadwal' using errcode = '42501';
  end if;

  select period_id into per_id from public.teaching_sessions where id = p_id and status = 'SCHEDULED';
  if not found then
    raise exception 'sesi tidak ditemukan atau sudah dibatalkan' using errcode = 'P0002';
  end if;
  perform public._lock_editable_period(per_id);

  update public.teaching_sessions
     set session_date = p_session_date, slot_no = p_slot_no, subtest_id = p_subtest_id,
         tutor_id = p_tutor_id, room_id = p_room_id, source = 'MANUAL'
   where id = p_id;

  perform public._assert_session_valid(p_id);
end;
$$;

create or replace function public.cancel_teaching_session(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah jadwal' using errcode = '42501';
  end if;

  select period_id into per_id from public.teaching_sessions where id = p_id and status = 'SCHEDULED';
  if not found then
    raise exception 'sesi tidak ditemukan atau sudah dibatalkan' using errcode = 'P0002';
  end if;
  perform public._lock_editable_period(per_id);

  update public.teaching_sessions set status = 'CANCELLED', source = 'MANUAL' where id = p_id;
end;
$$;

revoke all on function
  public.schedule_violations(uuid),
  public.create_schedule_period(text, date, date),
  public.update_schedule_period(uuid, text, date, date),
  public.save_generated_schedule(uuid, bigint, jsonb, jsonb, jsonb),
  public.create_teaching_session(uuid, date, smallint, uuid, uuid, uuid, uuid),
  public.update_teaching_session(uuid, date, smallint, uuid, uuid, uuid),
  public.cancel_teaching_session(uuid)
  from public, anon, authenticated;

grant execute on function
  public.schedule_violations(uuid),
  public.create_schedule_period(text, date, date),
  public.update_schedule_period(uuid, text, date, date),
  public.save_generated_schedule(uuid, bigint, jsonb, jsonb, jsonb),
  public.create_teaching_session(uuid, date, smallint, uuid, uuid, uuid, uuid),
  public.update_teaching_session(uuid, date, smallint, uuid, uuid, uuid),
  public.cancel_teaching_session(uuid)
  to authenticated, service_role;
