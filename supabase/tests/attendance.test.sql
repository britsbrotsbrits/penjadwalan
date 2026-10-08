-- Tes presensi (Phase 13): submit_attendance, admin_*, bacaan mentor, hak akses: set_period_status, tabel transisi,
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
language plpgsql security definer as $$
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




create function public._t_as(p_uuid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uuid), true);
end $$;

-- Data: periode Approved jauh di masa depan (tidak bentrok dengan data nyata); sesi hari ini disisipkan langsung.
do $$
declare
  p uuid; pg uuid;
  a uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a2');
  b uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a3');
  s1 uuid := public._t_id('subtest', 'UJ_M1');
  ra uuid := public._t_id('room', 'Uji Mentor A');
  rb uuid := public._t_id('room', 'Uji Mentor B');
  r1 uuid := public._t_id('rombel', 'MT 1');
  r2 uuid := public._t_id('rombel', 'MT 2');
  r3 uuid := public._t_id('rombel', 'MT 3');
  rc uuid := public._t_id('room', 'Uji Mentor C');
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  insert into public.schedule_periods (name, start_date, end_date, status) values ('Uji Presensi', date '2056-01-05', date '2056-01-18', 'APPROVED') returning id into p;
  insert into public.schedule_periods (name, start_date, end_date, status) values ('Uji Presensi Draft', date '2056-03-02', date '2056-03-15', 'GENERATED') returning id into pg;
  -- s1: slot 1 milik A; s2: slot 1 milik B; s3: slot 2 milik A; s4: besok milik A; s5: periode Generated (milik B); s6: dibatalkan
  insert into public.teaching_sessions (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source) values
    (p, today, 1, r1, s1, a, ra, 'MANUAL'),
    (p, today, 1, r2, s1, b, rb, 'MANUAL'),
    (p, today, 2, r1, s1, a, ra, 'MANUAL'),
    (p, today + 1, 1, r1, s1, a, ra, 'MANUAL'),
    (pg, today, 2, r3, s1, b, rc, 'MANUAL');
  insert into public.teaching_sessions (period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source, status)
    values (p, today, 1, r3, s1, a, rc, 'MANUAL', 'CANCELLED');
end $$;

create function public._t_sess(p_slot int, p_tutor text, p_period text default 'Uji Presensi', p_offset int default 0) returns uuid
language sql stable as $$
  select ts.id from public.teaching_sessions ts join public.schedule_periods sp on sp.id = ts.period_id
   where sp.name = p_period and ts.slot_no = p_slot and ts.session_date = (now() at time zone 'Asia/Jakarta')::date + p_offset
     and ts.tutor_id = public._t_id('tutor', p_tutor) and ts.status = 'SCHEDULED' limit 1
$$ security definer;

-- 1. HADIR: sesi sendiri hari ini
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
  aid uuid;
begin
  perform public._t_as(A);
  set local role authenticated;
  aid := public.submit_attendance(public._t_sess(1, A), 'HADIR');
  reset role;
  assert (select status from public.attendance where id = aid) = 'HADIR', 'status HADIR';
  assert (select slot_no from public.attendance where id = aid) = 1 and (select session_date from public.attendance where id = aid) = (now() at time zone 'Asia/Jakarta')::date, 'tanggal/sesi disalin dari sesi';
  assert (select other_tutor_id from public.attendance where id = aid) is null, 'HADIR tanpa mentor lawan';
  assert (select tutor_id from public.attendance where id = aid) = public._t_id('tutor', A), 'mentor = pengirim';
  raise notice 'PASS 01 HADIR pada sesi sendiri';
end $$;

-- 2. validasi masukan dan kepemilikan
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
  B text := '00000000-0000-0000-0000-0000000000a3';
  sB uuid := public._t_sess(1, B);
  sA2 uuid := public._t_sess(2, A);
