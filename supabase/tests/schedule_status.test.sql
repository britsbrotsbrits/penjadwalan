-- Tes alur status jadwal dan Generate Additional (Phase 11): set_period_status, tabel transisi,
-- syarat approve, cancel membebaskan slot, proteksi, save_additional_schedule (hanya menambah), hak akses.
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat psql
-- sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai data "Uji" sendiri.
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
--
-- Syarat: migrasi Phase 2-7, 9100000 (create_schedule), dan 10100000 (status + additional) sudah dijalankan. Slot sesi 1 dan 2 harus
-- aktif (bila tabel slot kosong, tes membuatnya sendiri). Hari Senin-Sabtu aktif, Minggu nonaktif.
-- Jika SQL Editor memperingatkan "tanpa RLS" atau "destructive", pilih "Run without RLS".

begin;

create function public._t_expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      return;
    end if;
    raise exception 'diharapkan SQLSTATE %, tetapi terjadi % (%): %', p_state, sqlstate, sqlerrm, p_sql;
  end;
  raise exception 'diharapkan error SQLSTATE % tetapi perintah BERHASIL: %', p_state, p_sql;
end $$;

-- Seperti _t_expect_error, dan pesan error harus memuat potongan teks tertentu.
create function public._t_expect_msg(p_sql text, p_state text, p_fragment text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state and sqlerrm like '%' || p_fragment || '%' then
      return;
    end if;
    raise exception 'diharapkan SQLSTATE % dengan pesan memuat "%", tetapi terjadi % (%): %',
      p_state, p_fragment, sqlstate, sqlerrm, p_sql;
  end;
  raise exception 'diharapkan error SQLSTATE % tetapi perintah BERHASIL: %', p_state, p_sql;
end $$;

create function public._t_rowcount(p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixture ----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'st-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'st-tutor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', 'st-tutor2@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set role = 'tutor', is_active = true where id in
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');
update public.tutor_profiles set is_active = true;

insert into public.session_slots (slot_no, start_time, duration_minutes)
select v.n, v.t::time, 90 from (values (1, '07:00'), (2, '08:30')) as v(n, t)
where not exists (select 1 from public.session_slots);
do $$ begin
  assert (select count(*) from public.session_slots where slot_no in (1, 2) and is_active) = 2,
    'syarat tes: slot sesi 1 dan 2 harus aktif';
  assert (select is_active from public.calendar_days where day_of_week = 1), 'syarat tes: Senin aktif';
  assert not (select is_active from public.calendar_days where day_of_week = 7), 'syarat tes: Minggu nonaktif';
end $$;

insert into public.subtests (code, name) values ('UJ_T1', 'Subtes Status 1'), ('UJ_T2', 'Subtes Status 2');
insert into public.rooms (name, capacity) values ('Uji Status A', 10), ('Uji Status B', 2), ('Uji Status C', 10);
insert into public.programs (name) values ('Program Uji Status');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji Status', 10 from public.programs where name = 'Program Uji Status';
insert into public.rombels (class_type_id, name)
  select ct.id, v.name from public.class_types ct, (values ('ST 1'), ('ST 2'), ('ST 3')) as v(name)
  where ct.name = 'Tipe Uji Status';
update public.rombels set fixed_room_id = (select id from public.rooms where name = 'Uji Status C') where name = 'ST 3';
insert into public.students (full_name, rombel_id)
  select 'Siswa ST ' || g, (select id from public.rombels where name = 'ST 1') from generate_series(1, 3) g;

-- Tutor 1 (d2): kompeten S1; tersedia Senin sesi 1-2 dan Selasa sesi 1.
-- Tutor 2 (d3): kompeten S1 dan S2; tersedia Senin sesi 1 saja.
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000f2' and s.code = 'UJ_T1';
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000f3' and s.code in ('UJ_T1', 'UJ_T2');
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, v.d, v.n, true from public.tutor_profiles tp, (values (1, 1), (1, 2), (2, 1)) as v(d, n)
 where tp.profile_id = '00000000-0000-0000-0000-0000000000f2';
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, 1, 1, true from public.tutor_profiles tp
 where tp.profile_id = '00000000-0000-0000-0000-0000000000f3';

-- Pembantu: id berdasarkan nama.
create function public._t_id(p_kind text, p_name text) returns uuid
language plpgsql as $$
declare r uuid;
begin
  if p_kind = 'room' then select id into r from public.rooms where name = p_name;
  elsif p_kind = 'rombel' then select id into r from public.rombels where name = p_name;
  elsif p_kind = 'subtest' then select id into r from public.subtests where code = p_name;
  elsif p_kind = 'tutor' then select id into r from public.tutor_profiles where profile_id = p_name::uuid;
  elsif p_kind = 'period' then select id into r from public.schedule_periods where name = p_name;
  end if;
  return r;
end $$;


-- Pembantu: baris sesi sebagai jsonb terurut (untuk membuktikan sesi lama tidak berubah).
create function public._t_rows(p_period uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.teaching_sessions t where t.period_id = p_period
$$;

create function public._t_admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
end $$;

-- ---------------------------------------------------------------- 1. tabel transisi (semua 25 pasangan)
do $$
declare
  p uuid;
  f text; t text; ok_expected boolean; got boolean;
  statuses text[] := array['DRAFT', 'GENERATED', 'APPROVED', 'LOCKED', 'CANCELLED'];
  n integer := 0;
begin
  perform public._t_admin();
  p := (select public.create_schedule_period('Uji Transisi', date '2026-11-02', date '2026-11-15'));
  foreach f in array statuses loop
    foreach t in array statuses loop
      reset role;
      update public.teaching_sessions set status = 'CANCELLED' where period_id = p;
      delete from public.teaching_sessions where period_id = p;
      insert into public.teaching_sessions (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source)
        values (p, date '2026-11-02', 1, public._t_id('rombel', 'ST 1'), public._t_id('subtest', 'UJ_T1'),
                public._t_id('tutor', '00000000-0000-0000-0000-0000000000f2'), public._t_id('room', 'Uji Status A'), 'MANUAL');
      update public.schedule_periods set status = f where id = p;
      set local role authenticated;
      ok_expected := (f = 'GENERATED' and t = 'APPROVED') or (f = 'APPROVED' and t = 'GENERATED')
                  or (f = 'APPROVED' and t = 'LOCKED') or (f in ('DRAFT', 'GENERATED', 'APPROVED') and t = 'CANCELLED');
      begin
        perform public.set_period_status(p, t);
        got := true;
      exception when others then
        if sqlstate <> '55000' and sqlstate <> '22023' then
          raise exception 'transisi % -> %: error tak terduga % (%)', f, t, sqlstate, sqlerrm;
        end if;
        got := false;
        if sqlstate = '55000' and sqlerrm not like 'SCHED_BAD_TRANSITION:' || f || ':' || t then
          raise exception 'pesan transisi salah: %', sqlerrm;
        end if;
      end;
      -- DRAFT dan hanya-DRAFT bukan tujuan sah (22023): dianggap ditolak.
      assert got = ok_expected, format('transisi %s -> %s: diharapkan %s, hasil %s', f, t, ok_expected, got);
      reset role;
      assert (select status from public.schedule_periods where id = p) = case when got then t else f end,
        format('status setelah %s -> %s salah', f, t);
      n := n + 1;
    end loop;
  end loop;
  reset role;
  assert n = 25, 'semua pasangan diuji';
  perform public._t_admin();
  set local role authenticated;
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'NGAWUR')$q$, p), '22023');
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'DRAFT')$q$, p), '22023');
  perform public._t_expect_error(format($q$select public.set_period_status(%L, null)$q$, p), '22023');
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'APPROVED')$q$, gen_random_uuid()), 'P0002');
  reset role;
  raise notice 'PASS 01 tabel transisi: 25 pasangan diuji; hanya yang diizinkan yang berhasil; LOCKED/CANCELLED final';
