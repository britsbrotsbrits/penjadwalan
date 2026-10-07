-- Tes jadwal bertanggal (Phase 10): schedule_periods, teaching_sessions, RPC tulis, validasi,
-- proteksi status, atomisitas generate, dan hak akses.
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat psql
-- sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai data "Uji" sendiri.
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
--
-- Syarat: migrasi Phase 2-7 dan 9100000 (create_schedule) sudah dijalankan. Slot sesi 1 dan 2 harus
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
  ('00000000-0000-0000-0000-0000000000d1', 'sc-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'sc-tutor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d3', 'sc-tutor2@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set role = 'tutor', is_active = true where id in
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3');
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

insert into public.subtests (code, name) values ('UJ_S1', 'Subtes Uji 1'), ('UJ_S2', 'Subtes Uji 2');
insert into public.rooms (name, capacity) values ('Uji Jadwal A', 10), ('Uji Jadwal B', 2), ('Uji Jadwal C', 10);
insert into public.programs (name) values ('Program Uji Jadwal');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji Jadwal', 10 from public.programs where name = 'Program Uji Jadwal';
insert into public.rombels (class_type_id, name)
  select ct.id, v.name from public.class_types ct, (values ('SC 1'), ('SC 2'), ('SC 3')) as v(name)
  where ct.name = 'Tipe Uji Jadwal';
update public.rombels set fixed_room_id = (select id from public.rooms where name = 'Uji Jadwal C') where name = 'SC 3';
insert into public.students (full_name, rombel_id)
  select 'Siswa SC ' || g, (select id from public.rombels where name = 'SC 1') from generate_series(1, 3) g;

-- Tutor 1 (d2): kompeten S1; tersedia Senin sesi 1-2 dan Selasa sesi 1.
-- Tutor 2 (d3): kompeten S1 dan S2; tersedia Senin sesi 1 saja.
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000d2' and s.code = 'UJ_S1';
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000d3' and s.code in ('UJ_S1', 'UJ_S2');
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, v.d, v.n, true from public.tutor_profiles tp, (values (1, 1), (1, 2), (2, 1)) as v(d, n)
 where tp.profile_id = '00000000-0000-0000-0000-0000000000d2';
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, 1, 1, true from public.tutor_profiles tp
 where tp.profile_id = '00000000-0000-0000-0000-0000000000d3';

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

-- ---------------------------------------------------------------- 1. periode
do $$
declare p uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;

  p := public.create_schedule_period('Uji Periode', date '2026-11-02', date '2026-11-15');
  assert (select status from public.schedule_periods where id = p) = 'DRAFT', 'periode baru berstatus DRAFT';

  perform public._t_expect_error(
    $q$select public.create_schedule_period('Uji Periode', date '2027-01-01', date '2027-01-10')$q$, '23505');
  perform public._t_expect_error(
    $q$select public.create_schedule_period('Uji Terbalik', date '2027-01-10', date '2027-01-01')$q$, '23514');
  perform public._t_expect_error(
    $q$select public.create_schedule_period('Uji Terlalu Panjang', date '2027-01-01', date '2027-04-30')$q$, '23514');
  perform public._t_expect_error(
    $q$select public.create_schedule_period('Uji Tumpang Tindih', date '2026-11-10', date '2026-11-20')$q$, '23P01');
  perform public._t_expect_error(
    $q$select public.create_schedule_period('   ', date '2027-02-01', date '2027-02-10')$q$, '23514');
  -- Tepat 92 hari boleh; batas dijaga constraint.
  perform public.create_schedule_period('Uji 92 Hari', date '2027-02-01', date '2027-05-03');
  assert (select count(*) from public.schedule_periods where name like 'Uji%') = 2, 'percobaan gagal tidak membuat baris';
  reset role;
  raise notice 'PASS 01 periode: dibuat DRAFT; nama unik, urutan tanggal, panjang maksimum, tidak tumpang tindih';
end $$;

-- ---------------------------------------------------------------- 2. membuat sesi manual
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  t2 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d3');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  s2 uuid := public._t_id('subtest', 'UJ_S2');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  rb uuid := public._t_id('room', 'Uji Jadwal B');
  rc uuid := public._t_id('room', 'Uji Jadwal C');
  r1 uuid := public._t_id('rombel', 'SC 1');
  r2 uuid := public._t_id('rombel', 'SC 2');
  r3 uuid := public._t_id('rombel', 'SC 3');
  sid uuid;
  n_before integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;

  -- Senin 2 Nov 2026, sesi 1: SC 1 (3 siswa) + S1 + Tutor 1 + Ruang A (10)
  sid := public.create_teaching_session(p, date '2026-11-02', 1::smallint, r1, s1, t1, ra);
  assert (select source from public.teaching_sessions where id = sid) = 'MANUAL', 'sesi manual bertanda MANUAL';
  assert (select status from public.teaching_sessions where id = sid) = 'SCHEDULED', 'sesi baru SCHEDULED';

  select count(*) into n_before from public.teaching_sessions;

  -- Pelanggaran: tiap kasus ditolak P0001 dengan kode di pesan, dan tidak meninggalkan baris.
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-03', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s2, t1, ra), 'P0001', 'COMPETENCY');
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-03', 2::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t1, ra), 'P0001', 'AVAILABILITY');
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-03', 1::smallint, %L, %L, %L, %L)$q$,
    p, r1, s1, t1, rb), 'P0001', 'CAPACITY');      -- 3 siswa aktual > 2 kursi
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-03', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t1, rb), 'P0001', 'CAPACITY');      -- 0 siswa: ukuran standar 10 > 2 kursi
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-03', 1::smallint, %L, %L, %L, %L)$q$,
    p, r3, s1, t1, ra), 'P0001', 'FIXED_ROOM');    -- SC 3 wajib Ruang C
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-08', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t1, ra), 'P0001', 'DAY_INACTIVE');  -- Minggu
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-12-07', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t1, ra), 'P0001', 'OUT_OF_PERIOD');
  assert (select count(*) from public.teaching_sessions) = n_before, 'sesi yang ditolak tidak meninggalkan baris';
  raise notice 'PASS 02 sesi manual: kompetensi, availability, kapasitas (aktual & ukuran standar), ruangan tetap, hari nonaktif, di luar periode';

  -- Fallback ukuran standar: SC 2 tanpa siswa muat di Ruang A (10).
  perform public.create_teaching_session(p, date '2026-11-03', 1::smallint, r2, s1, t1, ra);
  -- Ruangan tetap benar diterima.
  perform public.create_teaching_session(p, date '2026-11-02', 2::smallint, r3, s1, t1, rc);
  raise notice 'PASS 03 sesi valid diterima (ukuran standar sebagai cadangan kapasitas; ruangan tetap benar)';

  -- Dobel: indeks unik adalah pertahanan terakhir.
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t1, rc), '23505', 'teaching_sessions_tutor_slot_key');
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L, %L)$q$,
    p, r2, s1, t2, ra), '23505', 'teaching_sessions_room_slot_key');
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L, %L)$q$,
    p, r1, s1, t2, rc), '23505', 'teaching_sessions_rombel_slot_key');
  reset role;
  raise notice 'PASS 04 tutor, ruangan, dan rombel tidak bisa dobel pada tanggal+sesi yang sama';