begin
  perform public._t_as(A);
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, sB), 'P0001', 'ATT_NOT_YOUR_SESSION');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR', %L)$q$, sA2, public._t_id('tutor', B)), '22023', 'ATT_OTHER_NOT_ALLOWED');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'TUKAR')$q$, sB), '22023', 'ATT_OTHER_REQUIRED');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'MENGGANTIKAN', %L)$q$, sB, public._t_id('tutor', A)), '22023', 'ATT_OTHER_INVALID');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'MENGGANTIKAN', %L)$q$, sB, gen_random_uuid()), '22023', 'ATT_OTHER_INVALID');
  perform public._t_expect_error(format($q$select public.submit_attendance(%L, 'NGAWUR')$q$, sB), '22023');
  perform public._t_expect_error(format($q$select public.submit_attendance(%L, null)$q$, sB), '22023');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, gen_random_uuid()), 'P0002', 'ATT_SESSION_NOT_FOUND');
  reset role;
  assert (select count(*) from public.attendance) = 1, 'penolakan tidak menyisakan catatan';
  raise notice 'PASS 02 validasi: bukan sesi sendiri, lawan wajib/valid, status valid, sesi ada';
end $$;

-- 3. TUKAR dan MENGGANTIKAN pada sesi mentor lain, satu catatan per sesi
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
  B text := '00000000-0000-0000-0000-0000000000a3';
  sB uuid := public._t_sess(1, B);
  sA2 uuid := public._t_sess(2, A);
begin
  -- A mengajar sesi slot 2 miliknya sebagai MENGGANTIKAN? A hadir di slot 1 (sesi 1 miliknya sudah), jadi A tidak bisa ambil sesi B slot 1 (bentrok mentor).
  perform public._t_as(A);
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'TUKAR', %L)$q$, sB, public._t_id('tutor', B)), '23505', 'attendance_tutor_slot_key');
  reset role;

  -- B mengajar sesi A di slot 2 (MENGGANTIKAN A), lalu sesi itu tidak bisa dicatat lagi.
  perform public._t_as(B);
  set local role authenticated;
  perform public.submit_attendance(sA2, 'MENGGANTIKAN', public._t_id('tutor', A));
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, sA2), 'P0001', 'ATT_NOT_YOUR_SESSION');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'TUKAR', %L)$q$, sA2, public._t_id('tutor', A)), '23505', 'ATT_ALREADY:MENGGANTIKAN');
  reset role;
  assert (select count(*) from public.attendance where session_id = sA2 and tutor_id = public._t_id('tutor', B) and status = 'MENGGANTIKAN') = 1, 'pengganti tercatat';
  assert (select other_tutor_id from public.attendance where session_id = sA2) = public._t_id('tutor', A), 'lawan tercatat';
  raise notice 'PASS 03 TUKAR/MENGGANTIKAN pada sesi mentor lain; satu catatan per sesi; mentor tidak bisa dobel di slot yang sama';
end $$;

-- 4. waktu, periode, dan sesi dibatalkan
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
begin
  perform public._t_as(A);
  set local role authenticated;
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, public._t_sess(1, A, 'Uji Presensi', 1)), '55000', 'ATT_NOT_TODAY');
  perform public._t_as('00000000-0000-0000-0000-0000000000a3');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, public._t_sess(2, '00000000-0000-0000-0000-0000000000a3', 'Uji Presensi Draft')), '55000', 'ATT_PERIOD_NOT_FINAL');
  perform public._t_expect_msg(format($q$select public.submit_attendance(%L, 'HADIR')$q$, (select ts.id from public.teaching_sessions ts where ts.status = 'CANCELLED' limit 1)), 'P0002', 'ATT_SESSION_NOT_FOUND');
  reset role;
  raise notice 'PASS 04 hanya hari ini, hanya periode Approved/Locked, sesi dibatalkan ditolak';
end $$;

-- 5. bacaan mentor dan penulisan langsung
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
  B text := '00000000-0000-0000-0000-0000000000a3';
  n integer;
