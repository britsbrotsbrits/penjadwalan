-- Tes ruangan tetap (fixed room) per rombel (Phase 6): rombels.fixed_room_id, trigger
-- rombels_check_fixed_room, hak akses, dan aturan berbagi/kapasitas/nonaktif.
--
-- Cara pakai: jalankan SELURUH file ini di SQL Editor Supabase (project DEV/scratch) atau lewat
-- psql sebagai role postgres. Semua perubahan di-ROLLBACK di akhir. Tes memakai nama "Uji" sendiri
-- dan tidak bergantung pada isi database.
-- Sukses = tidak ada error merah (di psql: NOTICE "PASS ..." dan "SEMUA TES LULUS").
--
-- Syarat: migrasi Phase 2, 3, 4, dan 6 (fixed room) sudah dijalankan.
-- Jika SQL Editor memperingatkan "tanpa RLS" atau "destructive", pilih "Run without RLS"
-- (tabel pembantu hanya ada selama transaksi ini lalu dibatalkan).

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

-- Fixture: admin (g1), tutor aktif (g2).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'fr-admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'fr-tutor@test.local', '{}');
update public.profiles set role = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000c2';

insert into public.rooms (name, capacity, is_active) values
  ('Uji Ruang A', 10, true), ('Uji Ruang B', 2, true), ('Uji Ruang C', 6, true), ('Uji Ruang Mati', 8, false);
insert into public.programs (name) values ('Program Uji FR');
insert into public.class_types (program_id, name, default_size)
  select id, 'Tipe Uji FR', 10 from public.programs where name = 'Program Uji FR';
insert into public.rombels (class_type_id, name)
  select ct.id, v.name from public.class_types ct, (values ('FR 1'), ('FR 2')) as v(name) where ct.name = 'Tipe Uji FR';
insert into public.students (full_name, rombel_id)
  select 'Siswa FR ' || g, (select id from public.rombels where name = 'FR 1')
  from generate_series(1, 3) as g;

-- ---------------------------------------------------------------- admin
do $$
declare
  ct uuid; ra uuid; rb uuid; rc uuid; rdead uuid; r1 uuid; r2 uuid; r3 uuid;
