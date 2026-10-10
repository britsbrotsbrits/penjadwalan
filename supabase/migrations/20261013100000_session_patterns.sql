-- Phase 14 (scheduler class-first): pola sesi per kelas, hari tryout, label item fleksibel.
--
-- Isi:
--   * session_pattern_items : pola sesi harian per scope (program / tipe kelas / rombel; yang terdekat
--                             menang sebagai satu kesatuan). Tiap baris = satu nomor sesi dengan jenis
--                             SUBTEST (ada mentor + ruangan) atau DRILLING (tidak ada mentor/ruangan).
--                             Contoh: Gap Year = sesi 1 SUBTEST, 2 DRILLING, 3 SUBTEST. Rombel SMA = satu
--                             baris SUBTEST (sesi 4 atau 5) -> sesi tetap, tidak berpindah antar hari.
--   * calendar_days.is_tryout : satu hari (mis. Sabtu) ditandai tryout; bukan hari belajar reguler.
--   * rombels.default_slot_no / default_days / cycle_weeks / cycle_anchor : sesi default per rombel
--                             (mis. SMA kelas 3 selalu sesi 4; kelas 2 selalu Selasa-Rabu-Jumat, satu minggu
--                             belajar tiap 3 minggu). Sesi default mengalahkan pola tipe kelas/program.
--   * teaching_sessions.display_label : tulisan di jadwal untuk item fleksibel (mis. "PK/PM").
--   * _schedule_violations: kode baru PATTERN_SLOT dan TRYOUT_DAY.
--
-- Keputusan yang dicatat:
--   * DRILLING dan TRYOUT TIDAK disimpan sebagai baris teaching_sessions. Keduanya ditampilkan dari
--     konfigurasi (pola + hari tryout), sehingga presensi dan payroll otomatis mengabaikannya.
--   * Rombel tanpa pola sesi tetap dijadwalkan dengan perilaku lama (tidak ada yang rusak).
--   * Aturan pola dijaga database: sesi di luar sesi SUBTEST pola menghasilkan PATTERN_SLOT.

alter table public.calendar_days add column is_tryout boolean not null default false;
create unique index calendar_days_one_tryout_key on public.calendar_days (is_tryout) where is_tryout;

alter table public.rombels
  add column default_slot_no smallint,
  add column default_days smallint[],
  add column cycle_weeks smallint not null default 1,
  add column cycle_anchor date;
