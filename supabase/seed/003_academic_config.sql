-- Seed awal konfigurasi akademik (Phase 7). Sumber: Master Project Overview bagian 10 dan 11,
-- serta contoh total sesi/minggu di phase0-01-requirements-lock.md.
--
-- Ini DATA AWAL yang boleh diubah admin lewat aplikasi, BUKAN aturan di kode.
--  * sessions_per_day : default per tipe kelas (master prompt bagian 10).
--  * weekly_sessions  : HANYA tiga nilai yang disebut sebagai contoh: Kelas 3 SMA General = 6,
--                       Super Camp = 36 (level program), Super Intensif VIP = 24. Tipe kelas lain
--                       sengaja kosong (tidak dikarang); aplikasi menampilkan peringatan.
--  * Distribusi subtes: HANYA baseline tentatif Gap Year (level program, total 12). Program lain
--    sengaja kosong (TBD-03) dan muncul sebagai peringatan "distribusi belum ada".
--
-- Prasyarat: migrasi 20261008100000_create_academic_config.sql, seed 001 dan 002 sudah dijalankan.
-- AMAN dijalankan berulang: tiap tabel hanya diisi bila MASIH KOSONG.

insert into public.scheduling_settings (key, scope_type, scope_id, value)
select 'sessions_per_day', 'class_type', ct.id, to_jsonb(v.n)
from (values
  ('Kelas 3 SMA', 'General', 1),
  ('Kelas 3 SMA', 'VVIP', 1),
  ('Kelas 3 SMA', 'Fast Track', 2),
  ('Gap Year', 'Junior', 2),
  ('Gap Year', 'Eksekutif', 2),
  ('Gap Year', 'Gold', 2),
  ('Gap Year', 'Platinum', 2),
  ('Super Intensif', 'Regular', 2),
  ('Super Intensif', 'Junior', 3),
  ('Super Intensif', 'VIP', 4),
  ('Super Intensif', 'Eksekutif', 4),
  ('Super Camp', 'VVIP', 6),
  ('Super Camp', 'Gold', 6),
  ('Super Camp', 'Platinum', 6)
) as v(program, class_type, n)
join public.programs p on p.name = v.program
join public.class_types ct on ct.program_id = p.id and ct.name = v.class_type
where not exists (select 1 from public.scheduling_settings where key = 'sessions_per_day');

insert into public.scheduling_settings (key, scope_type, scope_id, value)
select 'weekly_sessions', v.scope_type, coalesce(ct.id, p.id), to_jsonb(v.n)
from (values
  ('class_type', 'Kelas 3 SMA', 'General', 6),
  ('class_type', 'Super Intensif', 'VIP', 24),
  ('program', 'Super Camp', null, 36)
) as v(scope_type, program, class_type, n)
join public.programs p on p.name = v.program
left join public.class_types ct on ct.program_id = p.id and ct.name = v.class_type
where (v.scope_type = 'program' or ct.id is not null)
  and not exists (select 1 from public.scheduling_settings where key = 'weekly_sessions');

-- Baseline Gap Year (tentatif): KMM 1, PPU 1, KMM/PPU Flexible 1, PM 2, PK 3, PU 2, LBI 1, LBE 1 = 12.
-- "KMM/PPU Flexible" BUKAN subtes baru: item fleksibel yang boleh diisi KMM atau PPU.
insert into public.subtest_distribution_items (scope_type, scope_id, subtest_id, sessions_per_week, sort_order)
select 'program', p.id, st.id, v.n, v.ord
from (values ('KMM', 1, 1), ('PPU', 1, 2), ('PM', 2, 4), ('PK', 3, 5), ('PU', 2, 6), ('LBI', 1, 7), ('LBE', 1, 8))
  as v(code, n, ord)
join public.programs p on p.name = 'Gap Year'
join public.subtests st on st.code = v.code
where not exists (select 1 from public.subtest_distribution_items);

insert into public.subtest_distribution_items
  (scope_type, scope_id, subtest_id, flexible_subtest_ids, label, sessions_per_week, sort_order)
select 'program', p.id, null,
       array(select id from public.subtests where code in ('KMM', 'PPU') order by code),
       'KMM/PPU Flexible', 1, 3
from public.programs p
where p.name = 'Gap Year'
  and (select count(*) from public.subtests where code in ('KMM', 'PPU')) = 2
  and not exists (select 1 from public.subtest_distribution_items
                  where scope_type = 'program' and scope_id = p.id and label is not null);
