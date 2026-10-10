-- Atur sesi default rombel kelas 3 SMA. Jalankan di Supabase SQL Editor.
-- LANGKAH 1: jalankan blok PREVIEW dulu, cek daftar rombel & sesi yang akan dipakai.
-- LANGKAH 2: jika sudah benar, jalankan blok UPDATE.
-- Aturan: General A-E, VVIP A, VVIP B, Fast Track A => sesi 4; rombel SMA lain => sesi 5.
-- Penyesuaian: ubah pola LIKE di bawah bila nama rombel/tipe kelas Anda berbeda.

-- PREVIEW
select r.name as rombel, ct.name as tipe_kelas,
  case when r.name ~* '(general\s*[a-e]\b|vvip\s*[ab]\b|fast\s*track\s*a\b)' then 4 else 5 end as sesi_baru,
  r.default_slot_no as sesi_sekarang
from public.rombels r join public.class_types ct on ct.id = r.class_type_id
where r.is_active and (ct.name ilike '%sma%' ) and ct.name !~* 'gap'
order by 3, 1;

-- UPDATE (hapus tanda komentar setelah preview benar)
-- update public.rombels r set default_slot_no =
--   case when r.name ~* '(general\s*[a-e]\b|vvip\s*[ab]\b|fast\s*track\s*a\b)' then 4 else 5 end
-- from public.class_types ct
-- where ct.id = r.class_type_id and r.is_active and ct.name ilike '%sma%' and ct.name !~* 'gap';
