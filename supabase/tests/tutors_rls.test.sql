-- Tes RLS, constraint, trigger, dan fungsi untuk tutor (Phase 5):
-- tutor_profiles, tutor_competencies, tutor_availability, current_tutor_id(),
-- set_tutor_availability(), set_tutor_competencies(), admin_profile_emails().
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat
-- psql sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai fixture sendiri dan
-- tidak bergantung pada isi database (akun/tutor yang sudah ada tidak mengganggu).
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
--
-- Syarat: migrasi Phase 2, 3, dan 5 sudah dijalankan.

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

-- Fixture: admin (f1), tutor A (f2), tutor B (f3), tutor nonaktif (f4).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'tt-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'tt-a@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', 'tt-b@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000f4', 'tt-inactive@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set is_active = true where id in
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');

insert into public.subtests (code, name) values ('ZT1', 'Subtes Uji 1'), ('ZT2', 'Subtes Uji 2'), ('ZT3', 'Subtes Uji 3');

-- Data awal untuk isolasi: kompetensi + availability milik A dan B (konteks tepercaya).
select public._t_rowcount($q$select 1$q$);
create temp table _fx as
  select
    (select id from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f2') as ta,
    (select id from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f3') as tb,
    (select id from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f4') as ti,
    (select id from public.subtests where code = 'ZT1') as s1,
    (select id from public.subtests where code = 'ZT2') as s2,
    (select id from public.subtests where code = 'ZT3') as s3;
grant select on _fx to anon, authenticated;

insert into public.tutor_competencies (tutor_id, subtest_id) select ta, s1 from _fx;
insert into public.tutor_competencies (tutor_id, subtest_id) select tb, s2 from _fx;
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available) select ta, 1, 1, true from _fx;
insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available) select tb, 2, 2, true from _fx;
update public.tutor_profiles set level = 3, rate_per_session = 40000 where id = (select ta from _fx);
update public.tutor_profiles set level = 1, rate_per_session = 55000 where id = (select tb from _fx);

-- ---------------------------------------------------------------- trigger
do $$
declare r record;
begin
  select * into r from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f4';
  assert found, 'setiap profile tutor baru harus otomatis punya baris tutor_profiles';
  assert r.is_active = false and r.level = 0 and r.rate_per_session is null and r.availability_updated_at is null,
    'tutor baru: tidak dapat dijadwalkan, level 0, rate kosong, availability belum diisi';

  update public.profiles set role = 'tutor' where id = '00000000-0000-0000-0000-0000000000f2';
  assert (select count(*) from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f2') = 1,
    'update role tidak boleh membuat baris ganda';

  -- Admin yang dulu tutor: baris tutor_profiles tetap ada, tetapi bukan "tutor saat ini".
  assert (select count(*) from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f1') = 1,
    'baris tutor_profiles dibuat saat profile lahir sebagai tutor';
  raise notice 'PASS 01 trigger membuat tutor_profiles otomatis dan idempoten';
end $$;

-- ---------------------------------------------------------------- anon
do $$
begin
  set local role anon;
  perform public._t_expect_error('select * from public.tutor_profiles', '42501');
  perform public._t_expect_error('select * from public.tutor_competencies', '42501');
  perform public._t_expect_error('select * from public.tutor_availability', '42501');
  perform public._t_expect_error('select public.current_tutor_id()', '42501');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, (select ta from _fx)), '42501');
  perform public._t_expect_error(
    format($q$select public.set_tutor_competencies(%L, '{}'::uuid[])$q$, (select ta from _fx)), '42501');
  perform public._t_expect_error($q$select * from public.admin_profile_emails('{}'::uuid[])$q$, '42501');
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'X', true, 0::smallint, null, true)$q$, (select ta from _fx)), '42501');
  reset role;
  raise notice 'PASS 02 anon ditolak di semua tabel dan fungsi';
end $$;

-- ---------------------------------------------------------------- tutor nonaktif
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.tutor_profiles) = 0, 'tutor nonaktif tidak boleh melihat tutor_profiles';
  assert (select count(*) from public.tutor_competencies) = 0, 'tutor nonaktif tidak boleh melihat kompetensi';
  assert (select count(*) from public.tutor_availability) = 0, 'tutor nonaktif tidak boleh melihat availability';
  assert public.current_tutor_id() is null, 'current_tutor_id harus NULL untuk tutor nonaktif';
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, (select ti from _fx)), '42501');
  reset role;
  raise notice 'PASS 03 tutor nonaktif tidak melihat dan tidak menulis apa pun';