end $$;

-- ---------------------------------------------------------------- 3. ubah & batalkan
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  t2 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d3');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  s2 uuid := public._t_id('subtest', 'UJ_S2');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  rb uuid := public._t_id('room', 'Uji Jadwal B');
  r1 uuid := public._t_id('rombel', 'SC 1');
  sid uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  select id into sid from public.teaching_sessions
   where rombel_id = r1 and session_date = date '2026-11-02' and slot_no = 1;

  -- Ganti tutor + subtes ke Tutor 2 (kompeten S2, tersedia Senin sesi 1): valid.
  perform public.update_teaching_session(sid, date '2026-11-02', 1::smallint, s2, t2, ra);
  assert (select tutor_id from public.teaching_sessions where id = sid) = t2, 'tutor berganti';
  assert (select subtest_id from public.teaching_sessions where id = sid) = s2, 'subtes berganti';

  -- Pindah ke Senin sesi 2: Tutor 2 tidak tersedia -> ditolak dan data tidak berubah.
  perform public._t_expect_msg(format($q$select public.update_teaching_session(%L, date '2026-11-02', 2::smallint, %L, %L, %L)$q$,
    sid, s2, t2, ra), 'P0001', 'AVAILABILITY');
  assert (select slot_no from public.teaching_sessions where id = sid) = 1, 'update yang ditolak dibatalkan seluruhnya';
  -- Ganti ruangan ke yang terlalu kecil: ditolak.
  perform public._t_expect_msg(format($q$select public.update_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L)$q$,
    sid, s2, t2, rb), 'P0001', 'CAPACITY');
  assert (select room_id from public.teaching_sessions where id = sid) = ra, 'ruangan tetap seperti semula';
  -- Pindah ke Senin sesi 2 bersama Tutor 1, yang sudah mengajar SC 3 di sana: bentrok tutor.
  perform public._t_expect_msg(format($q$select public.update_teaching_session(%L, date '2026-11-02', 2::smallint, %L, %L, %L)$q$,
    sid, s1, t1, ra), '23505', 'teaching_sessions_tutor_slot_key');
  assert (select slot_no from public.teaching_sessions where id = sid) = 1, 'bentrok tidak mengubah data';
  perform public._t_expect_error(format($q$select public.update_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L)$q$,
    gen_random_uuid(), s1, t1, ra), 'P0002');
  raise notice 'PASS 05 ubah sesi: berhasil bila valid; pelanggaran/bentrok ditolak dan data tetap utuh';

  -- Batalkan membebaskan slot.
  perform public.cancel_teaching_session(sid);
  assert (select status from public.teaching_sessions where id = sid) = 'CANCELLED', 'sesi dibatalkan';
  perform public.create_teaching_session(p, date '2026-11-02', 1::smallint, r1, s1, t1, ra);
  perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), 'P0002');
  perform public._t_expect_error(format($q$select public.update_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L)$q$,
    sid, s1, t1, ra), 'P0002');
  reset role;
  raise notice 'PASS 06 batalkan: slot bebas dipakai lagi; sesi dibatalkan tidak bisa diubah/dibatalkan lagi';