begin
  select id into ct from public.class_types where name = 'Tipe Uji FR';
  select id into ra from public.rooms where name = 'Uji Ruang A';
  select id into rb from public.rooms where name = 'Uji Ruang B';
  select id into rc from public.rooms where name = 'Uji Ruang C';
  select id into rdead from public.rooms where name = 'Uji Ruang Mati';
  select id into r1 from public.rombels where name = 'FR 1';
  select id into r2 from public.rombels where name = 'FR 2';

  assert (select fixed_room_id from public.rombels where id = r1) is null, 'rombel baru: tanpa ruangan tetap';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;

  -- INSERT
  insert into public.rombels (class_type_id, name, fixed_room_id) values (ct, 'FR 3', ra);
  select id into r3 from public.rombels where name = 'FR 3';
  assert (select fixed_room_id from public.rombels where id = r3) = ra, 'INSERT dengan ruangan tetap aktif harus berhasil';
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name, fixed_room_id) values (%L, 'FR X', %L)$q$, ct, rdead), '23514');
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name, fixed_room_id) values (%L, 'FR Y', %L)$q$, ct, gen_random_uuid()), '23514');
  raise notice 'PASS 01 INSERT rombel: ruangan tetap harus ada dan aktif';

  -- UPDATE
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rb, r1)) = 1, 'UPDATE ke ruangan aktif';
  assert (select fixed_room_id from public.rombels where id = r1) = rb, 'ruangan tetap tersimpan';
  perform public._t_expect_error(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rdead, r1), '23514');
  perform public._t_expect_error(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, gen_random_uuid(), r1), '23514');
  assert (select fixed_room_id from public.rombels where id = r1) = rb, 'percobaan gagal tidak mengubah ruangan tetap';
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = null where id = %L$q$, r1)) = 1, 'ruangan tetap boleh dikosongkan';
  assert (select fixed_room_id from public.rombels where id = r1) is null, 'NULL tersimpan';
  raise notice 'PASS 02 UPDATE rombel: ganti, kosongkan, dan tolak ruangan nonaktif/tidak ada';

  -- Berbagi ruangan (DEC-03)
  update public.rombels set fixed_room_id = ra where id in (r1, r2);
  assert (select count(*) from public.rombels where fixed_room_id = ra and id in (r1, r2, r3)) = 3,
    'beberapa rombel boleh memakai ruangan tetap yang sama';
  raise notice 'PASS 03 beberapa rombel boleh berbagi satu ruangan tetap (DEC-03)';

  -- Kapasitas tidak dipaksa di database (DEC-02): FR 1 punya 3 siswa, ruang B hanya 2 kursi.
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rb, r1)) = 1,
    'kapasitas ruangan tidak dipaksa oleh database';
  raise notice 'PASS 04 kapasitas kurang tidak diblokir database (dicek validator/UI)';

  -- Ruangan dinonaktifkan saat dipakai: diizinkan; rombel tetap bisa diedit
  assert public._t_rowcount(format($q$update public.rooms set is_active = false where id = %L$q$, rb)) = 1,
    'admin boleh menonaktifkan ruangan yang dipakai sebagai ruangan tetap';
  assert public._t_rowcount(format($q$update public.rombels set name = 'FR 1 baru' where id = %L$q$, r1)) = 1,
    'mengubah kolom lain pada rombel yang ruangannya nonaktif harus tetap berhasil';
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rb, r1)) = 1,
    'menyimpan ulang NILAI YANG SAMA (ruangan kini nonaktif) tidak boleh ditolak';
  perform public._t_expect_error(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rdead, r1), '23514');
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = %L where id = %L$q$, rc, r1)) = 1,
    'pindah dari ruangan nonaktif ke ruangan aktif berhasil';
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = null where id = %L$q$, r1)) = 1, 'kosongkan';
  raise notice 'PASS 05 ruangan yang dinonaktifkan tidak mengunci rombel; pilihan baru tetap harus aktif';

  -- Tidak ada DELETE
  perform public._t_expect_error(format($q$delete from public.rooms where id = %L$q$, ra), '42501');
  perform public._t_expect_error(format($q$delete from public.rombels where id = %L$q$, r1), '42501');
  reset role;

  -- Konteks tepercaya: FK RESTRICT mencegah ruangan yang dipakai terhapus.
  perform public._t_expect_error(format($q$delete from public.rooms where id = %L$q$, ra), '23503');
  raise notice 'PASS 06 tidak ada DELETE; ruangan yang dipakai rombel tidak bisa terhapus (RESTRICT)';
end $$;

-- ---------------------------------------------------------------- tutor & anon
do $$
declare ra uuid; r2 uuid;
begin
  select id into ra from public.rooms where name = 'Uji Ruang A';
  select id into r2 from public.rombels where name = 'FR 2';

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  set local role authenticated;
  assert (select count(*) from public.rombels) = 0, 'tutor tidak boleh melihat rombels (jadi fixed_room_id tertutup)';
  assert public._t_rowcount(format($q$update public.rombels set fixed_room_id = null where id = %L$q$, r2)) = 0,
    'tutor tidak boleh mengubah ruangan tetap';
  perform public._t_expect_error(
    format($q$insert into public.rombels (class_type_id, name, fixed_room_id) values (gen_random_uuid(), 'X', %L)$q$, ra), '42501');
  assert (select count(*) from public.rooms where name = 'Uji Ruang A') = 1, 'tutor tetap boleh membaca daftar ruangan';
  reset role;

  set local role anon;
  perform public._t_expect_error('select fixed_room_id from public.rombels', '42501');
  perform public._t_expect_error(format($q$update public.rombels set fixed_room_id = null where id = %L$q$, r2), '42501');
  reset role;
  assert (select fixed_room_id from public.rombels where id = r2) = ra, 'data tidak berubah oleh tutor/anon';
  raise notice 'PASS 07 tutor dan anon tidak bisa membaca atau mengubah ruangan tetap';
end $$;

do $$ begin raise notice 'SEMUA TES LULUS'; end $$;

rollback;
