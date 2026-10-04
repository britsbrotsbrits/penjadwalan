-- Tes RLS dan constraint untuk master data (Phase 3):
-- subtests, rooms, session_slots, calendar_days, set_active_days().
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat
-- psql sebagai role postgres. Semua perubahan di-ROLLBACK di akhir, termasuk data master yang
-- sudah ada (tes mengosongkan session_slots SEMENTARA agar hasilnya tidak bergantung isi database).
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
-- Gagal = EXCEPTION dengan pesan kasus yang gagal.
--
-- Syarat: migrasi Phase 2 dan Phase 3 sudah dijalankan.

begin;

-- Helper sementara (hilang saat rollback). Berjalan dengan hak pemanggil, jadi RLS/grant ikut diuji.
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

create function public._t_rowcount(p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixture user: admin, tutor aktif, tutor nonaktif.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'md-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'md-tutor@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', 'md-inactive@test.local', '{}');
update public.profiles set role = 'admin', is_active = true
  where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set is_active = true
  where id = '00000000-0000-0000-0000-0000000000f2';

-- Isolasi data master (konteks tepercaya): slot dikosongkan, hari aktif dibuat diketahui.
delete from public.session_slots;
update public.calendar_days set is_active = (day_of_week between 1 and 6);
insert into public.subtests (code, name) values ('TST1', 'Subtes Uji 1'), ('TST2', 'Subtes Uji 2');
insert into public.rooms (name, capacity) values ('Ruang Uji 1', 10);
insert into public.session_slots (slot_no, start_time, duration_minutes) values
  (1, '07:00', 90), (2, '08:30', 90);

-- ---------------------------------------------------------------- anon
do $$
begin
  set local role anon;
  perform public._t_expect_error('select * from public.subtests', '42501');
  perform public._t_expect_error('select * from public.rooms', '42501');
  perform public._t_expect_error('select * from public.session_slots', '42501');
  perform public._t_expect_error('select * from public.calendar_days', '42501');
  perform public._t_expect_error('select public.set_active_days(array[1,2]::smallint[])', '42501');
  reset role;
  raise notice 'PASS 01 anon ditolak membaca 4 tabel dan memanggil set_active_days';
end $$;

-- ---------------------------------------------------------------- user nonaktif
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.subtests) = 0, 'user nonaktif tidak boleh melihat subtests';
  assert (select count(*) from public.rooms) = 0, 'user nonaktif tidak boleh melihat rooms';
  assert (select count(*) from public.session_slots) = 0, 'user nonaktif tidak boleh melihat session_slots';
  assert (select count(*) from public.calendar_days) = 0, 'user nonaktif tidak boleh melihat calendar_days';
  perform public._t_expect_error(
    $q$insert into public.subtests (code, name) values ('TSTX', 'x')$q$, '42501');
  reset role;
  raise notice 'PASS 02 user nonaktif tidak melihat dan tidak menulis apa pun';
end $$;

