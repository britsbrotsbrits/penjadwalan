-- Tes RLS, constraint, riwayat, dan fungsi untuk struktur akademik (Phase 4):
-- programs, class_types, rombels, students, student_rombel_history, rombel_student_counts, move_student().
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat
-- psql sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai nama "Uji" sendiri
-- dan tidak bergantung pada isi database (seed dan akun yang sudah ada tidak mengganggu).
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
-- Gagal = EXCEPTION dengan pesan kasus yang gagal.
--
-- Syarat: migrasi Phase 2, 3, dan 4 sudah dijalankan.

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
  ('00000000-0000-0000-0000-0000000000e1', 'ac-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'ac-tutor@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'ac-inactive@test.local', '{}');
update public.profiles set role = 'admin', is_active = true
  where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set is_active = true
  where id = '00000000-0000-0000-0000-0000000000e2';

-- Fixture data akademik (konteks tepercaya).
insert into public.programs (name) values ('Program Uji A'), ('Program Uji B');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji 1', 10 from public.programs where name = 'Program Uji A';
insert into public.rombels (class_type_id, name, is_active)
  select ct.id, v.name, v.is_active
  from public.class_types ct
  cross join (values ('Rombel Uji 1', true), ('Rombel Uji 2', true), ('Rombel Uji Mati', false)) as v(name, is_active)
  where ct.name = 'Tipe Uji 1';
insert into public.students (student_code, full_name, rombel_id)
  select 'UJI001', 'Siswa Uji 1', id from public.rombels where name = 'Rombel Uji 1';

do $$
begin
  assert (select count(*) from public.student_rombel_history h join public.students s on s.id = h.student_id
          where s.student_code = 'UJI001' and h.from_rombel_id is null and h.changed_by is null) = 1,
    'penempatan awal (konteks tepercaya) harus tercatat sekali, changed_by NULL';
  raise notice 'PASS 01 trigger riwayat mencatat penempatan awal';
end $$;

-- ---------------------------------------------------------------- anon
do $$
begin
  set local role anon;
  perform public._t_expect_error('select * from public.programs', '42501');
  perform public._t_expect_error('select * from public.class_types', '42501');
  perform public._t_expect_error('select * from public.rombels', '42501');
  perform public._t_expect_error('select * from public.students', '42501');
  perform public._t_expect_error('select * from public.student_rombel_history', '42501');
  perform public._t_expect_error('select * from public.rombel_student_counts', '42501');
  perform public._t_expect_error(
    $q$select public.move_student('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$q$,
    '42501');
  reset role;
  raise notice 'PASS 02 anon ditolak di semua tabel, view, dan move_student';
end $$;

-- ---------------------------------------------------------------- user nonaktif
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.programs) = 0, 'user nonaktif tidak boleh melihat programs';
  assert (select count(*) from public.class_types) = 0, 'user nonaktif tidak boleh melihat class_types';
  assert (select count(*) from public.rombels) = 0, 'user nonaktif tidak boleh melihat rombels';
  assert (select count(*) from public.students) = 0, 'user nonaktif tidak boleh melihat students';
  perform public._t_expect_error($q$insert into public.programs (name) values ('X')$q$, '42501');
  reset role;
  raise notice 'PASS 03 user nonaktif tidak melihat dan tidak menulis apa pun';
end $$;

-- ---------------------------------------------------------------- tutor aktif
do $$
declare
  r1 uuid;
  s1 uuid;