begin
  perform public._t_as(A);
  set local role authenticated;
  select count(*) into n from public.attendance_today();
  assert n = 3, format('attendance_today: 3 sesi hari ini di periode final (dapat %s)', n);
  assert (select count(*) from public.attendance_today() where attendance_status is not null) = 2, 'dua sesi sudah tercatat';
  assert (select attendance_tutor_name from public.attendance_today() where slot_no = 2) is not null, 'nama pengajar tercatat';
  assert (select count(*) from public.attendance) = 1, 'mentor A hanya melihat catatannya sendiri di tabel';
  assert (select count(*) from public.my_attendance((now() at time zone 'Asia/Jakarta')::date - 3, (now() at time zone 'Asia/Jakarta')::date + 3)) = 1, 'my_attendance milik sendiri';
  perform public._t_expect_error($q$select * from public.my_attendance(date '2056-12-31', date '2056-01-01')$q$, '22023');
  perform public._t_expect_error($q$insert into public.attendance (session_id, tutor_id, status, session_date, slot_no) select id, tutor_id, 'HADIR', session_date, slot_no from public.teaching_sessions limit 1$q$, '42501');
  perform public._t_expect_error($q$update public.attendance set status = 'HADIR'$q$, '42501');
  perform public._t_expect_error($q$delete from public.attendance$q$, '42501');
  assert (select count(*) from public.tutor_names()) >= 2, 'tutor_names untuk mentor';
  reset role;

  perform public._t_as(B);
  set local role authenticated;
  assert (select count(*) from public.attendance) = 1, 'mentor B hanya melihat catatannya sendiri';
  assert (select count(*) from public.my_attendance((now() at time zone 'Asia/Jakarta')::date - 3, (now() at time zone 'Asia/Jakarta')::date + 3)) = 1, 'my_attendance B';
  reset role;
  raise notice 'PASS 05 mentor membaca lewat fungsi, tabel hanya milik sendiri, tulis langsung ditolak';
end $$;

-- 6. admin
do $$
declare
  ADM text := '00000000-0000-0000-0000-0000000000a1';
  A text := '00000000-0000-0000-0000-0000000000a2';
  B text := '00000000-0000-0000-0000-0000000000a3';
  sB uuid := public._t_sess(1, B);
  sTom uuid := public._t_sess(1, A, 'Uji Presensi', 1);
  id1 uuid; n integer;
begin
  perform public._t_as(ADM);
  set local role authenticated;
  -- sesi besok: admin boleh mencatat kapan saja
  id1 := public.admin_set_attendance(sTom, public._t_id('tutor', B), 'MENGGANTIKAN', public._t_id('tutor', A), '  dicatat admin  ');
  assert (select edit_note from public.attendance where id = id1) = 'dicatat admin', 'catatan di-trim';
  assert (select edited_by from public.attendance where id = id1) is not null, 'edited_by terisi';
  -- ubah (upsert pada sesi yang sama): id tetap, isi berganti
  assert public.admin_set_attendance(sTom, public._t_id('tutor', A), 'HADIR', null, 'koreksi') = id1, 'upsert mempertahankan id';
  assert (select status from public.attendance where id = id1) = 'HADIR' and (select other_tutor_id from public.attendance where id = id1) is null, 'berubah ke HADIR';
  -- validasi
  perform public._t_expect_msg(format($q$select public.admin_set_attendance(%L, %L, 'TUKAR', null)$q$, sTom, public._t_id('tutor', A)), '22023', 'ATT_OTHER_REQUIRED');
  perform public._t_expect_msg(format($q$select public.admin_set_attendance(%L, %L, 'HADIR', %L)$q$, sTom, public._t_id('tutor', A), public._t_id('tutor', B)), '22023', 'ATT_OTHER_NOT_ALLOWED');
  perform public._t_expect_msg(format($q$select public.admin_set_attendance(%L, %L, 'TUKAR', %L)$q$, sTom, public._t_id('tutor', A), public._t_id('tutor', A)), '22023', 'ATT_OTHER_INVALID');
  perform public._t_expect_error(format($q$select public.admin_set_attendance(%L, %L, 'NGAWUR')$q$, sTom, public._t_id('tutor', A)), '22023');
  perform public._t_expect_error(format($q$select public.admin_set_attendance(%L, gen_random_uuid(), 'HADIR')$q$, sTom), 'P0002');
  perform public._t_expect_error(format($q$select public.admin_set_attendance(gen_random_uuid(), %L, 'HADIR')$q$, public._t_id('tutor', A)), 'P0002');
  perform public._t_expect_error(format($q$select public.admin_set_attendance(%L, %L, 'HADIR', null, %L)$q$, sTom, public._t_id('tutor', A), repeat('x', 501)), '22023');
  -- bentrok mentor di slot sama
  perform public._t_expect_msg(format($q$select public.admin_set_attendance(%L, %L, 'MENGGANTIKAN', %L)$q$, sB, public._t_id('tutor', A), public._t_id('tutor', B)), '23505', 'attendance_tutor_slot_key');
  -- admin membaca semua
  assert (select count(*) from public.attendance) = 3, 'admin membaca semua catatan';
  -- hapus
  perform public.admin_delete_attendance(id1);
  perform public._t_expect_error(format($q$select public.admin_delete_attendance(%L)$q$, id1), 'P0002');
  assert (select count(*) from public.attendance) = 2, 'terhapus';
  -- admin bukan mentor tidak bisa submit sebagai mentor; tidak punya akses my_attendance
  perform public._t_expect_error(format($q$select public.submit_attendance(%L, 'HADIR')$q$, sB), '42501');
  perform public._t_expect_error($q$select * from public.attendance_today()$q$, '42501');
  assert (select count(*) from public.tutor_names()) >= 2, 'tutor_names untuk admin';
  reset role;
  raise notice 'PASS 06 admin: tambah/ubah/hapus, validasi, bentrok mentor ditolak, tidak bisa submit sebagai mentor';
