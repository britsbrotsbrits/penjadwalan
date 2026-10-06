-- Tes konfigurasi akademik (Phase 7): scheduling_settings, subtest_distribution_items, RPC set/clear,
-- constraint, dan hak akses (admin saja).
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat psql
-- sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai nama "Uji" sendiri dan
-- tidak bergantung pada isi database (aman dijalankan setelah seed).
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
--
-- Syarat: migrasi Phase 2, 3, 4, dan 7 sudah dijalankan.
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

create function public._t_rowcount(p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixture: admin (c1), tutor aktif (c2).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'cf-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'cf-tutor@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000d2';

insert into public.programs (name) values ('Program Uji CF');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji CF', 10 from public.programs where name = 'Program Uji CF';
insert into public.rombels (class_type_id, name)
  select id, 'CF 1' from public.class_types where name = 'Tipe Uji CF';
insert into public.subtests (code, name) values ('UJA', 'Subtes Uji A'), ('UJB', 'Subtes Uji B'), ('UJC', 'Subtes Uji C');

-- ---------------------------------------------------------------- admin: settings
do $$
declare
  pr uuid; ct uuid; rb uuid;
begin
  select id into pr from public.programs where name = 'Program Uji CF';
  select id into ct from public.class_types where name = 'Tipe Uji CF';
  select id into rb from public.rombels where name = 'CF 1';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;

  -- set di tiap level, termasuk global
  perform public.set_scheduling_setting('sessions_per_day', 'global', null, null, '2'::jsonb);
  perform public.set_scheduling_setting('sessions_per_day', 'program', pr, null, '3'::jsonb);
  perform public.set_scheduling_setting('sessions_per_day', 'class_type', ct, null, '4'::jsonb);
  perform public.set_scheduling_setting('sessions_per_day', 'rombel', rb, null, '5'::jsonb);
  perform public.set_scheduling_setting('sessions_per_day', 'rombel_day', rb, 2::smallint, '6'::jsonb);
  assert (select count(*) from public.scheduling_settings where key = 'sessions_per_day'
            and scope_id in (pr, ct, rb)) = 4, 'empat baris scoped (program, tipe, rombel, rombel+hari)';
  assert (select count(*) from public.scheduling_settings where key = 'sessions_per_day' and scope_type = 'global') = 1,
    'satu baris global';
  raise notice 'PASS 01 admin menyimpan nilai di semua level hierarki';

  -- upsert: nilai kedua menimpa, bukan menggandakan
  perform public.set_scheduling_setting('sessions_per_day', 'rombel', rb, null, '7'::jsonb);
  assert (select count(*) from public.scheduling_settings where key = 'sessions_per_day' and scope_type = 'rombel' and scope_id = rb) = 1,
    'simpan ulang tidak menggandakan baris';
  assert (select value from public.scheduling_settings where scope_type = 'rombel' and scope_id = rb and key = 'sessions_per_day') = '7'::jsonb,
    'nilai terbaru tersimpan';
  perform public.set_scheduling_setting('sessions_per_day', 'global', null, null, '2'::jsonb);
  assert (select count(*) from public.scheduling_settings where key = 'sessions_per_day' and scope_type = 'global') = 1,
    'upsert global tidak menggandakan (NULL scope_id)';
  perform public.set_scheduling_setting('sessions_per_day', 'rombel_day', rb, 3::smallint, '1'::jsonb);
  assert (select count(*) from public.scheduling_settings where scope_type = 'rombel_day' and scope_id = rb) = 2,
    'hari berbeda = baris berbeda';
  raise notice 'PASS 02 upsert menimpa dan tidak menggandakan';

  -- validasi nilai
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'0'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'100'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'2.5'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'"3"'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'null'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('weekly_sessions','rombel',%L,null,'1000'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('key_tak_dikenal','rombel',%L,null,'1'::jsonb)$q$, rb), '23514');
  assert (select value from public.scheduling_settings where scope_type = 'rombel' and scope_id = rb and key = 'sessions_per_day') = '7'::jsonb,
    'percobaan gagal tidak mengubah nilai';
  raise notice 'PASS 03 nilai di luar rentang / bukan bilangan bulat / key asing ditolak';

  -- validasi scope
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'1'::jsonb)$q$, gen_random_uuid()), 'P0002');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','class_type',%L,null,'1'::jsonb)$q$, rb), 'P0002');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','bukan_scope',%L,null,'1'::jsonb)$q$, rb), 'P0002');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',null,null,'1'::jsonb)$q$), 'P0002');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel_day',%L,8::smallint,'1'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel_day',%L,null,'1'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,2::smallint,'1'::jsonb)$q$, rb), '23514');
  perform public._t_expect_error($q$select public.set_scheduling_setting('sessions_per_day','global',null,2::smallint,'1'::jsonb)$q$, '23514');
  raise notice 'PASS 04 scope tidak ada / bentuk scope dan hari salah ditolak';

  -- clear: hanya baris itu; idempoten
  perform public.clear_scheduling_setting('sessions_per_day', 'rombel', rb, null);
  assert (select count(*) from public.scheduling_settings where scope_type = 'rombel' and scope_id = rb) = 0, 'override rombel terhapus';
  assert (select count(*) from public.scheduling_settings where scope_type = 'class_type' and scope_id = ct) = 1, 'level lain utuh';
  assert (select count(*) from public.scheduling_settings where scope_type = 'rombel_day' and scope_id = rb) = 2, 'override hari utuh';
  perform public.clear_scheduling_setting('sessions_per_day', 'rombel', rb, null);
  perform public.clear_scheduling_setting('sessions_per_day', 'global', null, null);
  assert (select count(*) from public.scheduling_settings where key = 'sessions_per_day' and scope_type = 'global') = 0, 'global bisa dihapus';
  perform public.clear_scheduling_setting('sessions_per_day', 'rombel_day', rb, 3::smallint);
  assert (select count(*) from public.scheduling_settings where scope_type = 'rombel_day' and scope_id = rb) = 1, 'hanya hari yang dituju terhapus';
  raise notice 'PASS 05 clear menghapus tepat satu baris dan idempoten';

  -- tanpa hak tulis langsung / DELETE
  perform public._t_expect_error(format($q$insert into public.scheduling_settings (key, scope_type, scope_id, value) values ('sessions_per_day','rombel',%L,'1')$q$, rb), '42501');
  perform public._t_expect_error($q$update public.scheduling_settings set value = '9'$q$, '42501');
  perform public._t_expect_error($q$delete from public.scheduling_settings$q$, '42501');
  raise notice 'PASS 06 admin pun tidak bisa menulis langsung; hanya lewat RPC';
  reset role;
