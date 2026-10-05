-- Seed awal program dan tipe kelas (Phase 4). Sumber: Master Project Overview, bagian 4.
--
-- Ini DATA AWAL yang boleh diubah admin lewat aplikasi, BUKAN aturan di kode.
-- Angka di samping tipe kelas adalah UKURAN STANDAR (jumlah siswa), bukan batas keras.
-- Rombel (Junior A, Junior B, ...) dan siswa sengaja TIDAK di-seed: admin membuatnya lewat aplikasi.
-- Default sesi per hari tiap tipe kelas belum ada di sini; itu konfigurasi Phase 7.
--
-- Prasyarat: migrasi 20261005100000_create_academic_structure.sql sudah dijalankan.
-- Cara pakai: tempel seluruh file di Supabase SQL Editor lalu Run.
-- AMAN dijalankan berulang: tiap tabel hanya diisi bila MASIH KOSONG, jadi data yang sudah
-- Anda ubah atau tambah lewat aplikasi tidak ditimpa atau dihidupkan kembali.

insert into public.programs (name, sort_order)
select v.name, v.sort_order
from (values
  ('Kelas 3 SMA', 1),
  ('Super Camp', 2),
  ('Super Intensif', 3),
  ('Gap Year', 4)
) as v(name, sort_order)
where not exists (select 1 from public.programs);

insert into public.class_types (program_id, name, default_size, sort_order)
select p.id, v.name, v.default_size, v.sort_order
from (values
  ('Kelas 3 SMA', 'General', 20, 1),
  ('Kelas 3 SMA', 'VVIP', 13, 2),
  ('Kelas 3 SMA', 'Fast Track', 7, 3),

  ('Super Camp', 'VVIP', 7, 1),
  ('Super Camp', 'Gold', 3, 2),
  ('Super Camp', 'Platinum', 1, 3),

  ('Super Intensif', 'Regular', 20, 1),
  ('Super Intensif', 'Junior', 14, 2),
  ('Super Intensif', 'VIP', 14, 3),
  ('Super Intensif', 'Eksekutif', 7, 4),

  ('Gap Year', 'Junior', 20, 1),
  ('Gap Year', 'Eksekutif', 14, 2),
  ('Gap Year', 'Gold', 6, 3),
  ('Gap Year', 'Platinum', 3, 4)
) as v(program_name, name, default_size, sort_order)
join public.programs p on p.name = v.program_name
where not exists (select 1 from public.class_types);