end $$;

-- ---------------------------------------------------------------- 2. approve: syarat
do $$
declare
  p uuid;
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000f2');
  s1 uuid := public._t_id('subtest', 'UJ_T1');
  ra uuid := public._t_id('room', 'Uji Status A');
  r1 uuid := public._t_id('rombel', 'ST 1');
  sid uuid;
begin
  perform public._t_admin();
  set local role authenticated;
  p := public.create_schedule_period('Uji Approve', date '2027-02-01', date '2027-02-14');
  reset role;
  update public.schedule_periods set status = 'GENERATED' where id = p;
  set local role authenticated;

  -- Tanpa sesi: ditolak.
  perform public._t_expect_msg(format($q$select public.set_period_status(%L, 'APPROVED')$q$, p), 'P0001', 'SCHED_APPROVE_EMPTY');
  assert (select status from public.schedule_periods where id = p) = 'GENERATED', 'status tidak berubah bila ditolak';

  sid := public.create_teaching_session(p, date '2027-02-01', 1::smallint, r1, s1, t1, ra);

  -- Kebutuhan belum terjadwal TIDAK menghalangi approve.
  reset role;
  insert into public.scheduling_runs (period_id, seed) values (p, 1);
  insert into public.unscheduled_requirements (run_id, period_id, rombel_id, label, missing_per_week, reason_code)
    select r.id, p, r1, 'X', 2, 'NO_FREE_ROOM' from public.scheduling_runs r where r.period_id = p;
  -- Pelanggaran susulan: mentor dinonaktifkan -> approve ditolak dan menyebut jumlahnya.
  update public.tutor_profiles set is_active = false where id = t1;
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.set_period_status(%L, 'APPROVED')$q$, p), 'P0001', 'SCHED_APPROVE_VIOLATIONS:1');
  assert (select status from public.schedule_periods where id = p) = 'GENERATED', 'approve ditolak: status tetap';
  reset role;
  update public.tutor_profiles set is_active = true where id = t1;
  set local role authenticated;

  perform public.set_period_status(p, 'APPROVED');
  assert (select status from public.schedule_periods where id = p) = 'APPROVED', 'approve berhasil walau ada kebutuhan belum terjadwal';
  reset role;
  raise notice 'PASS 02 approve: butuh sesi dan nol pelanggaran; kebutuhan belum terjadwal tidak menghalangi';