end $$;

-- ---------------------------------------------------------------- admin: distribusi
do $$
declare
  pr uuid; ct uuid; rb uuid; a uuid; b uuid; c uuid; ghost uuid := gen_random_uuid();
begin
  select id into pr from public.programs where name = 'Program Uji CF';
  select id into ct from public.class_types where name = 'Tipe Uji CF';
  select id into rb from public.rombels where name = 'CF 1';
  select id into a from public.subtests where code = 'UJA';
  select id into b from public.subtests where code = 'UJB';
  select id into c from public.subtests where code = 'UJC';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;

  perform public.set_subtest_distribution('class_type', ct, jsonb_build_array(
    jsonb_build_object('subtest_id', a, 'sessions_per_week', 2),
    jsonb_build_object('subtest_id', b, 'sessions_per_week', 1),
    jsonb_build_object('label', 'UJA/UJB Flexible', 'flexible_subtest_ids', jsonb_build_array(a, b), 'sessions_per_week', 1)));
  assert (select count(*) from public.subtest_distribution_items where scope_type = 'class_type' and scope_id = ct) = 3, 'tiga item tersimpan';
  assert (select sum(sessions_per_week) from public.subtest_distribution_items where scope_type = 'class_type' and scope_id = ct) = 4, 'total 4';
  assert (select cardinality(flexible_subtest_ids) from public.subtest_distribution_items where label = 'UJA/UJB Flexible') = 2,
    'item fleksibel menyimpan subtes yang diperbolehkan';
  assert (select count(*) from public.subtests where code like 'UJ%') = 3, 'item fleksibel BUKAN subtes baru';
  raise notice 'PASS 07 simpan distribusi dengan item fleksibel (bukan subtes baru)';

  -- mengganti = atomik dan penuh
  perform public.set_subtest_distribution('class_type', ct, jsonb_build_array(
    jsonb_build_object('subtest_id', c, 'sessions_per_week', 5)));
  assert (select count(*) from public.subtest_distribution_items where scope_type = 'class_type' and scope_id = ct) = 1, 'diganti penuh';
  assert (select subtest_id from public.subtest_distribution_items where scope_id = ct) = c, 'isi baru';

  -- setiap kegagalan membatalkan seluruh penggantian (distribusi lama tetap)
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 1), jsonb_build_object('subtest_id', a, 'sessions_per_week', 1))), '23505');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 0))), '23514');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 100))), '23514');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 1.5))), '22023');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', ghost, 'sessions_per_week', 1))), 'P0002');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('label', 'F', 'flexible_subtest_ids', jsonb_build_array(a, ghost), 'sessions_per_week', 1))), 'P0002');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('label', 'F', 'flexible_subtest_ids', jsonb_build_array(a), 'sessions_per_week', 1))), '23514');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('label', 'F', 'flexible_subtest_ids', jsonb_build_array(a, a), 'sessions_per_week', 1))), 'P0002');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'label', 'X', 'sessions_per_week', 1))), '23514');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('label', 'F', 'flexible_subtest_ids', jsonb_build_array(a, b), 'sessions_per_week', 1),
                      jsonb_build_object('label', ' f ', 'flexible_subtest_ids', jsonb_build_array(b, c), 'sessions_per_week', 1))), '23505');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,'[]'::jsonb)$q$, ct), '22023');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,'{}'::jsonb)$q$, ct), '22023');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,'[1]'::jsonb)$q$, ct), '22023');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,'[{"subtest_id":"%s"}]'::jsonb)$q$, ct, a), '22023');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('program',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 1))), 'P0002');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('global',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 1))), 'P0002');
  assert (select count(*) from public.subtest_distribution_items where scope_type = 'class_type' and scope_id = ct) = 1
     and (select subtest_id from public.subtest_distribution_items where scope_id = ct) = c,
    'semua kegagalan membatalkan penggantian; distribusi lama utuh';
  raise notice 'PASS 08 input buruk ditolak dan penggantian tidak pernah setengah jadi';

  -- scope program dan rombel terpisah
  perform public.set_subtest_distribution('program', pr, jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 3)));
  perform public.set_subtest_distribution('rombel', rb, jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 4)));
  assert (select count(*) from public.subtest_distribution_items where scope_id in (pr, ct, rb)) = 3, 'tiga scope, masing-masing satu item';
  perform public.clear_subtest_distribution('rombel', rb);
  assert (select count(*) from public.subtest_distribution_items where scope_id in (pr, ct)) = 2, 'clear hanya scope itu';
  perform public.clear_subtest_distribution('rombel', rb);
  raise notice 'PASS 09 scope program/tipe/rombel terpisah; clear idempoten';

  -- subtes yang dipakai distribusi tidak bisa dihapus (on delete restrict); tidak ada DELETE grant juga
  perform public._t_expect_error(format($q$delete from public.subtest_distribution_items where scope_id = %L$q$, ct), '42501');
  perform public._t_expect_error($q$insert into public.subtest_distribution_items (scope_type, scope_id, sessions_per_week) values ('rombel', gen_random_uuid(), 1)$q$, '42501');
  reset role;
  perform public._t_expect_error(format($q$delete from public.subtests where id = %L$q$, c), '23503');
  raise notice 'PASS 10 tidak bisa tulis langsung; subtes yang dipakai tidak bisa dihapus';