-- ---------------------------------------------------------------- tutor aktif
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;

  assert (select count(*) from public.subtests where code = 'TST1') = 1, 'tutor harus bisa membaca subtests';
  assert (select count(*) from public.rooms where name = 'Ruang Uji 1') = 1, 'tutor harus bisa membaca rooms';
  assert (select count(*) from public.session_slots) = 2, 'tutor harus bisa membaca session_slots';
  assert (select count(*) from public.calendar_days) = 7, 'tutor harus bisa membaca calendar_days';
  raise notice 'PASS 03 tutor aktif boleh membaca semua master data';

  perform public._t_expect_error(
    $q$insert into public.subtests (code, name) values ('TSTX', 'x')$q$, '42501');
  perform public._t_expect_error(
    $q$insert into public.rooms (name, capacity) values ('Ruang X', 5)$q$, '42501');
  perform public._t_expect_error(
    $q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (50, '12:00', 60)$q$, '42501');
  perform public._t_expect_error(
    $q$insert into public.calendar_days (day_of_week, is_active) values (8, true)$q$, '42501');
  raise notice 'PASS 04 tutor tidak bisa INSERT';

  assert public._t_rowcount($q$update public.subtests set name = 'Diretas' where code = 'TST1'$q$) = 0,
    'tutor tidak boleh UPDATE subtests';
  assert public._t_rowcount($q$update public.rooms set capacity = 1$q$) = 0,
    'tutor tidak boleh UPDATE rooms';
  assert public._t_rowcount($q$update public.session_slots set duration_minutes = 15$q$) = 0,
    'tutor tidak boleh UPDATE session_slots';
  assert public._t_rowcount($q$update public.calendar_days set is_active = false$q$) = 0,
    'tutor tidak boleh UPDATE calendar_days';
  raise notice 'PASS 05 tutor tidak bisa UPDATE (0 baris terpengaruh)';

  perform public._t_expect_error($q$delete from public.subtests where code = 'TST1'$q$, '42501');
  perform public._t_expect_error($q$delete from public.rooms$q$, '42501');
  perform public._t_expect_error($q$delete from public.session_slots$q$, '42501');
  perform public._t_expect_error($q$delete from public.calendar_days$q$, '42501');
  raise notice 'PASS 06 tutor tidak bisa DELETE';

  perform public._t_expect_error($q$select public.set_active_days(array[1]::smallint[])$q$, '42501');
  reset role;
  assert (select count(*) from public.calendar_days where is_active) = 6, 'hari aktif tidak boleh berubah oleh tutor';
  raise notice 'PASS 07 tutor tidak bisa mengubah hari aktif lewat set_active_days';
end $$;