end $$;

-- ---------------------------------------------------------------- 3. proteksi saat APPROVED, tarik persetujuan, LOCKED
do $$
declare
  p uuid := public._t_id('period', 'Uji Approve');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000f2');
  s1 uuid := public._t_id('subtest', 'UJ_T1');
  ra uuid := public._t_id('room', 'Uji Status A');
  r2 uuid := public._t_id('rombel', 'ST 2');
  sid uuid;
begin
  select id into sid from public.teaching_sessions where period_id = p and status = 'SCHEDULED' limit 1;
  perform public._t_admin();
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2027-02-02', 1::smallint, %L, %L, %L, %L)$q$, p, r2, s1, t1, ra), '55000', 'SCHED_NOT_EDITABLE:APPROVED');
  perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), '55000');
  perform public._t_expect_error(format($q$select public.save_generated_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '55000');

  -- Tarik persetujuan: bisa diedit lagi.
  perform public.set_period_status(p, 'GENERATED');
  perform public.cancel_teaching_session(public.create_teaching_session(p, date '2027-02-02', 1::smallint, r2, s1, t1, ra));
  perform public.set_period_status(p, 'APPROVED');
  perform public.set_period_status(p, 'LOCKED');
  assert (select status from public.schedule_periods where id = p) = 'LOCKED', 'LOCKED tercapai';
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'GENERATED')$q$, p), '55000');
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'APPROVED')$q$, p), '55000');
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'CANCELLED')$q$, p), '55000');
  perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), '55000');
  perform public._t_expect_error(format($q$select public.update_schedule_period(%L, 'Baru', date '2027-02-01', date '2027-02-14')$q$, p), '55000');
  reset role;
  assert (select status from public.teaching_sessions where id = sid) = 'SCHEDULED', 'sesi di periode LOCKED tidak berubah';
  raise notice 'PASS 03 APPROVED melindungi sesi; tarik persetujuan membuka edit; LOCKED final dan melindungi semuanya';
end $$;

-- ---------------------------------------------------------------- 4. cancel membatalkan sesi dan membebaskan slot
do $$
declare
  p uuid; p2 uuid;
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000f2');
  s1 uuid := public._t_id('subtest', 'UJ_T1');
  ra uuid := public._t_id('room', 'Uji Status A');
  r1 uuid := public._t_id('rombel', 'ST 1');
