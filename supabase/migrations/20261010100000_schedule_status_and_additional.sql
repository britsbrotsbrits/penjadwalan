-- Phase 11: alur status jadwal + Generate Additional.
--
-- Isi:
--   * set_period_status(): transisi status dikontrol di database (tabel transisi di bawah).
--   * save_additional_schedule(): Generate Additional; HANYA menambah sesi, tidak pernah mengubah,
--     memindahkan, atau menghapus sesi yang sudah ada.
--   * _schedule_violations() bisa dibatasi ke satu run (hanya sesi tambahan yang diperiksa).
--
-- Keputusan yang dicatat:
--   * Transisi: GENERATED -> APPROVED, APPROVED -> GENERATED (tarik persetujuan), APPROVED -> LOCKED,
--     DRAFT/GENERATED/APPROVED -> CANCELLED. LOCKED dan CANCELLED final (tidak bisa dibuka lagi).
--     DRAFT -> GENERATED hanya terjadi lewat Generate Jadwal, bukan lewat set_period_status.
--   * Approve ditolak bila belum ada sesi atau masih ada pelanggaran aturan. Kebutuhan yang belum
--     terjadwal TIDAK menghalangi approve (itulah gunanya Generate Additional).
--   * CANCELLED membatalkan semua sesi periode (membebaskan slot dan tanggalnya) dan tidak bisa dibatalkan.
--   * Generate Additional diizinkan pada GENERATED dan APPROVED, ditolak pada DRAFT/LOCKED/CANCELLED.
--     Status periode tidak berubah. Sesi tambahan bertanda source = 'ADDITIONAL'. Pada periode APPROVED
--     sesi tetap tidak bisa diedit (tarik persetujuan dulu bila perlu).
--   * TODO Phase 17: audit log perubahan status.

alter table public.scheduling_runs drop constraint scheduling_runs_mode;
alter table public.scheduling_runs add constraint scheduling_runs_mode check (mode in ('full', 'additional'));
alter table public.teaching_sessions drop constraint teaching_sessions_source;
alter table public.teaching_sessions
  add constraint teaching_sessions_source check (source in ('GENERATED', 'MANUAL', 'ADDITIONAL'));

-- Pemeriksaan per sesi, kini dengan filter run opsional.
create or replace function public._schedule_violations(p_period_id uuid, p_session_id uuid, p_run_id uuid)
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
       and ((p_run_id is not null and ts.run_id = p_run_id)
         or (p_run_id is null and p_session_id is not null and ts.id = p_session_id)
         or (p_run_id is null and p_session_id is null and ts.period_id = p_period_id))
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

revoke all on function public._schedule_violations(uuid, uuid, uuid) from public, anon, authenticated;

-- Versi 2 argumen (dipakai Phase 10) menjadi pembungkus tipis.
create or replace function public._schedule_violations(p_period_id uuid, p_session_id uuid)
returns table (session_id uuid, code text)
language sql
stable
set search_path = ''
as $$
  select v.session_id, v.code from public._schedule_violations(p_period_id, p_session_id, null) v;
$$;

-- ---------------------------------------------------------------------------
-- set_period_status
-- ---------------------------------------------------------------------------

create or replace function public.set_period_status(p_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  per public.schedule_periods;
  allowed boolean;
  n_sessions integer;
  n_violations integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah status jadwal' using errcode = '42501';
  end if;
  if p_to is null or p_to not in ('GENERATED', 'APPROVED', 'LOCKED', 'CANCELLED') then
    raise exception 'status tujuan tidak valid' using errcode = '22023';
  end if;

  select * into per from public.schedule_periods where id = p_id for update;
  if not found then
    raise exception 'periode jadwal tidak ditemukan' using errcode = 'P0002';
  end if;

  allowed := (per.status = 'GENERATED' and p_to = 'APPROVED')
          or (per.status = 'APPROVED' and p_to = 'GENERATED')
          or (per.status = 'APPROVED' and p_to = 'LOCKED')
          or (per.status in ('DRAFT', 'GENERATED', 'APPROVED') and p_to = 'CANCELLED');
  if not allowed then
    raise exception 'SCHED_BAD_TRANSITION:%:%', per.status, p_to using errcode = '55000';
  end if;

  if p_to = 'APPROVED' then
    select count(*) into n_sessions
      from public.teaching_sessions where period_id = p_id and status = 'SCHEDULED';
    if n_sessions = 0 then
      raise exception 'SCHED_APPROVE_EMPTY' using errcode = 'P0001';
    end if;
    select count(*) into n_violations from public._schedule_violations(p_id, null, null);
    if n_violations > 0 then
      raise exception 'SCHED_APPROVE_VIOLATIONS:%', n_violations using errcode = 'P0001';
    end if;
  end if;

  if p_to = 'CANCELLED' then
    update public.teaching_sessions set status = 'CANCELLED'
     where period_id = p_id and status = 'SCHEDULED';
  end if;

  update public.schedule_periods set status = p_to where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_additional_schedule: Generate Additional (hanya menambah)
-- p_sessions / p_unscheduled berformat sama dengan save_generated_schedule.
-- ---------------------------------------------------------------------------

create or replace function public.save_additional_schedule(
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
  per public.schedule_periods;
  run_id uuid;
  bad text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh generate jadwal' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_typeof(p_unscheduled) is distinct from 'array' then
    raise exception 'format data jadwal tidak valid' using errcode = '22023';
  end if;

  select * into per from public.schedule_periods where id = p_period_id for update;
  if not found then
    raise exception 'periode jadwal tidak ditemukan' using errcode = 'P0002';
  end if;
  if per.status not in ('GENERATED', 'APPROVED') then
    raise exception 'SCHED_ADDITIONAL_NOT_ALLOWED:%', per.status using errcode = '55000';
  end if;

  insert into public.scheduling_runs (period_id, mode, seed, summary, created_by)
  values (p_period_id, 'additional', p_seed, coalesce(p_summary, '{}'::jsonb), auth.uid())
  returning id into run_id;

  insert into public.teaching_sessions
    (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source, run_id, created_by)
  select p_period_id, x.session_date, x.slot_no, x.rombel_id, x.subtest_id, x.tutor_id, x.room_id,
         'ADDITIONAL', run_id, auth.uid()
    from jsonb_to_recordset(p_sessions) as x(
      session_date date, slot_no smallint, rombel_id uuid, subtest_id uuid, tutor_id uuid, room_id uuid);

  -- Hanya sesi tambahan yang diperiksa; pelanggaran lama (bila ada) tidak menghalangi.
  select string_agg(distinct v.code, ',' order by v.code) into bad
    from public._schedule_violations(null, null, run_id) v;
  if bad is not null then
    raise exception 'SCHED_VIOLATION:%', bad using errcode = 'P0001';
  end if;

  insert into public.unscheduled_requirements
    (run_id, period_id, rombel_id, label, subtest_ids, missing_per_week, reason_code, detail)
  select run_id, p_period_id, u.rombel_id, u.label, coalesce(u.subtest_ids, '{}'), u.missing_per_week,
         u.reason_code, u.detail
    from jsonb_to_recordset(p_unscheduled) as u(
      rombel_id uuid, label text, subtest_ids uuid[], missing_per_week integer, reason_code text, detail text);

  return run_id;
end;
$$;

revoke all on function
  public.set_period_status(uuid, text),
  public.save_additional_schedule(uuid, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.set_period_status(uuid, text),
  public.save_additional_schedule(uuid, bigint, jsonb, jsonb, jsonb)
  to authenticated, service_role;
