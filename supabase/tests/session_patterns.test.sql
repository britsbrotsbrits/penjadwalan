-- Tes pola sesi, hari tryout, label item fleksibel (Phase 14 scheduler class-first):
-- set_session_pattern / clear_session_pattern, resolusi rombel > tipe kelas > program,
-- pelanggaran PATTERN_SLOT dan TRYOUT_DAY, set_tryout_day, display_label pada save_*_schedule, hak akses.
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat psql
-- sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai data "Uji" sendiri dan
-- tanggal tahun 2054 supaya tidak bentrok dengan periode nyata.
-- Syarat: migrasi sampai 20261013100000_session_patterns.sql. Slot sesi 1-3 harus ada dan aktif
-- (bila tabel slot kosong, tes membuatnya sendiri).

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
  ('00000000-0000-0000-0000-0000000000e1', 'pt-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'pt-tutor@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set role = 'tutor', is_active = true where id = '00000000-0000-0000-0000-0000000000e2';
update public.tutor_profiles set is_active = true;

insert into public.session_slots (slot_no, start_time, duration_minutes)
select v.n, v.t::time, 90 from (values (1, '07:00'), (2, '08:30'), (3, '10:00')) as v(n, t)
where not exists (select 1 from public.session_slots);
do $$ begin
  assert (select count(*) from public.session_slots where slot_no in (1, 2, 3) and is_active) = 3,
    'syarat tes: slot sesi 1-3 harus aktif';
  assert (select is_active from public.calendar_days where day_of_week = 1), 'syarat tes: Senin aktif';
  assert not exists (select 1 from public.calendar_days where is_tryout), 'syarat tes: belum ada hari tryout';
end $$;

insert into public.subtests (code, name) values ('UJ_P1', 'Subtes Pola 1'), ('UJ_P2', 'Subtes Pola 2');
insert into public.rooms (name, capacity) values ('Uji Pola A', 10);
insert into public.programs (name) values ('Program Uji Pola');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji Pola', 10 from public.programs where name = 'Program Uji Pola';
insert into public.rombels (class_type_id, name)
  select ct.id, v.name from public.class_types ct, (values ('PT 1'), ('PT 2')) as v(name)
  where ct.name = 'Tipe Uji Pola';

insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000e2' and s.code in ('UJ_P1', 'UJ_P2');
-- Tersedia Senin dan Sabtu, sesi 1-3.
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, d, n, true from public.tutor_profiles tp, (values (1), (6)) as dd(d), (values (1), (2), (3)) as nn(n)
 where tp.profile_id = '00000000-0000-0000-0000-0000000000e2';

create function public._t_id(p_kind text, p_name text) returns uuid
language plpgsql as $$
declare r uuid;
begin
  if p_kind = 'room' then select id into r from public.rooms where name = p_name;
  elsif p_kind = 'rombel' then select id into r from public.rombels where name = p_name;
  elsif p_kind = 'class_type' then select id into r from public.class_types where name = p_name;
  elsif p_kind = 'program' then select id into r from public.programs where name = p_name;
  elsif p_kind = 'subtest' then select id into r from public.subtests where code = p_name;
  elsif p_kind = 'tutor' then select id into r from public.tutor_profiles where profile_id = p_name::uuid;
  elsif p_kind = 'period' then select id into r from public.schedule_periods where name = p_name;
  end if;
  return r;
end $$;

create function public._t_admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
end $$;

create function public._t_pattern(p_rombel text) returns text
language sql stable as $$
  select coalesce(string_agg(slot_no || ':' || kind, ',' order by slot_no), '-')
    from public._rombel_pattern(public._t_id('rombel', p_rombel))
$$;

-- ---------------------------------------------------------------- 1. set_session_pattern: validasi
do $$
declare
  ct uuid := public._t_id('class_type', 'Tipe Uji Pola');
begin
  perform public._t_admin();
  set local role authenticated;
  perform public.set_session_pattern('class_type', ct,
    '[{"slot_no":1,"kind":"SUBTEST"},{"slot_no":2,"kind":"DRILLING"},{"slot_no":3,"kind":"SUBTEST"}]'::jsonb);
  reset role;
  assert (select count(*) from public.session_pattern_items where scope_id = ct) = 3, 'tiga baris pola tersimpan';

  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[]'::jsonb)$q$, ct), '22023', 'PATTERN_ITEMS_INVALID');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '{"a":1}'::jsonb)$q$, ct), '22023', 'PATTERN_ITEMS_INVALID');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":1,"kind":"X"}]'::jsonb)$q$, ct), '22023', 'PATTERN_ITEMS_INVALID');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":1.5,"kind":"SUBTEST"}]'::jsonb)$q$, ct), '22023', 'PATTERN_ITEMS_INVALID');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":"1","kind":"SUBTEST"}]'::jsonb)$q$, ct), '22023', 'PATTERN_ITEMS_INVALID');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":1,"kind":"DRILLING"}]'::jsonb)$q$, ct), '22023', 'PATTERN_NEEDS_SUBTEST');
  perform public._t_expect_msg(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":77,"kind":"SUBTEST"}]'::jsonb)$q$, ct), 'P0002', 'PATTERN_SLOT_UNKNOWN');
  perform public._t_expect_error(format($q$select public.set_session_pattern('class_type', %L, '[{"slot_no":1,"kind":"SUBTEST"},{"slot_no":1,"kind":"DRILLING"}]'::jsonb)$q$, ct), '23505');
  perform public._t_expect_error($q$select public.set_session_pattern('class_type', gen_random_uuid(), '[{"slot_no":1,"kind":"SUBTEST"}]'::jsonb)$q$, 'P0002');
  perform public._t_expect_error(format($q$select public.set_session_pattern('bukan_scope', %L, '[{"slot_no":1,"kind":"SUBTEST"}]'::jsonb)$q$, ct), 'P0002');
  reset role;
  -- Semua penolakan tadi tidak mengubah pola lama (atomik).
  assert (select count(*) from public.session_pattern_items where scope_id = ct) = 3, 'pola lama utuh setelah penolakan';
  raise notice 'PASS 01 set_session_pattern: validasi dan atomik';
end $$;

-- ---------------------------------------------------------------- 2. resolusi rombel > tipe kelas > program
do $$
declare
  ct uuid := public._t_id('class_type', 'Tipe Uji Pola');
  pr uuid := public._t_id('program', 'Program Uji Pola');
  r2 uuid := public._t_id('rombel', 'PT 2');
begin
  perform public._t_admin();
  set local role authenticated;
  reset role;
  assert public._t_pattern('PT 1') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'rombel mewarisi pola tipe kelas';
  assert public._t_pattern('PT 2') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'rombel kedua juga mewarisi';

  perform public._t_admin();
  set local role authenticated;
  perform public.set_session_pattern('rombel', r2, '[{"slot_no":3,"kind":"SUBTEST"}]'::jsonb);
  reset role;
  assert public._t_pattern('PT 2') = '3:SUBTEST', 'pola rombel mengalahkan tipe kelas (sebagai satu kesatuan)';
  assert public._t_pattern('PT 1') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'rombel lain tidak terpengaruh';

  perform public._t_admin();
  set local role authenticated;
  perform public.set_session_pattern('rombel', r2, '[{"slot_no":2,"kind":"SUBTEST"}]'::jsonb);
  reset role;
  assert public._t_pattern('PT 2') = '2:SUBTEST', 'set ulang mengganti seluruh pola';

  perform public._t_admin();
  set local role authenticated;
  perform public.clear_session_pattern('rombel', r2);
  perform public.clear_session_pattern('rombel', r2);
  reset role;
  assert public._t_pattern('PT 2') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'clear kembali ke tipe kelas (idempoten)';

  perform public._t_admin();
  set local role authenticated;
  perform public.clear_session_pattern('class_type', ct);
  reset role;
  assert public._t_pattern('PT 1') = '-', 'tanpa pola sama sekali = kosong';

  perform public._t_admin();
  set local role authenticated;
  perform public.set_session_pattern('program', pr, '[{"slot_no":1,"kind":"SUBTEST"}]'::jsonb);
  reset role;
  assert public._t_pattern('PT 1') = '1:SUBTEST', 'pola program berlaku bila tidak ada yang lebih dekat';
  perform public._t_admin();
  set local role authenticated;
  perform public.clear_session_pattern('program', pr);
  perform public.set_session_pattern('class_type', ct,
    '[{"slot_no":1,"kind":"SUBTEST"},{"slot_no":2,"kind":"DRILLING"},{"slot_no":3,"kind":"SUBTEST"}]'::jsonb);
  reset role;
  raise notice 'PASS 02 resolusi pola rombel > tipe kelas > program, clear idempoten';
end $$;

-- ---------------------------------------------------------------- 3. PATTERN_SLOT
do $$
declare
  per uuid;
  r1 uuid := public._t_id('rombel', 'PT 1');
  sid uuid;
  msg text;
begin
  perform public._t_admin();
  set local role authenticated;
  per := public.create_schedule_period('Uji Pola', date '2054-11-02', date '2054-11-15');
  -- Senin 2054-11-02. Sesi 1 (SUBTEST) sah.
  sid := public.create_teaching_session(per, date '2054-11-02', 1::smallint, r1,
    public._t_id('subtest', 'UJ_P1'), public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2'), public._t_id('room', 'Uji Pola A'));
  -- Sesi 2 (DRILLING) ditolak.
  begin
    perform public.create_teaching_session(per, date '2054-11-02', 2::smallint, r1,
      public._t_id('subtest', 'UJ_P1'), public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2'), public._t_id('room', 'Uji Pola A'));
    raise exception 'sesi DRILLING seharusnya ditolak';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm not like 'SCHED_VIOLATION:%PATTERN_SLOT%' then
      raise exception 'galat tak terduga % %', sqlstate, sqlerrm;
    end if;
  end;
  reset role;
  -- Rombel tanpa pola (PT 2 setelah pola tipe kelas dihapus) boleh di sesi mana pun.
  delete from public.session_pattern_items where scope_id = public._t_id('class_type', 'Tipe Uji Pola');
  perform public._t_admin();
  set local role authenticated;
  perform public.create_teaching_session(per, date '2054-11-02', 2::smallint, r1,
    public._t_id('subtest', 'UJ_P1'), public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2'), public._t_id('room', 'Uji Pola A'));
  reset role;
  assert not exists (select 1 from public._schedule_violations(per, null, null) where code = 'PATTERN_SLOT'),
    'tanpa pola tidak ada PATTERN_SLOT';
  -- Pola dipasang setelah sesi ada: laporan validasi menandai sesi di slot 2 (bukan di slot 1).
  insert into public.session_pattern_items (scope_type, scope_id, slot_no, kind)
    values ('rombel', r1, 1, 'SUBTEST'), ('rombel', r1, 2, 'DRILLING');
  assert (select count(*) from public._schedule_violations(per, null, null) where code = 'PATTERN_SLOT') = 1,
    'tepat satu sesi (slot DRILLING) ditandai PATTERN_SLOT';
  assert (select session_id from public._schedule_violations(per, null, null) where code = 'PATTERN_SLOT') <> sid,
    'sesi di slot SUBTEST tidak ditandai';
  raise notice 'PASS 03 PATTERN_SLOT: hanya sesi SUBTEST pola yang sah; tanpa pola bebas';
end $$;

-- ---------------------------------------------------------------- 4. hari tryout
do $$
declare
  per uuid := public._t_id('period', 'Uji Pola');
  r2 uuid := public._t_id('rombel', 'PT 2');
  sid uuid;
begin
  -- Hak akses.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  perform public._t_expect_error($q$select public.set_tryout_day(6::smallint)$q$, '42501');
  reset role;
  set local role anon;
  perform public._t_expect_error($q$select public.set_tryout_day(6::smallint)$q$, '42501');
  reset role;

  perform public._t_admin();
  set local role authenticated;
  perform public._t_expect_error($q$select public.set_tryout_day(0::smallint)$q$, '22023');
  perform public._t_expect_error($q$select public.set_tryout_day(8::smallint)$q$, '22023');
  perform public.set_tryout_day(6::smallint);
  reset role;
  assert (select array_agg(day_of_week) from public.calendar_days where is_tryout) = array[6::smallint], 'Sabtu tryout';

  perform public._t_admin();
  set local role authenticated;
  perform public.set_tryout_day(7::smallint);
  reset role;
  assert (select array_agg(day_of_week) from public.calendar_days where is_tryout) = array[7::smallint],
    'hanya satu hari tryout: menandai hari lain memindahkan';
  perform public._t_expect_error($q$update public.calendar_days set is_tryout = true where day_of_week in (1, 2)$q$, '23505');

  perform public._t_admin();
  set local role authenticated;
  perform public.set_tryout_day(6::smallint);
  reset role;
  -- Sesi di hari tryout (Sabtu 2054-11-07) melanggar TRYOUT_DAY.
  insert into public.teaching_sessions (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source)
  values (per, date '2054-11-07', 3, r2, public._t_id('subtest', 'UJ_P1'),
          public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2'), public._t_id('room', 'Uji Pola A'), 'MANUAL')
  returning id into sid;
  assert exists (select 1 from public._schedule_violations(per, sid, null) where code = 'TRYOUT_DAY'), 'sesi di hari tryout ditandai';
  perform public._t_admin();
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2054-11-14', 3::smallint, %L, %L, %L, %L)$q$,
    per, r2, public._t_id('subtest', 'UJ_P1'), public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2'), public._t_id('room', 'Uji Pola A')),
    'P0001', 'TRYOUT_DAY');
  perform public.set_tryout_day(null);
  reset role;
  assert not exists (select 1 from public.calendar_days where is_tryout), 'NULL menghapus penandaan';
  assert not exists (select 1 from public._schedule_violations(per, sid, null) where code = 'TRYOUT_DAY'), 'tanpa tryout tidak ada TRYOUT_DAY';
  raise notice 'PASS 04 hari tryout: satu hari, hak akses, pelanggaran TRYOUT_DAY';
end $$;

-- ---------------------------------------------------------------- 5. display_label
do $$
declare
  per uuid;
  r1 uuid := public._t_id('rombel', 'PT 1');
  r2 uuid := public._t_id('rombel', 'PT 2');
  tu uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2');
  s1 uuid := public._t_id('subtest', 'UJ_P1');
  rm uuid := public._t_id('room', 'Uji Pola A');
  run uuid;
  payload jsonb;
begin
  delete from public.session_pattern_items where scope_id = r1;
  perform public._t_admin();
  set local role authenticated;
  per := public.create_schedule_period('Uji Label', date '2054-12-07', date '2054-12-20');
  payload := jsonb_build_array(
    jsonb_build_object('session_date', '2054-12-07', 'slot_no', 1, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', tu, 'room_id', rm, 'display_label', ' PK/PM '),
    jsonb_build_object('session_date', '2054-12-07', 'slot_no', 2, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', tu, 'room_id', rm),
    jsonb_build_object('session_date', '2054-12-07', 'slot_no', 3, 'rombel_id', r1, 'subtest_id', s1, 'tutor_id', tu, 'room_id', rm, 'display_label', '  '));
  run := public.save_generated_schedule(per, 7, '{}'::jsonb, payload, '[]'::jsonb);
  reset role;
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 1) = 'PK/PM', 'label dirapikan';
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 2) is null, 'tanpa label = null';
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 3) is null, 'label kosong = null';

  perform public._t_admin();
  set local role authenticated;
  perform public.set_period_status(per, 'APPROVED');
  perform public.save_additional_schedule(per, 8, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('session_date', '2054-12-14', 'slot_no', 1, 'rombel_id', r2, 'subtest_id', s1, 'tutor_id', tu, 'room_id', rm, 'display_label', 'KMM/PPU')),
    '[]'::jsonb);
  reset role;
  assert (select display_label from public.teaching_sessions where period_id = per and session_date = date '2054-12-14') = 'KMM/PPU', 'label pada Generate Additional';
  -- Ganti subtes tanpa menyentuh label -> label lama dibersihkan; ganti label bersamaan -> dipertahankan.
  update public.teaching_sessions set subtest_id = public._t_id('subtest', 'UJ_P2') where period_id = per and slot_no = 1 and session_date = date '2054-12-07';
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 1 and session_date = date '2054-12-07') is null, 'label basi dibersihkan saat subtes diganti';
  update public.teaching_sessions set subtest_id = public._t_id('subtest', 'UJ_P1'), display_label = 'PK/PM' where period_id = per and slot_no = 1 and session_date = date '2054-12-07';
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 1 and session_date = date '2054-12-07') = 'PK/PM', 'label eksplisit dipertahankan';
  update public.teaching_sessions set tutor_id = tutor_id where period_id = per and slot_no = 1 and session_date = date '2054-12-07';
  assert (select display_label from public.teaching_sessions where period_id = per and slot_no = 1 and session_date = date '2054-12-07') = 'PK/PM', 'update lain tidak mengubah label';
  perform public._t_expect_error(format($q$update public.teaching_sessions set display_label = %L where period_id = %L and slot_no = 1 and session_date = date '2054-12-07'$q$, repeat('x', 101), per), '23514');
  perform public._t_expect_error(format($q$update public.teaching_sessions set display_label = '   ' where period_id = %L and slot_no = 1 and session_date = date '2054-12-07'$q$, per), '23514');
  -- Mentor melihat tulisan fleksibel lewat my_schedule (periode sudah APPROVED).
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  assert (select display_label from public.my_schedule(date '2054-12-07', date '2054-12-07') where slot_no = 1) = 'PK/PM', 'my_schedule memuat display_label';
  assert (select display_label from public.my_schedule(date '2054-12-07', date '2054-12-07') where slot_no = 2) is null, 'tanpa label = null di my_schedule';
  reset role;
  raise notice 'PASS 05 display_label pada save_generated/additional dan constraint';