begin
  perform public._t_admin();
  set local role authenticated;
  p := public.create_schedule_period('Uji Cancel', date '2027-03-01', date '2027-03-14');
  perform public.create_teaching_session(p, date '2027-03-01', 1::smallint, r1, s1, t1, ra);
  perform public.create_teaching_session(p, date '2027-03-08', 1::smallint, r1, s1, t1, ra);
  -- Tanggal yang sama masih bentrok selama periode aktif.
  perform public._t_expect_error($q$select public.create_schedule_period('Uji Tabrakan', date '2027-03-05', date '2027-03-20')$q$, '23P01');
  perform public.set_period_status(p, 'CANCELLED');
  assert (select count(*) from public.teaching_sessions where period_id = p and status = 'SCHEDULED') = 0, 'semua sesi dibatalkan';
  assert (select count(*) from public.teaching_sessions where period_id = p and status = 'CANCELLED') = 2, 'sesi tetap tercatat sebagai CANCELLED';
  -- Periode dibatalkan membebaskan tanggal dan slot untuk periode baru.
  p2 := public.create_schedule_period('Uji Pengganti', date '2027-03-01', date '2027-03-14');
  perform public.create_teaching_session(p2, date '2027-03-01', 1::smallint, r1, s1, t1, ra);
  perform public._t_expect_error(format($q$select public.save_generated_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '55000');
  reset role;
  raise notice 'PASS 04 CANCELLED membatalkan sesi, membebaskan tanggal dan slot, dan final';
end $$;

-- ---------------------------------------------------------------- 5. Generate Additional
do $$
declare
  p uuid;
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000f2');
  t2 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000f3');
  s1 uuid := public._t_id('subtest', 'UJ_T1');
  s2 uuid := public._t_id('subtest', 'UJ_T2');
  ra uuid := public._t_id('room', 'Uji Status A');
  rb uuid := public._t_id('room', 'Uji Status B');
  rc uuid := public._t_id('room', 'Uji Status C');
  r1 uuid := public._t_id('rombel', 'ST 1');
  r2 uuid := public._t_id('rombel', 'ST 2');
  r3 uuid := public._t_id('rombel', 'ST 3');
  before jsonb; run uuid; extra jsonb; st text; n integer;
begin
  perform public._t_admin();
  set local role authenticated;
  p := public.create_schedule_period('Uji Additional', date '2027-04-05', date '2027-04-18');

  -- DRAFT ditolak.
  perform public._t_expect_msg(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '55000', 'SCHED_ADDITIONAL_NOT_ALLOWED:DRAFT');

  -- Jadwal awal lewat Generate Jadwal (1 sesi), lalu Additional pada GENERATED dan APPROVED.
  perform public.save_generated_schedule(p, 1, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('session_date', '2027-04-05', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra)),
    '[]'::jsonb);
  before := public._t_rows(p);
  assert jsonb_array_length(before) = 1, 'jadwal awal 1 sesi';

  extra := jsonb_build_array(
    jsonb_build_object('session_date', '2027-04-05', 'slot_no', 2, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra),
    jsonb_build_object('session_date', '2027-04-12', 'slot_no', 2, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra));
  run := public.save_additional_schedule(p, 9, '{"x":1}'::jsonb, extra,
    jsonb_build_array(jsonb_build_object('rombel_id', r2, 'label', 'Subtes Status 2', 'subtest_ids', jsonb_build_array(s2),
      'missing_per_week', 1, 'reason_code', 'NO_COMPETENT_TUTOR', 'detail', 'uji')));
  assert (select mode from public.scheduling_runs where id = run) = 'additional', 'run bermode additional';
  assert (select count(*) from public.teaching_sessions where period_id = p) = 3, 'sesi bertambah 2';
  assert (select count(*) from public.teaching_sessions where run_id = run and source = 'ADDITIONAL') = 2, 'sesi baru bertanda ADDITIONAL';
  assert (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(public._t_rows(p)) x where x->>'source' = 'GENERATED')
       = (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(before) x),
    'sesi lama TIDAK berubah sama sekali (semua kolom, termasuk updated_at)';
  assert (select status from public.schedule_periods where id = p) = 'GENERATED', 'status tidak berubah';
  assert (select count(*) from public.unscheduled_requirements where run_id = run) = 1, 'kebutuhan belum terjadwal tercatat';
  raise notice 'PASS 05 Additional pada GENERATED: hanya menambah, sesi lama utuh, run tercatat';

  -- Pada APPROVED: boleh; sesi lama tetap utuh; status tetap APPROVED.
  perform public.set_period_status(p, 'APPROVED');
  before := public._t_rows(p);
  perform public.save_additional_schedule(p, 10, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('session_date', '2027-04-06', 'slot_no', 1, 'rombel_id', r2, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra)), '[]'::jsonb);
  assert (select count(*) from public.teaching_sessions where period_id = p) = 4, 'additional pada APPROVED menambah sesi';
  assert (select status from public.schedule_periods where id = p) = 'APPROVED', 'status tetap APPROVED';
  assert (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(before) x)
       = (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(public._t_rows(p)) x where x->>'id' in (select e->>'id' from jsonb_array_elements(before) e)),
    'sesi pada periode APPROVED tidak berubah';
  raise notice 'PASS 06 Additional pada APPROVED: menambah tanpa menyentuh sesi yang disetujui';

  -- Sesi tambahan melanggar aturan: seluruh additional dibatalkan (termasuk run-nya).
  before := public._t_rows(p);
  n := (select count(*) from public.scheduling_runs where period_id = p);
  perform public._t_expect_msg(format($q$select public.save_additional_schedule(%L, 11, '{}'::jsonb, %L::jsonb, '[]'::jsonb)$q$, p,
    jsonb_build_array(
      jsonb_build_object('session_date', '2027-04-07', 'slot_no', 1, 'rombel_id', r2, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra),
      jsonb_build_object('session_date', '2027-04-07', 'slot_no', 2, 'rombel_id', r2, 'subtest_id', s2, 'tutor_id', t1, 'room_id', ra))::text),
    'P0001', 'COMPETENCY');   -- t1 tidak kompeten S2
  assert public._t_rows(p) = before, 'additional gagal: jadwal utuh';
  assert (select count(*) from public.scheduling_runs where period_id = p) = n, 'additional gagal: run tidak tercatat';

  -- Bentrok dengan sesi lama: ditolak oleh indeks unik dan semuanya dibatalkan.
  perform public._t_expect_msg(format($q$select public.save_additional_schedule(%L, 12, '{}'::jsonb, %L::jsonb, '[]'::jsonb)$q$, p,
    jsonb_build_array(jsonb_build_object('session_date', '2027-04-05', 'slot_no', 1, 'rombel_id', r2, 'subtest_id', s1, 'tutor_id', t1, 'room_id', rb))::text),
    '23505', 'teaching_sessions_tutor_slot_key');
  assert public._t_rows(p) = before, 'bentrok: jadwal utuh';

  -- Pelanggaran LAMA (bukan dari run ini) tidak menghalangi additional yang valid.
  reset role;
  update public.rooms set capacity = 1 where id = ra;     -- sesi lama kini melanggar kapasitas
  set local role authenticated;
  assert (select count(*) from public.schedule_violations(p)) > 0, 'syarat: ada pelanggaran lama';
  perform public.save_additional_schedule(p, 13, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('session_date', '2027-04-12', 'slot_no', 1, 'rombel_id', r3, 'subtest_id', s1, 'tutor_id', t1, 'room_id', rc)), '[]'::jsonb);
  reset role;
  update public.rooms set capacity = 10 where id = ra;

  -- Payload rusak.
  set local role authenticated;
  perform public._t_expect_error(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '{"a":1}'::jsonb, '[]'::jsonb)$q$, p), '22023');
  perform public._t_expect_error(format($q$select public.save_additional_schedule(%L, -5, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '23514');
  perform public._t_expect_error(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, gen_random_uuid()), 'P0002');

  -- LOCKED dan CANCELLED menolak.
  perform public.set_period_status(p, 'LOCKED');
  perform public._t_expect_msg(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '55000', 'SCHED_ADDITIONAL_NOT_ALLOWED:LOCKED');
  reset role;
  raise notice 'PASS 07 Additional: pelanggaran/bentrok membatalkan semuanya; pelanggaran lama tidak menghalangi; LOCKED ditolak';
end $$;

-- ---------------------------------------------------------------- 6. Generate Jadwal (full) tetap dilindungi status
do $$
declare p uuid;
begin
  perform public._t_admin();
  set local role authenticated;
  p := public.create_schedule_period('Uji Full Setelah Additional', date '2027-06-07', date '2027-06-13');
  reset role;
  update public.schedule_periods set status = 'GENERATED' where id = p;
  set local role authenticated;
  perform public.save_additional_schedule(p, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
  perform public.save_generated_schedule(p, 2, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
  assert (select count(*) from public.scheduling_runs where period_id = p) = 2, 'kedua run tercatat';
  reset role;
  raise notice 'PASS 08 Generate Jadwal penuh tetap bisa pada GENERATED dan mencatat run';
end $$;

-- ---------------------------------------------------------------- 7. hak akses
do $$
declare
  p uuid := public._t_id('period', 'Uji Approve');
  r1 uuid := public._t_id('rombel', 'ST 1');
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'CANCELLED')$q$, p), '42501');
  perform public._t_expect_error(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '42501');
  perform public._t_expect_error(format($q$select * from public._schedule_violations(%L, null, null)$q$, p), '42501');
  reset role;
  set local role anon;
  perform public._t_expect_error(format($q$select public.set_period_status(%L, 'CANCELLED')$q$, p), '42501');
  perform public._t_expect_error(format($q$select public.save_additional_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '42501');
  reset role;
  assert (select status from public.schedule_periods where id = p) = 'LOCKED', 'status tidak berubah oleh tutor/anon';
  raise notice 'PASS 09 tutor dan anon tidak bisa mengubah status atau generate additional';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
