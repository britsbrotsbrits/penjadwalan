-- Phase 14 (lanjutan): pasangan subtes yang sebaiknya TIDAK berada di rombel yang sama pada hari yang sama.
--
-- Aturan LUNAK: penjadwal menghindarinya bila bisa, tidak pernah menggagalkan jadwal karenanya.
-- Isi awal (dicocokkan lewat kode subtes): PPU-KMM, PK-PM, LBI-PU. Pasangan yang kodenya tidak ada
-- di master data dilewati tanpa error.

create table public.subtest_day_exclusions (
  subtest_a uuid not null references public.subtests (id) on delete cascade,
  subtest_b uuid not null references public.subtests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subtest_a, subtest_b),
  constraint subtest_day_exclusions_ordered check (subtest_a < subtest_b)
);

comment on table public.subtest_day_exclusions is
  'Pasangan subtes yang sebaiknya tidak sehari dalam satu rombel (aturan lunak penjadwal). subtest_a < subtest_b.';

alter table public.subtest_day_exclusions enable row level security;
create policy subtest_day_exclusions_select_admin
  on public.subtest_day_exclusions for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.subtest_day_exclusions from public, anon, authenticated;
grant select on table public.subtest_day_exclusions to authenticated;
grant all on table public.subtest_day_exclusions to service_role;

insert into public.subtest_day_exclusions (subtest_a, subtest_b)
select least(a.id, b.id), greatest(a.id, b.id)
from (values ('PPU', 'KMM'), ('PK', 'PM'), ('LBI', 'PU')) as v (ca, cb)
join public.subtests a on a.code = v.ca
join public.subtests b on b.code = v.cb
on conflict do nothing;