-- ---------------------------------------------------------------- admin
do $$
declare
  active_days smallint[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
  set local role authenticated;

  -- Baca + tulis dasar
  assert (select count(*) from public.session_slots) = 2, 'admin harus bisa membaca';
  insert into public.subtests (code, name, sort_order) values ('TST3', 'Subtes Uji 3', 3);
  insert into public.rooms (name, capacity) values ('Ruang Uji 2', 20);
  insert into public.session_slots (slot_no, start_time, duration_minutes) values (3, '10:00', 90);
  raise notice 'PASS 08 admin boleh INSERT';

  assert public._t_rowcount($q$update public.subtests set name = 'Subtes Uji 3b', is_active = false where code = 'TST3'$q$) = 1,
    'admin boleh UPDATE subtests';
  assert public._t_rowcount($q$update public.rooms set capacity = 25 where name = 'Ruang Uji 2'$q$) = 1,
    'admin boleh UPDATE rooms';
  assert public._t_rowcount($q$update public.session_slots set duration_minutes = 60 where slot_no = 3$q$) = 1,
    'admin boleh UPDATE session_slots';
  assert public._t_rowcount($q$update public.calendar_days set is_active = false where day_of_week = 6$q$) = 1,
    'admin boleh UPDATE calendar_days';
  update public.calendar_days set is_active = true where day_of_week = 6;
  raise notice 'PASS 09 admin boleh UPDATE';

  perform public._t_expect_error($q$delete from public.subtests where code = 'TST3'$q$, '42501');
  perform public._t_expect_error($q$delete from public.rooms where name = 'Ruang Uji 2'$q$, '42501');
  perform public._t_expect_error($q$delete from public.session_slots where slot_no = 3$q$, '42501');
  perform public._t_expect_error($q$delete from public.calendar_days where day_of_week = 7$q$, '42501');
  raise notice 'PASS 10 admin tidak bisa DELETE (soft delete lewat is_active)';

  perform public._t_expect_error($q$update public.subtests set id = gen_random_uuid() where code = 'TST3'$q$, '42501');
  perform public._t_expect_error($q$update public.rooms set created_at = now() where name = 'Ruang Uji 2'$q$, '42501');
  perform public._t_expect_error($q$update public.calendar_days set day_of_week = 9 where day_of_week = 7$q$, '42501');
  perform public._t_expect_error($q$insert into public.calendar_days (day_of_week, is_active) values (8, true)$q$, '42501');
  raise notice 'PASS 11 kolom id/created_at/day_of_week tidak bisa diubah, calendar_days tidak bisa INSERT';

  -- subtests: constraint
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('huruf_kecil', 'A')$q$, '23514');
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('ADA SPASI', 'A')$q$, '23514');
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('', 'A')$q$, '23514');
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('TST9', '   ')$q$, '23514');
  perform public._t_expect_error($q$insert into public.subtests (code, name, sort_order) values ('TST9', 'A', 10000)$q$, '23514');
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('TST1', 'Nama Lain')$q$, '23505');
  perform public._t_expect_error($q$insert into public.subtests (code, name) values ('TST9', '  subtes UJI 1 ')$q$, '23505');
  raise notice 'PASS 12 subtests: format kode, nama kosong, urutan, kode ganda, nama ganda (tanpa beda huruf besar/spasi)';

  -- rooms: constraint
  perform public._t_expect_error($q$insert into public.rooms (name, capacity) values ('R0', 0)$q$, '23514');
  perform public._t_expect_error($q$insert into public.rooms (name, capacity) values ('R501', 501)$q$, '23514');
  perform public._t_expect_error($q$insert into public.rooms (name, capacity) values ('   ', 5)$q$, '23514');
  perform public._t_expect_error($q$insert into public.rooms (name, capacity) values (' ruang UJI 1 ', 5)$q$, '23505');
  raise notice 'PASS 13 rooms: kapasitas 1..500, nama kosong, nama ganda (tanpa beda huruf besar/spasi)';

  -- session_slots: constraint
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (0, '20:00', 60)$q$, '23514');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '20:00', 10)$q$, '23514');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '20:00', 481)$q$, '23514');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '23:00', 90)$q$, '23514');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '20:00:30', 60)$q$, '23514');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (1, '20:00', 60)$q$, '23505');
  raise notice 'PASS 14 session_slots: nomor, durasi 15..480, tidak lewat tengah malam, detik nol, nomor ganda';

  -- session_slots: tumpang tindih (slot 1 = 07:00-08:30, 2 = 08:30-10:00, 3 = 10:00-11:00 setelah update)
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '07:30', 60)$q$, '23P01');
  perform public._t_expect_error($q$insert into public.session_slots (slot_no, start_time, duration_minutes) values (20, '06:00', 90)$q$, '23P01');
  insert into public.session_slots (slot_no, start_time, duration_minutes) values (21, '11:00', 60);
  raise notice 'PASS 15 slot aktif tidak boleh tumpang tindih, slot bersebelahan boleh';

  insert into public.session_slots (slot_no, start_time, duration_minutes, is_active)
    values (22, '07:30', 60, false);
  perform public._t_expect_error($q$update public.session_slots set is_active = true where slot_no = 22$q$, '23P01');
  raise notice 'PASS 16 slot nonaktif boleh tumpang tindih, tetapi tidak bisa diaktifkan kembali bila bentrok';

  -- set_active_days
  perform public.set_active_days(array[1, 3, 5]::smallint[]);
  select array_agg(day_of_week order by day_of_week) into active_days
    from public.calendar_days where is_active;
  assert active_days = array[1, 3, 5]::smallint[], format('hari aktif harus {1,3,5}, dapat %s', active_days);
  perform public._t_expect_error($q$select public.set_active_days(array[]::smallint[])$q$, '23514');
  perform public._t_expect_error($q$select public.set_active_days(null)$q$, '23514');
  perform public._t_expect_error($q$select public.set_active_days(array[9]::smallint[])$q$, '22023');
  perform public._t_expect_error($q$select public.set_active_days(array[1, 0]::smallint[])$q$, '22023');
  select array_agg(day_of_week order by day_of_week) into active_days
    from public.calendar_days where is_active;
  assert active_days = array[1, 3, 5]::smallint[], 'input tidak valid tidak boleh mengubah hari aktif';
  perform public.set_active_days(array[1, 2, 3, 4, 5, 6]::smallint[]);
  assert (select count(*) from public.calendar_days where is_active) = 6, 'hari aktif kembali Senin-Sabtu';
  raise notice 'PASS 17 set_active_days: atomik, menolak kosong/null/di luar 1..7 tanpa mengubah data';

  reset role;
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