end $$;

-- ---------------------------------------------------------------- tutor A
do $$
declare
  ta uuid; tb uuid; s1 uuid; s2 uuid;
  r record;
  big jsonb;
begin
  select _fx.ta, _fx.tb, _fx.s1, _fx.s2 into ta, tb, s1, s2 from _fx;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;

  assert public.current_tutor_id() = ta, 'current_tutor_id tutor A harus id tutor_profiles A';

  -- Isolasi baca
  assert (select count(*) from public.tutor_profiles) = 1, 'tutor A hanya melihat satu baris tutor_profiles';
  select * into r from public.tutor_profiles;
  assert r.id = ta and r.rate_per_session = 40000 and r.level = 3, 'tutor A boleh membaca rate dan level sendiri';
  assert (select count(*) from public.tutor_profiles where id = tb) = 0, 'tutor A TIDAK boleh melihat tutor B (rate B tersembunyi)';
  assert (select count(*) from public.tutor_competencies) = 1
     and (select count(*) from public.tutor_competencies where tutor_id = ta) = 1, 'tutor A hanya melihat kompetensi sendiri';
  assert (select count(*) from public.tutor_availability) = 1
     and (select count(*) from public.tutor_availability where tutor_id = tb) = 0, 'tutor A hanya melihat availability sendiri';
  raise notice 'PASS 04 tutor A hanya melihat data dan rate sendiri';

  -- Tidak bisa menaikkan diri sendiri / menulis langsung
  assert public._t_rowcount($q$update public.tutor_profiles set level = 99$q$) = 0, 'tutor tidak boleh mengubah level sendiri';
  assert public._t_rowcount($q$update public.tutor_profiles set rate_per_session = 999999$q$) = 0, 'tutor tidak boleh mengubah rate sendiri';
  assert public._t_rowcount($q$update public.tutor_profiles set is_active = true$q$) = 0, 'tutor tidak boleh mengubah status dijadwalkan';
  perform public._t_expect_error($q$update public.tutor_profiles set profile_id = gen_random_uuid()$q$, '42501');
  perform public._t_expect_error($q$update public.tutor_profiles set availability_updated_at = now()$q$, '42501');
  perform public._t_expect_error($q$insert into public.tutor_profiles (profile_id) values (gen_random_uuid())$q$, '42501');
  perform public._t_expect_error($q$delete from public.tutor_profiles$q$, '42501');
  perform public._t_expect_error(
    format($q$insert into public.tutor_competencies (tutor_id, subtest_id) values (%L, %L)$q$, ta, s2), '42501');
  perform public._t_expect_error($q$delete from public.tutor_competencies$q$, '42501');
  perform public._t_expect_error($q$update public.tutor_competencies set subtest_id = subtest_id$q$, '42501');
  perform public._t_expect_error(
    format($q$insert into public.tutor_availability (tutor_id, day_of_week, slot_no, available) values (%L, 3, 3, true)$q$, ta), '42501');
  perform public._t_expect_error($q$update public.tutor_availability set available = false$q$, '42501');
  perform public._t_expect_error($q$delete from public.tutor_availability$q$, '42501');
  raise notice 'PASS 05 tutor tidak bisa eskalasi, INSERT, UPDATE, atau DELETE langsung';

  -- Fungsi hanya-admin
  perform public._t_expect_error(
    format($q$select public.set_tutor_competencies(%L, array[%L]::uuid[])$q$, ta, s2), '42501');
  perform public._t_expect_error($q$select * from public.admin_profile_emails('{}'::uuid[])$q$, '42501');
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'Hack', true, 99::smallint, 999999, true)$q$, ta), '42501');
  raise notice 'PASS 06 tutor tidak bisa mengubah kompetensi atau melihat email akun';

  -- Availability sendiri
  perform public.set_tutor_availability(ta,
    '[{"day":1,"slot_no":1,"available":true},{"day":1,"slot_no":2,"available":false},{"day":6,"slot_no":8,"available":true}]'::jsonb);
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 3, 'availability A harus 3 sel';
  assert (select available from public.tutor_availability where tutor_id = ta and day_of_week = 1 and slot_no = 2) = false,
    'sel available=false tersimpan';
  assert (select availability_updated_at from public.tutor_profiles where id = ta) is not null,
    'availability_updated_at harus terisi setelah simpan';
  perform public.set_tutor_availability(ta, '[{"day":3,"slot_no":4,"available":true}]'::jsonb);
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 1
     and (select count(*) from public.tutor_availability where tutor_id = ta and day_of_week = 3 and slot_no = 4) = 1,
    'simpan ulang harus MENGGANTI seluruh availability';
  perform public.set_tutor_availability(ta, '[]'::jsonb);
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 0, 'array kosong mengosongkan availability';
  assert (select availability_updated_at from public.tutor_profiles where id = ta) is not null,
    'mengosongkan availability tetap dihitung sudah diisi';
  perform public.set_tutor_availability(ta, '[{"day":1,"slot_no":1,"available":true}]'::jsonb);
  raise notice 'PASS 07 tutor mengganti availability sendiri secara atomik';

  -- Tidak boleh untuk tutor lain / id tidak ada
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, tb), '42501');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, gen_random_uuid()), '42501');
  perform public._t_expect_error($q$select public.set_tutor_availability(null, '[]'::jsonb)$q$, '42501');
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 1, 'percobaan ilegal tidak mengubah data';
  raise notice 'PASS 08 tutor A tidak bisa mengubah availability tutor B atau id sembarang (tanpa membocorkan keberadaan)';

  -- Validasi input; data lama harus tetap utuh
  big := (select jsonb_agg(jsonb_build_object('day', 1, 'slot_no', 1, 'available', true)) from generate_series(1, 694));
  perform public._t_expect_error(format($q$select public.set_tutor_availability(%L, 'null'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(format($q$select public.set_tutor_availability(%L, null)$q$, ta), '22023');
  perform public._t_expect_error(format($q$select public.set_tutor_availability(%L, '{}'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(format($q$select public.set_tutor_availability(%L, %L::jsonb)$q$, ta, big::text), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":8,"slot_no":1,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":0,"slot_no":1,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1,"slot_no":0,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1,"slot_no":100,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1.5,"slot_no":1,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1,"slot_no":1,"available":"ya"}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":"1","slot_no":1,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1,"available":true}]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[5]'::jsonb)$q$, ta), '22023');
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[{"day":1,"slot_no":1,"available":true},{"day":1,"slot_no":1,"available":false}]'::jsonb)$q$, ta), '22023');
  assert (select count(*) from public.tutor_availability where tutor_id = ta and day_of_week = 1 and slot_no = 1 and available) = 1
     and (select count(*) from public.tutor_availability where tutor_id = ta) = 1,
    'input tidak valid tidak boleh mengubah availability yang sudah ada';
  raise notice 'PASS 09 input availability tidak valid ditolak dan tidak merusak data lama';

  reset role;
end $$;

-- ---------------------------------------------------------------- tutor B (isolasi timbal balik)
do $$
declare ta uuid; tb uuid;
begin
  select _fx.ta, _fx.tb into ta, tb from _fx;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.tutor_profiles) = 1 and (select id from public.tutor_profiles) = tb,
    'tutor B hanya melihat dirinya';
  assert (select rate_per_session from public.tutor_profiles) = 55000, 'tutor B membaca rate sendiri';
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 0, 'tutor B tidak melihat availability A';
  assert (select count(*) from public.tutor_competencies where tutor_id = ta) = 0, 'tutor B tidak melihat kompetensi A';
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, ta), '42501');
  reset role;
  raise notice 'PASS 10 tutor B terisolasi dari tutor A';
end $$;

-- ---------------------------------------------------------------- admin
do $$
declare
  ta uuid; tb uuid; s1 uuid; s2 uuid; s3 uuid;
  n integer;
begin
  select _fx.ta, _fx.tb, _fx.s1, _fx.s2, _fx.s3 into ta, tb, s1, s2, s3 from _fx;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
  set local role authenticated;

  assert public.current_tutor_id() is null, 'admin (bukan role tutor) tidak punya current_tutor_id';
  assert (select count(*) from public.tutor_profiles where id in (ta, tb)) = 2, 'admin melihat semua tutor_profiles';
  assert (select count(*) from public.tutor_competencies where tutor_id in (ta, tb)) = 2, 'admin melihat semua kompetensi';
  assert (select count(*) from public.tutor_availability where tutor_id in (ta, tb)) = 2, 'admin melihat semua availability';

  -- Update tutor_profiles + constraint
  assert public._t_rowcount(format($q$update public.tutor_profiles set level = 5, rate_per_session = 50000, is_active = true where id = %L$q$, tb)) = 1,
    'admin boleh mengubah level, rate, status dijadwalkan';
  assert public._t_rowcount(format($q$update public.tutor_profiles set rate_per_session = null where id = %L$q$, tb)) = 1,
    'rate boleh dikosongkan (NULL)';
  perform public._t_expect_error(format($q$update public.tutor_profiles set level = 100 where id = %L$q$, tb), '23514');
  perform public._t_expect_error(format($q$update public.tutor_profiles set level = -1 where id = %L$q$, tb), '23514');
  perform public._t_expect_error(format($q$update public.tutor_profiles set rate_per_session = -1 where id = %L$q$, tb), '23514');
  perform public._t_expect_error(format($q$update public.tutor_profiles set rate_per_session = 100000001 where id = %L$q$, tb), '23514');
  perform public._t_expect_error(format($q$update public.tutor_profiles set profile_id = gen_random_uuid() where id = %L$q$, tb), '42501');
  perform public._t_expect_error(format($q$update public.tutor_profiles set availability_updated_at = now() where id = %L$q$, tb), '42501');
  perform public._t_expect_error($q$insert into public.tutor_profiles (profile_id) values (gen_random_uuid())$q$, '42501');
  perform public._t_expect_error(format($q$delete from public.tutor_profiles where id = %L$q$, tb), '42501');
  perform public._t_expect_error($q$delete from public.tutor_competencies$q$, '42501');
  perform public._t_expect_error($q$delete from public.tutor_availability$q$, '42501');
  perform public._t_expect_error(
    format($q$insert into public.tutor_competencies (tutor_id, subtest_id) values (%L, %L)$q$, ta, s3), '42501');
  raise notice 'PASS 11 admin mengubah tutor_profiles dalam batas constraint; tanpa INSERT/DELETE langsung';

  -- Kompetensi
  perform public.set_tutor_competencies(ta, array[s1, s2, s2]);
  assert (select count(*) from public.tutor_competencies where tutor_id = ta) = 2, 'kompetensi ganda harus dideduplikasi';
  perform public.set_tutor_competencies(ta, array[s3]);
  assert (select count(*) from public.tutor_competencies where tutor_id = ta) = 1
     and (select subtest_id from public.tutor_competencies where tutor_id = ta) = s3, 'simpan ulang mengganti seluruh kompetensi';
  assert (select count(*) from public.tutor_competencies where tutor_id = tb) = 1, 'kompetensi tutor lain tidak tersentuh';
  perform public._t_expect_error(
    format($q$select public.set_tutor_competencies(%L, array[%L, gen_random_uuid()]::uuid[])$q$, ta, s1), '23503');
  assert (select subtest_id from public.tutor_competencies where tutor_id = ta) = s3,
    'subtes tidak ada: seluruh perubahan dibatalkan, kompetensi lama utuh';
  perform public._t_expect_error(format($q$select public.set_tutor_competencies(%L, array[%L, null]::uuid[])$q$, ta, s1), '22023');
  perform public._t_expect_error(format($q$select public.set_tutor_competencies(%L, null)$q$, ta), '22023');
  perform public._t_expect_error(format($q$select public.set_tutor_competencies(%L, array[%L]::uuid[])$q$, gen_random_uuid(), s1), 'P0002');
  perform public.set_tutor_competencies(ta, '{}'::uuid[]);
  assert (select count(*) from public.tutor_competencies where tutor_id = ta) = 0, 'array kosong mengosongkan kompetensi';
  perform public.set_tutor_competencies(ta, array[s1, s2]);
  raise notice 'PASS 12 admin mengganti kompetensi secara atomik; input salah ditolak';

  -- Availability oleh admin untuk tutor lain
  perform public.set_tutor_availability(tb, '[{"day":5,"slot_no":3,"available":true}]'::jsonb);
  assert (select count(*) from public.tutor_availability where tutor_id = tb and day_of_week = 5 and slot_no = 3) = 1
     and (select count(*) from public.tutor_availability where tutor_id = tb) = 1, 'admin mengganti availability tutor B';
  assert (select availability_updated_at from public.tutor_profiles where id = tb) is not null, 'availability_updated_at terisi';
  perform public._t_expect_error(
    format($q$select public.set_tutor_availability(%L, '[]'::jsonb)$q$, gen_random_uuid()), 'P0002');
  perform public._t_expect_error($q$select public.set_tutor_availability(null, '[]'::jsonb)$q$, 'P0002');
  raise notice 'PASS 13 admin mengisi availability tutor lain; tutor tidak ada: P0002';

  -- admin_update_tutor: dua tabel, atomik
  perform public.admin_update_tutor(tb, '  Nama Baru  ', true, 7::smallint, 65000, true);
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000f3') = 'Nama Baru',
    'nama dipangkas dan tersimpan di profiles';
  assert (select level from public.tutor_profiles where id = tb) = 7
     and (select rate_per_session from public.tutor_profiles where id = tb) = 65000
     and (select is_active from public.tutor_profiles where id = tb), 'level, rate, dijadwalkan tersimpan';
  perform public.admin_update_tutor(tb, 'Nama Baru', true, 7::smallint, null, false);
  assert (select rate_per_session from public.tutor_profiles where id = tb) is null, 'rate NULL diterima';
  -- gagal di tabel kedua (level 100) membatalkan update tabel pertama
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'Tidak Boleh Tersimpan', true, 100::smallint, 1, true)$q$, tb), '23514');
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000f3') = 'Nama Baru',
    'update tabel pertama harus batal bila tabel kedua gagal';
  -- gagal di tabel pertama (nama > 200) membatalkan tabel kedua
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, %L, true, 9::smallint, 1, true)$q$, tb, repeat('x', 201)), '23514');
  assert (select level from public.tutor_profiles where id = tb) = 7, 'level tidak berubah bila nama gagal';
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'X', true, 1::smallint, -1, true)$q$, tb), '23514');
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'X', null, 1::smallint, 1, true)$q$, tb), '22023');
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, null, true, 1::smallint, 1, true)$q$, tb), '22023');
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'X', true, 1::smallint, 1, true)$q$, gen_random_uuid()), 'P0002');
  -- akun admin tidak bisa diubah lewat fungsi tutor
  perform public._t_expect_error(
    format($q$select public.admin_update_tutor(%L, 'X', false, 1::smallint, 1, true)$q$,
      (select id from public.tutor_profiles where profile_id = '00000000-0000-0000-0000-0000000000f1')), '22023');
  assert (select is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000f1'), 'admin tetap aktif';
  raise notice 'PASS 14b admin_update_tutor atomik dan hanya untuk akun tutor';

  -- Email akun
  select count(*) into n from public.admin_profile_emails(array[
    '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', gen_random_uuid()]::uuid[]);
  assert n = 2, format('admin_profile_emails harus 2 baris, dapat %s', n);
  assert (select email from public.admin_profile_emails(array['00000000-0000-0000-0000-0000000000f2']::uuid[])) = 'tt-a@test.local',
    'email harus sesuai akun';
  perform public._t_expect_error(
    format($q$select * from public.admin_profile_emails(%L::uuid[])$q$, (select array_agg(gen_random_uuid()) from generate_series(1, 501))), '22023');
  perform public._t_expect_error($q$select * from public.admin_profile_emails(null)$q$, '22023');
  raise notice 'PASS 14 admin membaca email akun; input terlalu besar ditolak';

  reset role;
end $$;

-- Tutor A melihat hasil kerja admin (end-to-end)
do $$
declare ta uuid; s1 uuid; s2 uuid;
begin
  select _fx.ta, _fx.s1, _fx.s2 into ta, s1, s2 from _fx;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.tutor_competencies where subtest_id in (s1, s2)) = 2, 'tutor A melihat kompetensi dari admin';
  reset role;
  raise notice 'PASS 15 tutor melihat kompetensi yang ditetapkan admin';
end $$;

-- ---------------------------------------------------------------- cascade (konteks tepercaya)
do $$
declare ta uuid;
begin
  select _fx.ta into ta from _fx;
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000f2';
  assert (select count(*) from public.tutor_profiles where id = ta) = 0, 'hapus akun menghapus tutor_profiles';
  assert (select count(*) from public.tutor_competencies where tutor_id = ta) = 0, 'dan kompetensinya';
  assert (select count(*) from public.tutor_availability where tutor_id = ta) = 0, 'dan availability-nya';
  raise notice 'PASS 16 hapus akun membersihkan data tutor yang belum punya riwayat';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
