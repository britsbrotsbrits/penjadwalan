-- Seed awal master data (Phase 3). Sumber: Master Project Overview, bagian 6, 8, dan 9.
--
-- Ini DATA AWAL yang boleh diubah admin lewat aplikasi, BUKAN aturan di kode.
-- Daftar ruangan BELUM FINAL (masih ada ruangan lain yang akan ditambahkan; TBD-04).
-- Aturan break antar sesi belum ditentukan (TBD-02), jadi slot dibuat bersebelahan.
--
-- Cara pakai: tempel seluruh file ini di Supabase SQL Editor lalu Run.
-- AMAN dijalankan berulang: tiap tabel hanya diisi bila MASIH KOSONG, jadi data yang sudah
-- Anda ubah atau tambah lewat aplikasi tidak akan ditimpa atau dihidupkan kembali.

-- Subtes (master data extensible, urutan sesuai master prompt)
insert into public.subtests (code, name, sort_order)
select v.code, v.name, v.sort_order
from (values
  ('LBI', 'Literasi Bahasa Indonesia', 1),
  ('LBE', 'Literasi Bahasa Inggris', 2),
  ('PU',  'Penalaran Umum', 3),
  ('PPU', 'Pengetahuan dan Pemahaman Umum', 4),
  ('KMM', 'Kemampuan Membaca dan Menulis', 5),
  ('PM',  'Penalaran Matematika', 6),
  ('PK',  'Penalaran Kuantitatif', 7)
) as v(code, name, sort_order)
where not exists (select 1 from public.subtests);

-- Ruangan awal (15, belum final)
insert into public.rooms (name, capacity)
select v.name, v.capacity
from (values
  ('Amsterdam', 20),
  ('Bolivia', 7),
  ('Kamerun', 20),
  ('Dominika', 3),
  ('Egypt', 20),
  ('Jordan', 13),
  ('Kanada', 13),
  ('Latvia', 20),
  ('France', 20),
  ('Grenada', 3),
  ('Hungaria', 6),
  ('Maroko', 13),
  ('Norwegia', 13),
  ('Oman', 20),
  ('Polandia', 14)
) as v(name, capacity)
where not exists (select 1 from public.rooms);

-- Slot sesi default: 8 sesi/hari, 90 menit, mulai 07.00 (semua configurable)
insert into public.session_slots (slot_no, start_time, duration_minutes)
select v.slot_no, v.start_time, v.duration_minutes
from (values
  (1::smallint, '07:00'::time, 90::smallint),
  (2::smallint, '08:30'::time, 90::smallint),
  (3::smallint, '10:00'::time, 90::smallint),
  (4::smallint, '11:30'::time, 90::smallint),
  (5::smallint, '13:00'::time, 90::smallint),
  (6::smallint, '14:30'::time, 90::smallint),
  (7::smallint, '16:00'::time, 90::smallint),
  (8::smallint, '17:30'::time, 90::smallint)
) as v(slot_no, start_time, duration_minutes)
where not exists (select 1 from public.session_slots);

-- Hari aktif (Senin-Sabtu) sudah dibuat oleh migrasi karena strukturnya tetap 7 baris.
