-- Tes RLS untuk public.profiles (Phase 2).
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase pada project DEV/scratch,
-- atau lewat psql sebagai role postgres. Semua perubahan di-ROLLBACK di akhir.
-- Sukses = muncul NOTICE "PASS ..." untuk tiap kasus dan "SEMUA TES LULUS" di akhir.
-- Gagal = EXCEPTION dengan pesan kasus yang gagal.
--
-- Jangan jalankan di database produksi yang berisi data nyata (insert ke auth.users meski di-rollback).

begin;

-- Fixture: 4 user. Trigger signup harus membuat profile nonaktif bertipe tutor.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@test.local', '{"full_name":"Admin Satu"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@test.local', '{"full_name":"Admin Dua"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'tutor-a@test.local', '{"full_name":"Tutor A","role":"admin"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'tutor-b@test.local', '{"full_name":"Tutor B"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'inactive@test.local', '{}');

do $$
declare
  r public.profiles;
begin
  select * into r from public.profiles where id = '00000000-0000-0000-0000-0000000000b1';
  assert r.role = 'tutor', 'role dari user_metadata TIDAK boleh dipakai (harus tutor)';
  assert r.is_active = false, 'profile baru harus nonaktif';
  assert r.full_name = 'Tutor A', 'full_name diambil dari metadata';
  raise notice 'PASS 01 trigger signup: tutor + nonaktif, role metadata diabaikan';
end $$;

-- Bootstrap sebagai konteks tepercaya (auth.uid() = NULL, seperti service_role / SQL editor).
update public.profiles set role = 'admin', is_active = true
  where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
update public.profiles set is_active = true
  where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

-- 02: anon tidak punya akses ke tabel.
do $$
declare ok boolean := false;
begin
  set local role anon;
  begin
    perform count(*) from public.profiles;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  assert ok, 'anon HARUS ditolak membaca profiles';
  raise notice 'PASS 02 anon ditolak';
end $$;

-- 03: anon tidak bisa memanggil helper.
do $$
declare ok boolean := false;
begin
  set local role anon;
  begin
    perform public.is_admin();
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  assert ok, 'anon HARUS ditolak memanggil is_admin()';
  raise notice 'PASS 03 helper tidak bisa dipanggil anon';
end $$;

-- 04-09: tutor A (aktif).
do $$
declare
  n int;
  ok boolean;
  adm boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from public.profiles;
  assert n = 1, format('tutor A harus melihat 1 baris, dapat %s', n);
  raise notice 'PASS 04 tutor hanya melihat profile sendiri';

  select public.is_admin() into adm;
  assert adm = false, 'tutor bukan admin';
  raise notice 'PASS 05 is_admin() false untuk tutor';

  update public.profiles set full_name = 'Tutor A Baru'
    where id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 1, 'tutor boleh mengubah nama sendiri';
  raise notice 'PASS 06 tutor boleh ubah full_name sendiri';

  update public.profiles set full_name = 'Diretas'
    where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'tutor TIDAK boleh mengubah profile orang lain';
  raise notice 'PASS 07 tutor tidak bisa ubah profile tutor lain';

  ok := false;
  begin
    update public.profiles set role = 'admin'
      where id = '00000000-0000-0000-0000-0000000000b1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'tutor TIDAK boleh menaikkan role sendiri';
  raise notice 'PASS 08 eskalasi role diblokir';

  ok := false;
  begin
    update public.profiles set is_active = false
      where id = '00000000-0000-0000-0000-0000000000b1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'tutor TIDAK boleh mengubah is_active';
  raise notice 'PASS 09 perubahan is_active oleh non-admin diblokir';

  ok := false;
  begin
    insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000d1');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'tutor TIDAK boleh INSERT profile';
  raise notice 'PASS 10 INSERT oleh user ditolak';

  ok := false;
  begin
    delete from public.profiles where id = '00000000-0000-0000-0000-0000000000b1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'tutor TIDAK boleh DELETE profile';
  raise notice 'PASS 11 DELETE oleh user ditolak';

  reset role;
end $$;

-- 12-14: user nonaktif.
do $$
declare
  n int;
  adm boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from public.profiles;
  assert n = 1, 'user nonaktif hanya melihat profile sendiri';
  raise notice 'PASS 12 user nonaktif hanya melihat dirinya (agar UI bisa menampilkan status)';

  update public.profiles set full_name = 'x'
    where id = '00000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  assert n = 0, 'user nonaktif TIDAK boleh mengubah apa pun';
  raise notice 'PASS 13 user nonaktif tidak bisa update';

  select public.is_admin() into adm;
  assert adm = false, 'user nonaktif bukan admin';
  assert public.current_user_role() is null, 'current_user_role() NULL untuk user nonaktif';
  raise notice 'PASS 14 helper menganggap user nonaktif tanpa role';

  reset role;
end $$;

-- 15-19: admin.
do $$
declare
  n int;
  adm boolean;
  ok boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;

  select public.is_admin() into adm;
  assert adm = true, 'admin1 harus terdeteksi admin';

  select count(*) into n from public.profiles;
  assert n = 5, format('admin harus melihat semua 5 baris, dapat %s', n);
  raise notice 'PASS 15 admin melihat semua profile';

  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 1, 'admin boleh menaikkan role';
  update public.profiles set role = 'tutor' where id = '00000000-0000-0000-0000-0000000000b2';
  raise notice 'PASS 16 admin boleh mengubah role';

  update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  assert n = 1, 'admin boleh mengaktifkan user';
  update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000c1';
  raise notice 'PASS 17 admin boleh mengaktifkan/menonaktifkan user';

  ok := false;
  begin
    update public.profiles set id = '00000000-0000-0000-0000-0000000000e1'
      where id = '00000000-0000-0000-0000-0000000000b2';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'id profile tidak boleh diubah (grant kolom / guard)';
  raise notice 'PASS 18 id profile immutable';

  -- admin2 masih aktif, jadi admin1 boleh menurunkan dirinya.
  update public.profiles set role = 'tutor' where id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  assert n = 1, 'admin1 boleh turun role saat masih ada admin lain';
  raise notice 'PASS 19 admin boleh turun role bila ada admin aktif lain';

  reset role;
end $$;

-- 20: admin aktif terakhir tidak boleh dicopot (admin2 satu-satunya admin sekarang).
do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  set local role authenticated;
  begin
    update public.profiles set role = 'tutor' where id = '00000000-0000-0000-0000-0000000000a2';
  exception when check_violation then ok := true;
  end;
  assert ok, 'admin aktif TERAKHIR tidak boleh diturunkan';

  ok := false;
  begin
    update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a2';
  exception when check_violation then ok := true;
  end;
  assert ok, 'admin aktif TERAKHIR tidak boleh dinonaktifkan';
  reset role;
  raise notice 'PASS 20 admin aktif terakhir dilindungi';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