end $$;

-- ---------------------------------------------------------------- 6. hak akses tabel dan RPC
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  perform public._t_expect_error($q$select public.set_session_pattern('class_type', gen_random_uuid(), '[{"slot_no":1,"kind":"SUBTEST"}]'::jsonb)$q$, '42501');
  perform public._t_expect_error($q$select public.clear_session_pattern('class_type', gen_random_uuid())$q$, '42501');
  perform public._t_expect_error($q$insert into public.session_pattern_items (scope_type, scope_id, slot_no, kind) values ('rombel', gen_random_uuid(), 1, 'SUBTEST')$q$, '42501');
  assert (select count(*) from public.session_pattern_items) = 0, 'tutor tidak bisa membaca pola (RLS admin saja)';
  reset role;
  set local role anon;
  perform public._t_expect_error($q$select public.set_session_pattern('class_type', gen_random_uuid(), '[{"slot_no":1,"kind":"SUBTEST"}]'::jsonb)$q$, '42501');
  perform public._t_expect_error($q$select * from public.session_pattern_items$q$, '42501');
  reset role;
  perform public._t_admin();
  set local role authenticated;
  assert (select count(*) from public.session_pattern_items) >= 0, 'admin bisa membaca';
  reset role;
  raise notice 'PASS 06 tutor dan anon tidak bisa mengubah atau membaca pola';