end $$;

-- 7. anon dan mentor tidak bisa memakai fungsi admin
do $$
declare
  A text := '00000000-0000-0000-0000-0000000000a2';
  s uuid := public._t_sess(1, A);
  a_id uuid := (select id from public.attendance limit 1);
begin
  perform public._t_as(A);
  set local role authenticated;
  perform public._t_expect_error(format($q$select public.admin_set_attendance(%L, %L, 'HADIR')$q$, s, public._t_id('tutor', A)), '42501');
  perform public._t_expect_error(format($q$select public.admin_delete_attendance(%L)$q$, a_id), '42501');
  reset role;
  set local role anon;
  perform public._t_expect_error(format($q$select public.submit_attendance(%L, 'HADIR')$q$, s), '42501');
  perform public._t_expect_error($q$select * from public.attendance_today()$q$, '42501');
  perform public._t_expect_error($q$select * from public.tutor_names()$q$, '42501');
  perform public._t_expect_error($q$select * from public.attendance$q$, '42501');
  reset role;
  assert (select count(*) from public.attendance) = 2, 'tidak ada perubahan oleh mentor/anon';
  raise notice 'PASS 07 mentor tidak bisa memakai fungsi admin; anon ditolak di semua jalur';
end $$;

-- 8. constraint tabel sebagai pengaman terakhir (di luar fungsi)
do $$
declare
  sid uuid := (select id from public.teaching_sessions where status = 'SCHEDULED' limit 1);
  a uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a2');
  b uuid := public._t_id('tutor', '00000000-0000-0000-0000-0000000000a3');
begin
  delete from public.attendance;
  perform public._t_expect_error(format($q$insert into public.attendance (session_id, tutor_id, status, other_tutor_id, session_date, slot_no) values (%L, %L, 'HADIR', %L, current_date, 1)$q$, sid, a, b), '23514');
  perform public._t_expect_error(format($q$insert into public.attendance (session_id, tutor_id, status, session_date, slot_no) values (%L, %L, 'TUKAR', current_date, 1)$q$, sid, a), '23514');
  perform public._t_expect_error(format($q$insert into public.attendance (session_id, tutor_id, status, other_tutor_id, session_date, slot_no) values (%L, %L, 'MENGGANTIKAN', %L, current_date, 1)$q$, sid, a, a), '23514');
  perform public._t_expect_error(format($q$insert into public.attendance (session_id, tutor_id, status, session_date, slot_no) values (%L, %L, 'ABSEN', current_date, 1)$q$, sid, a), '23514');
  raise notice 'PASS 08 constraint tabel: aturan lawan dan status ditegakkan walau lewat jalur lain';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