end $$;

-- ---------------------------------------------------------------- tutor & anon
do $$
declare
  ct uuid; rb uuid; a uuid;
begin
  select id into ct from public.class_types where name = 'Tipe Uji CF';
  select id into rb from public.rombels where name = 'CF 1';
  select id into a from public.subtests where code = 'UJA';
  -- fixture sebagai postgres
  insert into public.scheduling_settings (key, scope_type, scope_id, value) values ('sessions_per_day', 'rombel', rb, '3');

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.scheduling_settings) = 0, 'tutor tidak melihat konfigurasi (RLS)';
  assert (select count(*) from public.subtest_distribution_items) = 0, 'tutor tidak melihat distribusi (RLS)';
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'9'::jsonb)$q$, rb), '42501');
  perform public._t_expect_error(format($q$select public.clear_scheduling_setting('sessions_per_day','rombel',%L,null)$q$, rb), '42501');
  perform public._t_expect_error(format($q$select public.set_subtest_distribution('class_type',%L,%L::jsonb)$q$, ct,
    jsonb_build_array(jsonb_build_object('subtest_id', a, 'sessions_per_week', 1))), '42501');
  perform public._t_expect_error(format($q$select public.clear_subtest_distribution('class_type',%L)$q$, ct), '42501');
  reset role;

  set local role anon;
  perform public._t_expect_error('select * from public.scheduling_settings', '42501');
  perform public._t_expect_error('select * from public.subtest_distribution_items', '42501');
  perform public._t_expect_error(format($q$select public.set_scheduling_setting('sessions_per_day','rombel',%L,null,'9'::jsonb)$q$, rb), '42501');
  perform public._t_expect_error(format($q$select public.clear_subtest_distribution('class_type',%L)$q$, ct), '42501');
  reset role;

  assert (select value from public.scheduling_settings where scope_type = 'rombel' and scope_id = rb and key = 'sessions_per_day') = '3'::jsonb,
    'data tidak berubah oleh tutor/anon';
  raise notice 'PASS 11 tutor dan anon tidak bisa membaca atau mengubah konfigurasi';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