begin
  select id into r1 from public.rombels where name = 'Rombel Uji 1';
  select id into s1 from public.students where student_code = 'UJI001';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
  set local role authenticated;

  assert (select count(*) from public.programs where name like 'Program Uji%') = 2, 'tutor boleh membaca programs';
  assert (select count(*) from public.class_types where name = 'Tipe Uji 1') = 1, 'tutor boleh membaca class_types';
  raise notice 'PASS 04 tutor boleh membaca programs dan class_types';

  assert (select count(*) from public.rombels) = 0, 'tutor TIDAK boleh melihat rombels (DEC-07 / Phase 12)';
  assert (select count(*) from public.students) = 0, 'tutor TIDAK boleh melihat students';
  assert (select count(*) from public.student_rombel_history) = 0, 'tutor TIDAK boleh melihat riwayat';
  assert (select count(*) from public.rombel_student_counts) = 0, 'tutor TIDAK boleh melihat jumlah siswa lewat view';
  raise notice 'PASS 05 tutor tidak melihat rombels, students, riwayat, maupun view jumlah siswa';

  perform public._t_expect_error($q$insert into public.programs (name) values ('X')$q$, '42501');
  perform public._t_expect_error(
    format($q$insert into public.class_types (program_id, name, default_size) values (%L, 'X', 5)$q$,
      (select id from public.programs limit 1)), '42501');
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name) values (%L, 'X')$q$,
      (select id from public.class_types limit 1)), '42501');
  perform public._t_expect_error(
    format($q$insert into public.students (full_name, rombel_id) values ('X', %L)$q$, r1), '42501');
  assert public._t_rowcount($q$update public.programs set name = 'Diretas'$q$) = 0, 'tutor tidak boleh UPDATE programs';
  assert public._t_rowcount($q$update public.class_types set default_size = 1$q$) = 0, 'tutor tidak boleh UPDATE class_types';
  assert public._t_rowcount($q$update public.rombels set name = 'Diretas'$q$) = 0, 'tutor tidak boleh UPDATE rombels';
  assert public._t_rowcount($q$update public.students set full_name = 'Diretas'$q$) = 0, 'tutor tidak boleh UPDATE students';
  raise notice 'PASS 06 tutor tidak bisa INSERT/UPDATE';

  perform public._t_expect_error($q$delete from public.programs$q$, '42501');
  perform public._t_expect_error($q$delete from public.students$q$, '42501');
  perform public._t_expect_error(
    format($q$select public.move_student(%L, %L)$q$, s1, r1), '42501');
  reset role;
  raise notice 'PASS 07 tutor tidak bisa DELETE dan tidak bisa memindahkan siswa';
end $$;

-- ---------------------------------------------------------------- admin
do $$
declare
  r1 uuid;
  r2 uuid;
  rdead uuid;
  ct uuid;
  pa uuid;
  pb uuid;
  s1 uuid;
  s2 uuid;
  code2 text;
  n integer;
  h record;