end $$;

-- ---------------------------------------------------------------- 4. status periode melindungi jadwal
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  r2 uuid := public._t_id('rombel', 'SC 2');
  sid uuid;
  st text;
begin
  select id into sid from public.teaching_sessions where period_id = p and status = 'SCHEDULED' limit 1;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

  -- DRAFT dan GENERATED boleh diedit.
  foreach st in array array['GENERATED'] loop
    reset role;
    update public.schedule_periods set status = st where id = p;
    set local role authenticated;
    perform public.cancel_teaching_session(
      public.create_teaching_session(p, date '2026-11-10', 1::smallint, r2, s1, t1, ra));
  end loop;

  foreach st in array array['APPROVED', 'LOCKED', 'CANCELLED'] loop
    reset role;
    update public.schedule_periods set status = st where id = p;
    set local role authenticated;
    perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2026-11-10', 1::smallint, %L, %L, %L, %L)$q$,
      p, r2, s1, t1, ra), '55000', 'SCHED_NOT_EDITABLE:' || st);
    perform public._t_expect_error(format($q$select public.update_teaching_session(%L, date '2026-11-02', 1::smallint, %L, %L, %L)$q$,
      sid, s1, t1, ra), '55000');
    perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), '55000');
    perform public._t_expect_error(format($q$select public.save_generated_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '55000');
    perform public._t_expect_error(format($q$select public.update_schedule_period(%L, 'Uji Periode', date '2026-11-02', date '2026-11-15')$q$, p), '55000');
  end loop;
  reset role;
  assert (select status from public.teaching_sessions where id = sid) = 'SCHEDULED', 'sesi di periode terkunci tidak berubah';
  update public.schedule_periods set status = 'GENERATED' where id = p;
  raise notice 'PASS 07 periode APPROVED/LOCKED/CANCELLED menolak semua perubahan jadwal';
end $$;

-- ---------------------------------------------------------------- 5. generate (atomik)
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  t2 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d3');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  s2 uuid := public._t_id('subtest', 'UJ_S2');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  rb uuid := public._t_id('room', 'Uji Jadwal B');
  r1 uuid := public._t_id('rombel', 'SC 1');
  r2 uuid := public._t_id('rombel', 'SC 2');
  good jsonb; bad jsonb; dup jsonb; unsched jsonb;
  run uuid;
  before_ids uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  select array_agg(id order by id) into before_ids from public.teaching_sessions where period_id = p;

  good := jsonb_build_array(
    jsonb_build_object('session_date', '2026-11-02', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra),
    jsonb_build_object('session_date', '2026-11-09', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra),
    jsonb_build_object('session_date', '2026-11-02', 'slot_no', 1, 'rombel_id', r2, 'subtest_id', s2, 'tutor_id', t2, 'room_id', ra));
  -- Baris ke-3 di atas memakai Ruang A yang sama dengan baris 1 pada tanggal+sesi sama -> dobel ruangan.
  perform public._t_expect_msg(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, %L::jsonb, '[]'::jsonb)$q$, p, good::text),
    '23505', 'teaching_sessions_room_slot_key');
  assert (select array_agg(id order by id) from public.teaching_sessions where period_id = p) = before_ids,
    'generate yang gagal (dobel) tidak mengubah jadwal lama sama sekali';
  assert (select count(*) from public.scheduling_runs where period_id = p) = 0, 'run yang gagal tidak tercatat';

  bad := jsonb_build_array(
    jsonb_build_object('session_date', '2026-11-02', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', rb));
  perform public._t_expect_msg(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, %L::jsonb, '[]'::jsonb)$q$, p, bad::text),
    'P0001', 'CAPACITY');
  assert (select array_agg(id order by id) from public.teaching_sessions where period_id = p) = before_ids,
    'generate yang melanggar aturan membatalkan semuanya (jadwal lama utuh)';

  perform public._t_expect_error(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, '{"a":1}'::jsonb, '[]'::jsonb)$q$, p), '22023');
  perform public._t_expect_error(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, '[]'::jsonb, '"x"'::jsonb)$q$, p), '22023');
  perform public._t_expect_error(
    format($q$select public.save_generated_schedule(%L, -1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '23514');
  perform public._t_expect_error(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, '[]'::jsonb, %L::jsonb)$q$, p,
      jsonb_build_array(jsonb_build_object('rombel_id', r1, 'label', 'X', 'subtest_ids', '[]'::jsonb, 'missing_per_week', 0, 'reason_code', 'NO_FREE_ROOM'))::text), '23514');
  perform public._t_expect_error(
    format($q$select public.save_generated_schedule(%L, 7, '{}'::jsonb, '[]'::jsonb, %L::jsonb)$q$, p,
      jsonb_build_array(jsonb_build_object('rombel_id', r1, 'label', 'X', 'missing_per_week', 1, 'reason_code', 'KODE_NGAWUR'))::text), '23514');
  assert (select array_agg(id order by id) from public.teaching_sessions where period_id = p) = before_ids,
    'payload rusak tidak mengubah jadwal lama';

  -- Berhasil: ganti seluruh isi periode.
  good := jsonb_build_array(
    jsonb_build_object('session_date', '2026-11-02', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra),
    jsonb_build_object('session_date', '2026-11-09', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', t1, 'room_id', ra));
  unsched := jsonb_build_array(
    jsonb_build_object('rombel_id', r2, 'label', 'Subtes Uji 2', 'subtest_ids', jsonb_build_array(s2),
      'missing_per_week', 2, 'reason_code', 'NO_AVAILABLE_TUTOR_SLOT', 'detail', 'Uji'));
  run := public.save_generated_schedule(p, 4242, '{"required":4}'::jsonb, good, unsched);
  assert (select count(*) from public.teaching_sessions where period_id = p) = 2, 'sesi lama (manual) diganti hasil generate';
  assert (select count(*) from public.teaching_sessions where period_id = p and source = 'GENERATED' and run_id = run) = 2,
    'sesi hasil generate bertanda GENERATED dan menunjuk run';
  assert (select seed from public.scheduling_runs where id = run) = 4242, 'seed tercatat';
  assert (select count(*) from public.unscheduled_requirements where run_id = run and missing_per_week = 2) = 1, 'kebutuhan belum terpenuhi tercatat';
  assert (select status from public.schedule_periods where id = p) = 'GENERATED', 'periode menjadi GENERATED';

  -- Generate ulang menggantikan lagi (kosong juga sah: tidak ada sesi sama sekali).
  run := public.save_generated_schedule(p, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
  assert (select count(*) from public.teaching_sessions where period_id = p) = 0, 'generate ulang mengganti isi periode';
  assert (select count(*) from public.scheduling_runs where period_id = p) = 2, 'riwayat run bertambah';
  reset role;
  raise notice 'PASS 08 generate atomik: gagal = jadwal lama utuh; berhasil = mengganti semuanya + run + kebutuhan belum terpenuhi';
end $$;

-- ---------------------------------------------------------------- 6. laporan validasi & perubahan pasca-fakta
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  r1 uuid := public._t_id('rombel', 'SC 1');
  sid uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  sid := public.create_teaching_session(p, date '2026-11-02', 1::smallint, r1, s1, t1, ra);
  assert (select count(*) from public.schedule_violations(p)) = 0, 'jadwal valid: laporan kosong';
  reset role;

  -- Data induk berubah sesudah sesi dibuat: laporan harus menangkapnya.
  update public.tutor_profiles set is_active = false where id = t1;
  update public.rooms set capacity = 2 where id = ra;
  update public.tutor_availability set available = false where tutor_id = t1 and day_of_week = 1 and slot_no = 1;
  delete from public.tutor_competencies where tutor_id = t1 and subtest_id = s1;
  set local role authenticated;
  assert (select array_agg(code order by code) from public.schedule_violations(p) where session_id = sid)
    = array['AVAILABILITY', 'CAPACITY', 'COMPETENCY', 'INACTIVE_TUTOR'], 'laporan memuat semua pelanggaran susulan';
  reset role;
  raise notice 'PASS 09 schedule_violations menangkap pelanggaran yang muncul setelah sesi dibuat';
end $$;

-- ---------------------------------------------------------------- 7. ubah periode
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode');
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  perform public.update_schedule_period(p, 'Uji Periode Baru', date '2026-11-02', date '2026-11-20');
  assert (select name from public.schedule_periods where id = p) = 'Uji Periode Baru', 'nama berubah';
  -- Sesi ada pada 2 Nov: rentang baru yang mengecualikannya ditolak.
  perform public._t_expect_msg(
    format($q$select public.update_schedule_period(%L, 'Uji Periode Baru', date '2026-11-03', date '2026-11-20')$q$, p),
    'P0001', 'SCHED_SESSIONS_OUTSIDE_RANGE');
  perform public._t_expect_error(
    format($q$select public.update_schedule_period(%L, 'Uji Periode Baru', date '2026-11-02', date '2027-03-01')$q$, p), '23514');
  perform public._t_expect_error(
    format($q$select public.update_schedule_period(%L, 'x', date '2026-11-02', date '2026-11-20')$q$, gen_random_uuid()), 'P0002');
  assert (select end_date from public.schedule_periods where id = p) = date '2026-11-20', 'percobaan gagal tidak mengubah tanggal';
  reset role;
  raise notice 'PASS 10 ubah periode: nama bebas; tanggal tidak boleh mengecualikan sesi yang ada';
end $$;

-- ---------------------------------------------------------------- 8. hak akses
do $$
declare
  p uuid := public._t_id('period', 'Uji Periode Baru');
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000d2');
  s1 uuid := public._t_id('subtest', 'UJ_S1');
  ra uuid := public._t_id('room', 'Uji Jadwal A');
  r1 uuid := public._t_id('rombel', 'SC 1');
  sid uuid;
begin
  select id into sid from public.teaching_sessions where period_id = p limit 1;
  assert sid is not null, 'syarat tes: ada sesi';

  -- Admin: baca ya, tulis langsung tidak (hanya RPC).
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.teaching_sessions) >= 1, 'admin membaca sesi';
  assert (select count(*) from public.schedule_periods) >= 1, 'admin membaca periode';
  perform public._t_expect_error(format($q$insert into public.teaching_sessions (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id)
    values (%L, date '2026-11-05', 1, %L, %L, %L, %L)$q$, p, r1, s1, t1, ra), '42501');
  perform public._t_expect_error(format($q$update public.teaching_sessions set room_id = %L where id = %L$q$, ra, sid), '42501');
  perform public._t_expect_error(format($q$delete from public.teaching_sessions where id = %L$q$, sid), '42501');
  perform public._t_expect_error(format($q$update public.schedule_periods set status = 'LOCKED' where id = %L$q$, p), '42501');
  perform public._t_expect_error(format($q$insert into public.schedule_periods (name, start_date, end_date) values ('X', date '2030-01-01', date '2030-01-02')$q$), '42501');
  perform public._t_expect_error('delete from public.scheduling_runs', '42501');
  reset role;

  -- Tutor: tidak membaca apa pun, tidak memanggil RPC.
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.teaching_sessions) = 0, 'tutor tidak melihat sesi (Phase 12 membuka sesi miliknya)';
  assert (select count(*) from public.schedule_periods) = 0, 'tutor tidak melihat periode';
  assert (select count(*) from public.scheduling_runs) = 0, 'tutor tidak melihat run';
  assert (select count(*) from public.unscheduled_requirements) = 0, 'tutor tidak melihat kebutuhan belum terpenuhi';
  perform public._t_expect_error(format($q$select public.create_teaching_session(%L, date '2026-11-05', 1::smallint, %L, %L, %L, %L)$q$, p, r1, s1, t1, ra), '42501');
  perform public._t_expect_error(format($q$select public.update_teaching_session(%L, date '2026-11-05', 1::smallint, %L, %L, %L)$q$, sid, s1, t1, ra), '42501');
  perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), '42501');
  perform public._t_expect_error(format($q$select public.save_generated_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '42501');
  perform public._t_expect_error($q$select public.create_schedule_period('Tutor', date '2031-01-01', date '2031-01-05')$q$, '42501');
  perform public._t_expect_error(format($q$select public.update_schedule_period(%L, 'x', date '2026-11-02', date '2026-11-20')$q$, p), '42501');
  perform public._t_expect_error(format($q$select * from public.schedule_violations(%L)$q$, p), '42501');
  perform public._t_expect_error(format($q$select * from public._schedule_violations(%L, null)$q$, p), '42501');
  reset role;

  -- Anon: ditolak semuanya.
  set local role anon;
  perform public._t_expect_error('select * from public.teaching_sessions', '42501');
  perform public._t_expect_error('select * from public.schedule_periods', '42501');
  perform public._t_expect_error(format($q$select public.cancel_teaching_session(%L)$q$, sid), '42501');
  perform public._t_expect_error(format($q$select public.save_generated_schedule(%L, 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, p), '42501');
  reset role;

  -- Tutor_id RESTRICT: tutor yang punya sesi tidak bisa terhapus; ruangan juga.
  perform public._t_expect_error(format($q$delete from public.tutor_profiles where id = %L$q$, t1), '23503');
  perform public._t_expect_error(format($q$delete from public.rooms where id = %L$q$, ra), '23503');
  raise notice 'PASS 11 hak akses: admin baca saja (tulis lewat RPC), tutor dan anon ditolak, referensi RESTRICT';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
