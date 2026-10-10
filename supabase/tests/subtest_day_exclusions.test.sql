-- Tes tabel subtest_day_exclusions: isi awal, constraint urutan, hak akses.
-- Jalankan di SQL Editor / psql sebagai postgres; semua perubahan di-ROLLBACK.
-- Syarat: migrasi sampai 20261014100000_subtest_day_exclusions.sql dan seed subtes (PPU, KMM, PK, PM, LBI, PU).
begin;

-- Di database kosong seed subtes jalan SETELAH migrasi, jadi isi awal diulang dengan perintah yang sama (aman diulang).
insert into public.subtest_day_exclusions (subtest_a, subtest_b)
select least(a.id, b.id), greatest(a.id, b.id)
from (values ('PPU', 'KMM'), ('PK', 'PM'), ('LBI', 'PU')) as v (ca, cb)
join public.subtests a on a.code = v.ca
join public.subtests b on b.code = v.cb
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.subtest_day_exclusions;
  if n <> 3 then raise exception 'isi awal harus 3 pasangan, ada %', n; end if;
  if exists (select 1 from public.subtest_day_exclusions where subtest_a >= subtest_b) then
    raise exception 'subtest_a harus < subtest_b';
  end if;
  if not exists (
    select 1 from public.subtest_day_exclusions e
    join public.subtests a on a.id = e.subtest_a join public.subtests b on b.id = e.subtest_b
    where a.code in ('PK','PM') and b.code in ('PK','PM')
  ) then raise exception 'pasangan PK-PM tidak ada'; end if;
  begin
    insert into public.subtest_day_exclusions select subtest_b, subtest_a from public.subtest_day_exclusions limit 1;
    raise exception 'urutan terbalik harus ditolak';
  exception when check_violation then null;
  end;
  begin
    insert into public.subtest_day_exclusions select subtest_a, subtest_a from public.subtest_day_exclusions limit 1;
    raise exception 'pasangan dengan dirinya sendiri harus ditolak';
  exception when check_violation then null;
  end;
end $$;

-- hak akses: anon tidak bisa membaca; authenticated hanya select (dan RLS admin)
do $$
begin
  if has_table_privilege('anon', 'public.subtest_day_exclusions', 'select') then raise exception 'anon tidak boleh select'; end if;
  if has_table_privilege('authenticated', 'public.subtest_day_exclusions', 'insert') then raise exception 'authenticated tidak boleh insert'; end if;
  raise notice 'PASS subtest_day_exclusions';
end $$;

rollback;