begin
  select id into r1 from public.rombels where name = 'Rombel Uji 1';
  select id into r2 from public.rombels where name = 'Rombel Uji 2';
  select id into rdead from public.rombels where name = 'Rombel Uji Mati';
  select id into ct from public.class_types where name = 'Tipe Uji 1';
  select id into pa from public.programs where name = 'Program Uji A';
  select id into pb from public.programs where name = 'Program Uji B';
  select id into s1 from public.students where student_code = 'UJI001';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
  set local role authenticated;

  -- Baca + tulis dasar
  assert (select count(*) from public.rombels where name like 'Rombel Uji%') = 3, 'admin boleh membaca rombels';
  assert (select count(*) from public.students where student_code = 'UJI001') = 1, 'admin boleh membaca students';
  insert into public.programs (name, sort_order) values ('Program Uji C', 9);
  insert into public.class_types (program_id, name, default_size) values (pb, 'Tipe Uji 2', 5);
  insert into public.rombels (class_type_id, name, start_date, end_date)
    values (ct, 'Rombel Uji 3', '2026-01-01', '2026-12-31');
  raise notice 'PASS 08 admin boleh membaca dan INSERT program, tipe kelas, rombel';

  -- Siswa: kode otomatis + riwayat penempatan awal oleh admin
  insert into public.students (full_name, rombel_id) values ('Siswa Uji 2', r1);
  select id, student_code into s2, code2 from public.students where full_name = 'Siswa Uji 2';
  assert code2 ~ '^SIS[0-9]{6}$', format('kode otomatis harus SIS + 6 digit, dapat %s', code2);
  select * into h from public.student_rombel_history where student_id = s2;
  assert h.from_rombel_id is null and h.to_rombel_id = r1, 'riwayat awal: dari NULL ke r1';
  assert h.changed_by = '00000000-0000-0000-0000-0000000000e1', 'changed_by harus admin pembuat';
  assert h.reason is null, 'penempatan awal tanpa alasan';
  raise notice 'PASS 09 kode siswa otomatis dan riwayat penempatan awal mencatat admin';

  -- Update biasa tidak membuat riwayat
  assert public._t_rowcount(
    format($q$update public.students set full_name = 'Siswa Uji 2b', is_active = false where id = %L$q$, s2)) = 1,
    'admin boleh UPDATE nama / status siswa';
  update public.students set is_active = true where id = s2;
  assert (select count(*) from public.student_rombel_history where student_id = s2) = 1,
    'mengubah nama/status TIDAK boleh membuat riwayat';
  assert public._t_rowcount(format($q$update public.programs set sort_order = 5 where id = %L$q$, pa)) = 1, 'UPDATE programs';
  assert public._t_rowcount(format($q$update public.class_types set default_size = 12 where id = %L$q$, ct)) = 1, 'UPDATE class_types';
  assert public._t_rowcount(format($q$update public.rombels set is_active = true where id = %L$q$, r2)) = 1, 'UPDATE rombels';
  raise notice 'PASS 10 admin boleh UPDATE; ubah nama/status siswa tidak membuat riwayat';

  -- rombel_id tidak bisa diubah langsung
  perform public._t_expect_error(
    format($q$update public.students set rombel_id = %L where id = %L$q$, r2, s1), '42501');
  perform public._t_expect_error(
    format($q$update public.rombels set class_type_id = %L where id = %L$q$, (select id from public.class_types where name = 'Tipe Uji 2'), r1), '42501');
  perform public._t_expect_error(
    format($q$update public.class_types set program_id = %L where id = %L$q$, pb, ct), '42501');
  perform public._t_expect_error(format($q$update public.students set id = gen_random_uuid() where id = %L$q$, s1), '42501');
  raise notice 'PASS 11 rombel_id siswa, class_type_id rombel, program_id tipe kelas, dan id tidak bisa diubah langsung';

  -- move_student
  perform public.move_student(s1, r2, '  naik kelas  ');
  assert (select rombel_id from public.students where id = s1) = r2, 'siswa harus pindah ke r2';
  -- changed_at sama di dalam satu transaksi, jadi baris dipilih lewat pasangan dari/ke, bukan urutan waktu.
  select * into h from public.student_rombel_history
    where student_id = s1 and from_rombel_id = r1 and to_rombel_id = r2;
  assert found, 'riwayat: harus ada baris dari r1 ke r2';
  assert h.reason = 'naik kelas', format('alasan harus dipangkas, dapat [%s]', h.reason);
  assert h.changed_by = '00000000-0000-0000-0000-0000000000e1', 'changed_by = admin';
  perform public.move_student(s1, r1);
  select count(*) into n from public.student_rombel_history where student_id = s1 and reason is null and to_rombel_id = r1 and from_rombel_id = r2;
  assert n = 1, 'pindah tanpa alasan: reason NULL dan tidak mewarisi alasan sebelumnya';
  assert (select count(*) from public.student_rombel_history where student_id = s1) = 3, 'total riwayat s1 = 3';
  raise notice 'PASS 12 move_student: pindah, riwayat lengkap (dari, ke, alasan, pelaku)';

  perform public._t_expect_error(format($q$select public.move_student(%L, %L)$q$, s1, r1), '23514');
  perform public._t_expect_error(format($q$select public.move_student(%L, %L)$q$, s1, rdead), '23514');
  perform public._t_expect_error(
    format($q$select public.move_student(%L, %L)$q$, s1, '00000000-0000-0000-0000-00000000dead'), '23514');
  perform public._t_expect_error(
    format($q$select public.move_student(%L, %L)$q$, '00000000-0000-0000-0000-00000000dead', r2), 'P0002');
  perform public._t_expect_error(
    format($q$select public.move_student(%L, %L, %L)$q$, s1, r2, repeat('x', 501)), '22023');
  perform public._t_expect_error(
    format($q$insert into public.students (full_name, rombel_id) values ('X', %L)$q$, rdead), '23514');
  assert (select rombel_id from public.students where id = s1) = r1, 'percobaan gagal tidak boleh memindahkan siswa';
  raise notice 'PASS 13 pindah ke rombel yang sama / nonaktif / tidak ada, siswa tidak ada, alasan terlalu panjang: ditolak';

  -- students: constraint
  perform public._t_expect_error(
    format($q$insert into public.students (student_code, full_name, rombel_id) values ('uji_kecil', 'X', %L)$q$, r1), '23514');
  perform public._t_expect_error(
    format($q$insert into public.students (student_code, full_name, rombel_id) values ('ADA SPASI', 'X', %L)$q$, r1), '23514');
  perform public._t_expect_error(
    format($q$insert into public.students (student_code, full_name, rombel_id) values ('UJI001', 'X', %L)$q$, r1), '23505');
  perform public._t_expect_error(
    format($q$insert into public.students (full_name, rombel_id) values ('   ', %L)$q$, r1), '23514');
  raise notice 'PASS 14 siswa: format kode, kode ganda, nama kosong ditolak';

  -- programs / class_types / rombels: constraint
  perform public._t_expect_error($q$insert into public.programs (name) values (' program UJI a ')$q$, '23505');
  perform public._t_expect_error($q$insert into public.programs (name) values ('   ')$q$, '23514');
  perform public._t_expect_error($q$insert into public.programs (name, sort_order) values ('P', 10000)$q$, '23514');
  perform public._t_expect_error(
    format($q$insert into public.class_types (program_id, name, default_size) values (%L, 'tipe UJI 1 ', 5)$q$, pa), '23505');
  perform public._t_expect_error(
    format($q$insert into public.class_types (program_id, name, default_size) values (%L, 'T0', 0)$q$, pa), '23514');
  perform public._t_expect_error(
    format($q$insert into public.class_types (program_id, name, default_size) values (%L, 'T501', 501)$q$, pa), '23514');
  insert into public.class_types (program_id, name, default_size) values (pa, 'Tipe Uji 2', 5);
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name) values (%L, ' rombel uji 1')$q$, ct), '23505');
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name, start_date, end_date) values (%L, 'Tanggal Salah', '2026-12-31', '2026-01-01')$q$, ct), '23514');
  insert into public.rombels (class_type_id, name)
    select id, 'Rombel Uji 1' from public.class_types where program_id = pa and name = 'Tipe Uji 2';
  raise notice 'PASS 15 nama ganda (tanpa beda huruf/spasi), ukuran 1..500, urutan tanggal; nama sama di tipe kelas lain boleh';

  -- Tidak ada DELETE; riwayat tidak bisa diubah
  perform public._t_expect_error(format($q$delete from public.programs where id = %L$q$, pa), '42501');
  perform public._t_expect_error(format($q$delete from public.class_types where id = %L$q$, ct), '42501');
  perform public._t_expect_error(format($q$delete from public.rombels where id = %L$q$, r1), '42501');
  perform public._t_expect_error(format($q$delete from public.students where id = %L$q$, s1), '42501');
  perform public._t_expect_error($q$delete from public.student_rombel_history$q$, '42501');
  perform public._t_expect_error($q$update public.student_rombel_history set reason = 'ubah'$q$, '42501');
  perform public._t_expect_error(
    format($q$insert into public.student_rombel_history (student_id, to_rombel_id) values (%L, %L)$q$, s1, r1), '42501');
  raise notice 'PASS 16 tidak ada DELETE; riwayat tidak bisa di-INSERT/UPDATE/DELETE oleh admin';

  -- View jumlah siswa
  select count(*) filter (where is_active) into n from public.students where rombel_id = r1;
  assert (select active_students from public.rombel_student_counts where rombel_id = r1) = n,
    'view: jumlah siswa aktif harus sama dengan hitungan langsung';
  update public.students set is_active = false where id = s2;
  assert (select active_students from public.rombel_student_counts where rombel_id = r1) = n - 1,
    'view: siswa nonaktif tidak dihitung aktif';
  assert (select total_students from public.rombel_student_counts where rombel_id = r1) >= n,
    'view: total termasuk siswa nonaktif';
  raise notice 'PASS 17 view rombel_student_counts benar untuk admin';

  reset role;
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