alter table public.rombels
  add constraint rombels_default_slot_range check (default_slot_no is null or default_slot_no between 1 and 99),
  add constraint rombels_default_days_valid check (
    default_days is null
    or (cardinality(default_days) between 1 and 7 and default_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  add constraint rombels_cycle_weeks_range check (cycle_weeks between 1 and 12);

alter table public.teaching_sessions add column display_label text;
alter table public.teaching_sessions
  add constraint teaching_sessions_display_label_length
  check (display_label is null or char_length(btrim(display_label)) between 1 and 100);

-- Mengganti subtes sesi (edit manual) membuat tulisan fleksibel lama ("PK/PM") tidak berlaku lagi.
create function public.teaching_sessions_clear_stale_label()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subtest_id is distinct from old.subtest_id and new.display_label is not distinct from old.display_label then
    new.display_label := null;
  end if;
  return new;
end;
$$;

create trigger teaching_sessions_clear_stale_label
  before update of subtest_id on public.teaching_sessions
  for each row execute function public.teaching_sessions_clear_stale_label();

-- ---------------------------------------------------------------------------
-- session_pattern_items
-- ---------------------------------------------------------------------------

create table public.session_pattern_items (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null,
  scope_id uuid not null,
  slot_no smallint not null references public.session_slots (slot_no) on delete restrict,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint session_pattern_scope_type check (scope_type in ('program', 'class_type', 'rombel')),
  constraint session_pattern_kind check (kind in ('SUBTEST', 'DRILLING'))
);

create unique index session_pattern_unique_slot
  on public.session_pattern_items (scope_type, scope_id, slot_no);
create index session_pattern_scope_idx on public.session_pattern_items (scope_type, scope_id);

comment on table public.session_pattern_items is
  'Pola sesi harian. Scope terdekat yang punya baris menang (rombel > tipe kelas > program).';

alter table public.session_pattern_items enable row level security;
create policy session_pattern_select_admin
  on public.session_pattern_items for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.session_pattern_items from public, anon, authenticated;
grant select on table public.session_pattern_items to authenticated;
grant all on table public.session_pattern_items to service_role;

-- Pola yang berlaku untuk satu rombel: sesi default rombel (satu sesi SUBTEST) bila ada, selain itu
-- rombel > tipe kelas > program; kosong bila tidak ada.
create or replace function public._rombel_pattern(p_rombel_id uuid)
returns table (slot_no smallint, kind text)
language sql
stable
set search_path = ''
as $$
  select r.default_slot_no, 'SUBTEST'::text
    from public.rombels r
   where r.id = p_rombel_id and r.default_slot_no is not null
  union all
  select i.slot_no, i.kind
    from public.session_pattern_items i
   where not exists (select 1 from public.rombels r where r.id = p_rombel_id and r.default_slot_no is not null)
     and (i.scope_type, i.scope_id) = (
     select c.scope_type, c.scope_id
       from (
         select 1 as ord, 'rombel'::text as scope_type, r.id as scope_id
           from public.rombels r where r.id = p_rombel_id
         union all
         select 2, 'class_type', r.class_type_id
           from public.rombels r where r.id = p_rombel_id
         union all
         select 3, 'program', ct.program_id
           from public.rombels r join public.class_types ct on ct.id = r.class_type_id
          where r.id = p_rombel_id
       ) c
      where exists (
        select 1 from public.session_pattern_items x
         where x.scope_type = c.scope_type and x.scope_id = c.scope_id)
      order by c.ord
      limit 1
   );
$$;

revoke all on function public._rombel_pattern(uuid) from public, anon, authenticated;

-- p_items: [{slot_no, kind}] mengganti SELURUH pola pada scope itu secara atomik.
create or replace function public.set_session_pattern(p_scope_type text, p_scope_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  slot integer;
  subtests integer := 0;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah pola sesi' using errcode = '42501';
  end if;
  if p_scope_type is null or p_scope_type not in ('program', 'class_type', 'rombel')
     or p_scope_id is null
     or not coalesce(public._config_scope_exists(p_scope_type, p_scope_id), false) then
    raise exception 'scope pola sesi tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'PATTERN_ITEMS_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('session_pattern:' || p_scope_type || ':' || p_scope_id::text, 0));

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item -> 'slot_no') is distinct from 'number'
       or jsonb_typeof(item -> 'kind') is distinct from 'string'
       or (item ->> 'kind') not in ('SUBTEST', 'DRILLING') then
      raise exception 'PATTERN_ITEMS_INVALID' using errcode = '22023';
    end if;
    if (item ->> 'slot_no')::numeric <> trunc((item ->> 'slot_no')::numeric)
       or (item ->> 'slot_no')::numeric not between 1 and 99 then
      raise exception 'PATTERN_ITEMS_INVALID' using errcode = '22023';
    end if;
    slot := (item ->> 'slot_no')::integer;
    if not exists (select 1 from public.session_slots sl where sl.slot_no = slot) then
      raise exception 'PATTERN_SLOT_UNKNOWN:%', slot using errcode = 'P0002';
    end if;
    if item ->> 'kind' = 'SUBTEST' then subtests := subtests + 1; end if;
  end loop;
  if subtests = 0 then
    raise exception 'PATTERN_NEEDS_SUBTEST' using errcode = '22023';
  end if;

  delete from public.session_pattern_items where scope_type = p_scope_type and scope_id = p_scope_id;
  -- Slot ganda ditolak indeks unik session_pattern_unique_slot (23505).
  insert into public.session_pattern_items (scope_type, scope_id, slot_no, kind)
  select p_scope_type, p_scope_id, (x.value ->> 'slot_no')::smallint, x.value ->> 'kind'
    from jsonb_array_elements(p_items) as x(value);
end;
$$;

create or replace function public.clear_session_pattern(p_scope_type text, p_scope_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah pola sesi' using errcode = '42501';
  end if;
  delete from public.session_pattern_items where scope_type = p_scope_type and scope_id = p_scope_id;
end;
$$;

-- Sesi default satu rombel. NULL/kosong = tidak diatur (ikut pola induk dan semua hari belajar).
create or replace function public.set_rombel_defaults(
  p_rombel_id uuid,
  p_slot_no smallint,
  p_days smallint[],
  p_cycle_weeks smallint,
  p_cycle_anchor date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah sesi default rombel' using errcode = '42501';
  end if;
  if p_slot_no is not null and not exists (select 1 from public.session_slots sl where sl.slot_no = p_slot_no) then
    raise exception 'PATTERN_SLOT_UNKNOWN:%', p_slot_no using errcode = 'P0002';
  end if;
  if p_days is not null and cardinality(p_days) = 0 then
    p_days := null;
  end if;
  update public.rombels
     set default_slot_no = p_slot_no,
         default_days = (select array_agg(distinct d order by d) from unnest(p_days) as d),
         cycle_weeks = coalesce(p_cycle_weeks, 1),
         cycle_anchor = case when coalesce(p_cycle_weeks, 1) > 1 then p_cycle_anchor else null end
   where id = p_rombel_id;
  if not found then
    raise exception 'rombel tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

-- Hari tryout: p_day 1..7 menandai hari itu, NULL menghapus penandaan. Hari tryout tidak aktif sebagai hari belajar.
create or replace function public.set_tryout_day(p_day smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah hari tryout' using errcode = '42501';
  end if;
  if p_day is not null and p_day not between 1 and 7 then
    raise exception 'hari harus bernilai 1 (Senin) sampai 7 (Minggu)' using errcode = '22023';
  end if;
  update public.calendar_days set is_tryout = false where is_tryout;
  if p_day is not null then
    update public.calendar_days set is_tryout = true where day_of_week = p_day;
  end if;
end;
$$;

revoke all on function
  public.set_session_pattern(text, uuid, jsonb),
  public.clear_session_pattern(text, uuid),
  public.set_rombel_defaults(uuid, smallint, smallint[], smallint, date),
  public.set_tryout_day(smallint)
  from public, anon, authenticated;
grant execute on function
  public.set_session_pattern(text, uuid, jsonb),
  public.clear_session_pattern(text, uuid),
  public.set_rombel_defaults(uuid, smallint, smallint[], smallint, date),
  public.set_tryout_day(smallint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _schedule_violations: tambah PATTERN_SLOT dan TRYOUT_DAY (definisi lengkap menggantikan Phase 11)
-- ---------------------------------------------------------------------------

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
   where s.session_date < p.start_date or s.session_date > p.end_date
  union all
  -- Hari tryout bukan hari belajar reguler.
  select s.id, 'TRYOUT_DAY' from s
   where exists (select 1 from public.calendar_days d where d.day_of_week = s.dow and d.is_tryout)
  union all
  -- Rombel yang punya pola sesi hanya boleh belajar di sesi SUBTEST pada polanya (sesi tetap rombel).
  select s.id, 'PATTERN_SLOT' from s
   where exists (select 1 from public._rombel_pattern(s.rombel_id))
     and not exists (
       select 1 from public._rombel_pattern(s.rombel_id) pt
        where pt.slot_no = s.slot_no and pt.kind = 'SUBTEST')
  union all
  -- Rombel dengan hari default hanya boleh belajar pada hari-hari itu.
  select s.id, 'PATTERN_DAY' from s
    join public.rombels rb on rb.id = s.rombel_id
   where rb.default_days is not null and not (s.dow = any (rb.default_days));
$$;

revoke all on function public._schedule_violations(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_generated_schedule / save_additional_schedule: sama seperti sebelumnya, ditambah display_label
-- pada tiap sesi (opsional) untuk item fleksibel seperti "PK/PM".
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
    (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, display_label, source, run_id, created_by)
  select p_period_id, x.session_date, x.slot_no, x.rombel_id, x.subtest_id, x.tutor_id, x.room_id, nullif(btrim(x.display_label), ''),
         'GENERATED', run_id, auth.uid()
    from jsonb_to_recordset(p_sessions) as x(
      session_date date, slot_no smallint, rombel_id uuid, subtest_id uuid, tutor_id uuid, room_id uuid, display_label text);

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
    (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, display_label, source, run_id, created_by)
  select p_period_id, x.session_date, x.slot_no, x.rombel_id, x.subtest_id, x.tutor_id, x.room_id, nullif(btrim(x.display_label), ''),
         'ADDITIONAL', run_id, auth.uid()
    from jsonb_to_recordset(p_sessions) as x(
      session_date date, slot_no smallint, rombel_id uuid, subtest_id uuid, tutor_id uuid, room_id uuid, display_label text);

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
  public.save_generated_schedule(uuid, bigint, jsonb, jsonb, jsonb),
  public.save_additional_schedule(uuid, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.save_generated_schedule(uuid, bigint, jsonb, jsonb, jsonb),
  public.save_additional_schedule(uuid, bigint, jsonb, jsonb, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- my_schedule: ditambah display_label (tulisan fleksibel seperti "PK/PM"). Tipe kembalian berubah,
-- jadi fungsi dibuat ulang (hak akses sama seperti Phase 12).
-- ---------------------------------------------------------------------------

drop function public.my_schedule(date, date);

create function public.my_schedule(p_from date, p_to date)
returns table (
  session_date date,
  slot_no smallint,
  rombel_name text,
  subtest_code text,
  subtest_name text,
  room_name text,
  period_name text,
  display_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tid uuid := public.current_tutor_id();
begin
  if tid is null then
    raise exception 'hanya mentor aktif yang boleh melihat jadwal ini' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'rentang tanggal tidak valid' using errcode = '22023';
  end if;

  return query
  select ts.session_date, ts.slot_no, rb.name, st.code, st.name, rm.name, sp.name, ts.display_label
    from public.teaching_sessions ts
    join public.schedule_periods sp on sp.id = ts.period_id
    join public.rombels rb on rb.id = ts.rombel_id
    join public.subtests st on st.id = ts.subtest_id
    join public.rooms rm on rm.id = ts.room_id
   where ts.tutor_id = tid
     and ts.status = 'SCHEDULED'
     and sp.status in ('APPROVED', 'LOCKED')
     and ts.session_date between p_from and p_to
   order by ts.session_date, ts.slot_no;
end;
$$;

revoke all on function public.my_schedule(date, date) from public, anon, authenticated;
grant execute on function public.my_schedule(date, date) to authenticated, service_role;
