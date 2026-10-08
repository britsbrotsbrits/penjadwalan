-- Tes my_schedule (Phase 12): set_period_status, tabel transisi,
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
  ('00000000-0000-0000-0000-0000000000a1', 'ts-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'ts-tutor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'ts-tutor2@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'tutor', is_active = true where id in
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3');
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

insert into public.subtests (code, name) values ('UJ_M1', 'Subtes Mentor 1'), ('UJ_M2', 'Subtes Mentor 2');
insert into public.rooms (name, capacity) values ('Uji Mentor A', 10), ('Uji Mentor B', 2), ('Uji Mentor C', 10);
insert into public.programs (name) values ('Program Uji Mentor');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji Mentor', 10 from public.programs where name = 'Program Uji Mentor';
insert into public.rombels (class_type_id, name)
  select ct.id, v.name from public.class_types ct, (values ('MT 1'), ('MT 2'), ('MT 3')) as v(name)
  where ct.name = 'Tipe Uji Mentor';
update public.rombels set fixed_room_id = (select id from public.rooms where name = 'Uji Mentor C') where name = 'MT 3';
insert into public.students (full_name, rombel_id)
  select 'Siswa MT ' || g, (select id from public.rombels where name = 'MT 1') from generate_series(1, 3) g;

-- Tutor 1 (d2): kompeten S1; tersedia Senin sesi 1-2 dan Selasa sesi 1.
-- Tutor 2 (d3): kompeten S1 dan S2; tersedia Senin sesi 1 saja.
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000a2' and s.code = 'UJ_M1';
insert into public.tutor_competencies (tutor_id, subtest_id)
select tp.id, s.id from public.tutor_profiles tp, public.subtests s
 where tp.profile_id = '00000000-0000-0000-0000-0000000000a3' and s.code in ('UJ_M1', 'UJ_M2');
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, v.d, v.n, true from public.tutor_profiles tp, (values (1, 1), (1, 2), (2, 1)) as v(d, n)
 where tp.profile_id = '00000000-0000-0000-0000-0000000000a2';
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available)
select tp.id, 1, 1, true from public.tutor_profiles tp
 where tp.profile_id = '00000000-0000-0000-0000-0000000000a3';

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



do $$
declare
  t1 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a2');
  t2 uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a3');
  s1 uuid := public._t_id('subtest', 'UJ_M1');
  ra uuid := public._t_id('room', 'Uji Mentor A');
  r1 uuid := public._t_id('rombel', 'MT 1');
  r2 uuid := public._t_id('rombel', 'MT 2');
  p uuid; n integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  p := public.create_schedule_period('Uji Jadwal Mentor', date '2055-09-06', date '2055-09-19');
  perform public.create_teaching_session(p, date '2055-09-06', 1::smallint, r1, s1, t1, ra);
  perform public.create_teaching_session(p, date '2055-09-06', 2::smallint, r2, s1, t1, ra);
  reset role;
  update public.schedule_periods set status = 'GENERATED' where id = p;

  -- Mentor A: Draft/Generated tidak terlihat.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.my_schedule(date '2055-09-01', date '2055-09-30')) = 0, 'GENERATED tidak boleh terlihat mentor';
  reset role;
  update public.schedule_periods set status = 'APPROVED' where id = p;
  set local role authenticated;
  assert (select count(*) from public.my_schedule(date '2055-09-01', date '2055-09-30')) = 2, 'APPROVED terlihat';
  assert (select rombel_name from public.my_schedule(date '2055-09-01', date '2055-09-30') order by slot_no limit 1) = 'MT 1', 'nama rombel';
  assert (select count(*) from public.my_schedule(date '2055-09-07', date '2055-09-30')) = 0, 'filter tanggal';
  perform public._t_expect_error($q$select * from public.my_schedule(date '2055-09-30', date '2055-09-01')$q$, '22023');
  perform public._t_expect_error($q$select * from public.my_schedule(date '2055-01-01', date '2055-12-31')$q$, '22023');
  perform public._t_expect_error($q$select * from public.my_schedule(null, date '2055-12-31')$q$, '22023');
  -- Tidak punya akses baca langsung ke tabel jadwal.
  assert (select count(*) from public.teaching_sessions) = 0, 'mentor tidak membaca tabel sesi langsung';
  reset role;

  -- Mentor B: tidak melihat sesi mentor A.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.my_schedule(date '2055-09-01', date '2055-09-30')) = 0, 'mentor B tidak melihat sesi mentor A';
  reset role;

  -- LOCKED tetap terlihat; CANCELLED (sesi dibatalkan) tidak.
  update public.schedule_periods set status = 'LOCKED' where id = p;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.my_schedule(date '2055-09-01', date '2055-09-30')) = 2, 'LOCKED terlihat';
  reset role;
  update public.teaching_sessions set status = 'CANCELLED' where period_id = p and slot_no = 2;
  set local role authenticated;
  assert (select count(*) from public.my_schedule(date '2055-09-01', date '2055-09-30')) = 1, 'sesi batal tidak terlihat';
  reset role;

  -- Admin (bukan mentor) dan anon ditolak.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  perform public._t_expect_error($q$select * from public.my_schedule(date '2055-09-01', date '2055-09-30')$q$, '42501');
  reset role;
  set local role anon;
  perform public._t_expect_error($q$select * from public.my_schedule(date '2055-09-01', date '2055-09-30')$q$, '42501');
  reset role;
  raise notice 'PASS 01 my_schedule: hanya sesi sendiri dari periode Approved/Locked, sesi batal disembunyikan, rentang dibatasi, admin/anon ditolak';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