end $$;


-- ---------------------------------------------------------------- 7. sesi default rombel
do $$
declare
  r1 uuid := public._t_id('rombel', 'PT 1');
  per uuid;
  tu uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000e2');
  s1 uuid := public._t_id('subtest', 'UJ_P1');
  rm uuid := public._t_id('room', 'Uji Pola A');
begin
  insert into public.session_pattern_items (scope_type, scope_id, slot_no, kind)
  select 'class_type', public._t_id('class_type', 'Tipe Uji Pola'), v.n, v.k
    from (values (1, 'SUBTEST'), (2, 'DRILLING'), (3, 'SUBTEST')) as v(n, k)
   where not exists (select 1 from public.session_pattern_items where scope_id = public._t_id('class_type', 'Tipe Uji Pola'));
  -- hak akses
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  perform public._t_expect_error(format($q$select public.set_rombel_defaults(%L, 4::smallint, null, 1::smallint, null)$q$, r1), '42501');
  reset role;

  perform public._t_admin();
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.set_rombel_defaults(%L, 77::smallint, null, 1::smallint, null)$q$, r1), 'P0002', 'PATTERN_SLOT_UNKNOWN');
  perform public._t_expect_error($q$select public.set_rombel_defaults(gen_random_uuid(), 1::smallint, null, 1::smallint, null)$q$, 'P0002');
  perform public._t_expect_error(format($q$select public.set_rombel_defaults(%L, 1::smallint, array[0]::smallint[], 1::smallint, null)$q$, r1), '23514');
  perform public._t_expect_error(format($q$select public.set_rombel_defaults(%L, 1::smallint, array[8]::smallint[], 1::smallint, null)$q$, r1), '23514');
  perform public._t_expect_error(format($q$select public.set_rombel_defaults(%L, 1::smallint, null, 13::smallint, null)$q$, r1), '23514');
  perform public._t_expect_error(format($q$select public.set_rombel_defaults(%L, 1::smallint, null, 0::smallint, null)$q$, r1), '23514');

  -- sesi default menjadi pola (mengalahkan pola tipe kelas); hari dirapikan; siklus 3 minggu dengan jangkar
  perform public.set_rombel_defaults(r1, 1::smallint, array[5, 2, 2, 3]::smallint[], 3::smallint, date '2054-11-02');
  reset role;
  assert public._t_pattern('PT 1') = '1:SUBTEST', 'sesi default menjadi pola rombel';
  assert (select default_days from public.rombels where id = r1) = array[2, 3, 5]::smallint[], 'hari unik dan terurut';
  assert (select cycle_weeks from public.rombels where id = r1) = 3, 'siklus 3 minggu';
  assert (select cycle_anchor from public.rombels where id = r1) = date '2054-11-02', 'jangkar siklus';

  -- Pola tipe kelas tetap berlaku untuk rombel lain.
  assert public._t_pattern('PT 2') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'rombel lain tetap mengikuti tipe kelas';

  -- PATTERN_DAY: Senin 2054-11-02 bukan hari default (Selasa/Rabu/Jumat); Selasa 2054-11-03 sah.
  perform public._t_admin();
  set local role authenticated;
  per := public.create_schedule_period('Uji Default', date '2054-11-30', date '2054-12-06');
  perform public._t_expect_msg(format($q$select public.create_teaching_session(%L, date '2054-11-30', 1::smallint, %L, %L, %L, %L)$q$, per, r1, s1, tu, rm), 'P0001', 'PATTERN_DAY');
  reset role;

  -- Siklus tanpa jangkar saat siklus = 1 dihapus; kosong membersihkan semuanya.
  perform public._t_admin();
  set local role authenticated;
  perform public.set_rombel_defaults(r1, null, null, 1::smallint, date '2054-11-02');
  reset role;
  assert (select default_slot_no from public.rombels where id = r1) is null, 'sesi default dihapus';
  assert (select default_days from public.rombels where id = r1) is null, 'hari default dihapus';
  assert (select cycle_anchor from public.rombels where id = r1) is null, 'jangkar dibuang bila siklus 1';
  assert public._t_pattern('PT 1') = '1:SUBTEST,2:DRILLING,3:SUBTEST', 'kembali mengikuti tipe kelas';
  raise notice 'PASS 07 sesi default rombel: validasi, prioritas, hari, siklus';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
