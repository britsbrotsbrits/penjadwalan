-- Phase 7: konfigurasi akademik.
--   * scheduling_settings        : nilai konfigurasi per key pada hierarki global > program > tipe kelas
--                                  > rombel > rombel+hari (resolver ada di aplikasi, src/lib/config).
--   * subtest_distribution_items : distribusi subtes per minggu pada scope program / tipe kelas / rombel.
-- Tulis hanya lewat RPC (SECURITY DEFINER, admin saja). Tidak ada hak INSERT/UPDATE/DELETE langsung.
-- Catatan: kolom periode (period_id) BELUM ada karena schedule_periods baru dibuat di fase penjadwalan.
-- Key yang dikenal database saat ini: sessions_per_day, weekly_sessions (bilangan bulat).
-- Prasyarat: migrasi Phase 2, 3, 4.

-- ---------------------------------------------------------------------------
-- scheduling_settings
-- ---------------------------------------------------------------------------

create table public.scheduling_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  scope_type text not null,
  scope_id uuid,
  day_of_week smallint,
  value jsonb not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduling_settings_key_known check (key in ('sessions_per_day', 'weekly_sessions')),
  constraint scheduling_settings_scope_type check (
    scope_type in ('global', 'program', 'class_type', 'rombel', 'rombel_day')
  ),
  constraint scheduling_settings_scope_shape check (
    (scope_type = 'global' and scope_id is null)
    or (scope_type <> 'global' and scope_id is not null)
  ),
  constraint scheduling_settings_day_shape check (
    -- coalesce: day_of_week NULL membuat 'between' bernilai NULL, dan check bernilai NULL LOLOS.
    (scope_type = 'rombel_day' and coalesce(day_of_week between 1 and 7, false))
    or (scope_type <> 'rombel_day' and day_of_week is null)
  ),
  -- CASE (bukan AND) agar nilai bukan-angka ditolak sebagai pelanggaran check, bukan error cast.
  constraint scheduling_settings_value_integer check (
    case when jsonb_typeof(value) = 'number'
      then (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
      else false end
  ),
  constraint scheduling_settings_value_range check (
    case when jsonb_typeof(value) = 'number'
      then (key = 'sessions_per_day' and (value #>> '{}')::numeric between 1 and 99)
        or (key = 'weekly_sessions' and (value #>> '{}')::numeric between 1 and 999)
      else false end
  )
);

create unique index scheduling_settings_scope_key on public.scheduling_settings (
  key,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(day_of_week, 0)
);

comment on table public.scheduling_settings is
  'Konfigurasi akademik per key dan scope. Nilai paling spesifik menang (resolver di aplikasi).';

create trigger scheduling_settings_set_updated_at
  before update on public.scheduling_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subtest_distribution_items
-- ---------------------------------------------------------------------------

create table public.subtest_distribution_items (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null,
  scope_id uuid not null,
  -- Item biasa: subtest_id terisi. Item fleksibel (mis. "KMM/PPU Flexible"): subtest_id NULL,
  -- label terisi, flexible_subtest_ids berisi subtes yang boleh mengisi slot itu.
  subtest_id uuid references public.subtests (id) on delete restrict,
  flexible_subtest_ids uuid[] not null default '{}',
  label text,
  sessions_per_week smallint not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint subtest_distribution_scope_type check (scope_type in ('program', 'class_type', 'rombel')),
  constraint subtest_distribution_sessions_range check (sessions_per_week between 1 and 99),
  constraint subtest_distribution_sort_range check (sort_order between 0 and 9999),
  constraint subtest_distribution_shape check (
    (subtest_id is not null and cardinality(flexible_subtest_ids) = 0 and label is null)
    or (
      subtest_id is null
      and cardinality(flexible_subtest_ids) >= 2
      and label is not null
      and char_length(btrim(label)) between 1 and 100
    )
  )
);

create unique index subtest_distribution_unique_subtest
  on public.subtest_distribution_items (scope_type, scope_id, subtest_id)
  where subtest_id is not null;
create unique index subtest_distribution_unique_label
  on public.subtest_distribution_items (scope_type, scope_id, lower(btrim(label)))
  where label is not null;
create index subtest_distribution_scope_idx
  on public.subtest_distribution_items (scope_type, scope_id);

comment on table public.subtest_distribution_items is
  'Distribusi subtes per minggu. Scope terdekat yang punya item menang (rombel > tipe kelas > program).';

-- ---------------------------------------------------------------------------
-- RLS dan hak
-- ---------------------------------------------------------------------------

alter table public.scheduling_settings enable row level security;
alter table public.subtest_distribution_items enable row level security;

create policy scheduling_settings_select_admin
  on public.scheduling_settings for select to authenticated
  using ((select public.is_admin()));
create policy subtest_distribution_select_admin
  on public.subtest_distribution_items for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.scheduling_settings, public.subtest_distribution_items
  from public, anon, authenticated;
grant select on table public.scheduling_settings, public.subtest_distribution_items to authenticated;
grant all on table public.scheduling_settings, public.subtest_distribution_items to service_role;

-- ---------------------------------------------------------------------------
-- RPC: set_scheduling_setting / clear_scheduling_setting
-- ---------------------------------------------------------------------------

create or replace function public._config_scope_exists(p_scope_type text, p_scope_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_scope_type
    when 'program' then exists (select 1 from public.programs where id = p_scope_id)
    when 'class_type' then exists (select 1 from public.class_types where id = p_scope_id)
    when 'rombel' then exists (select 1 from public.rombels where id = p_scope_id)
    when 'rombel_day' then exists (select 1 from public.rombels where id = p_scope_id)
    else false
  end;
$$;

revoke all on function public._config_scope_exists(text, uuid) from public, anon, authenticated;

create or replace function public.set_scheduling_setting(
  p_key text,
  p_scope_type text,
  p_scope_id uuid,
  p_day smallint,
  p_value jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah konfigurasi' using errcode = '42501';
  end if;

  if p_scope_type is distinct from 'global' then
    if p_scope_type is null or p_scope_id is null
       or not coalesce(public._config_scope_exists(p_scope_type, p_scope_id), false) then
      raise exception 'scope konfigurasi tidak ditemukan' using errcode = 'P0002';
    end if;
  end if;

  -- Bentuk/rentang nilai dijaga constraint tabel (kode 23514); update dulu, insert bila belum ada.
  update public.scheduling_settings s
     set value = p_value, updated_by = auth.uid()
   where s.key = p_key
     and s.scope_type = p_scope_type
     and s.scope_id is not distinct from p_scope_id
     and s.day_of_week is not distinct from p_day;
  if not found then
    insert into public.scheduling_settings (key, scope_type, scope_id, day_of_week, value, updated_by)
    values (p_key, p_scope_type, p_scope_id, p_day, p_value, auth.uid());
  end if;
end;
$$;

create or replace function public.clear_scheduling_setting(
  p_key text,
  p_scope_type text,
  p_scope_id uuid,
  p_day smallint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah konfigurasi' using errcode = '42501';
  end if;

  -- Tidak ada baris = sudah mewarisi parent; bukan error (idempoten).
  delete from public.scheduling_settings s
   where s.key = p_key
     and s.scope_type = p_scope_type
     and s.scope_id is not distinct from p_scope_id
     and s.day_of_week is not distinct from p_day;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: set_subtest_distribution / clear_subtest_distribution
-- p_items: array objek {subtest_id?, flexible_subtest_ids?, label?, sessions_per_week}
-- Mengganti SELURUH distribusi pada scope itu secara atomik.
-- ---------------------------------------------------------------------------

create or replace function public.set_subtest_distribution(
  p_scope_type text,
  p_scope_id uuid,
  p_items jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  idx integer := 0;
  flex_ids uuid[];
  n integer;
  expected integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah distribusi' using errcode = '42501';
  end if;

  if p_scope_type is null or p_scope_type not in ('program', 'class_type', 'rombel')
     or p_scope_id is null
     or not coalesce(public._config_scope_exists(p_scope_type, p_scope_id), false) then
    raise exception 'scope distribusi tidak ditemukan' using errcode = 'P0002';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items harus berupa array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'terlalu banyak item distribusi' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'distribusi kosong; gunakan clear_subtest_distribution' using errcode = '22023';
  end if;

  -- Kunci per scope agar dua simpan bersamaan tidak saling menimpa setengah-setengah.
  perform pg_advisory_xact_lock(hashtextextended('subtest_distribution:' || p_scope_type || ':' || p_scope_id::text, 0));

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item -> 'sessions_per_week') is distinct from 'number' then
      raise exception 'bentuk item distribusi tidak valid' using errcode = '22023';
    end if;
    if (item ->> 'sessions_per_week')::numeric <> trunc((item ->> 'sessions_per_week')::numeric) then
      raise exception 'sessions_per_week harus bilangan bulat' using errcode = '22023';
    end if;
    if (item -> 'subtest_id') is not null and jsonb_typeof(item -> 'subtest_id') not in ('string', 'null') then
      raise exception 'subtest_id tidak valid' using errcode = '22023';
    end if;
    if (item -> 'flexible_subtest_ids') is not null
       and jsonb_typeof(item -> 'flexible_subtest_ids') not in ('array', 'null') then
      raise exception 'flexible_subtest_ids tidak valid' using errcode = '22023';
    end if;
  end loop;

  delete from public.subtest_distribution_items
   where scope_type = p_scope_type and scope_id = p_scope_id;

  for item in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    flex_ids := coalesce(
      array(select jsonb_array_elements_text(item -> 'flexible_subtest_ids')::uuid),
      '{}'::uuid[]
    );
    -- Subtes yang dirujuk harus ada (FK tidak bisa memeriksa isi array).
    select count(*) into n from public.subtests st
     where st.id = any (flex_ids) or st.id = (item ->> 'subtest_id')::uuid;
    -- Hitung dulu ke variabel: parser plpgsql berhenti di THEN pertama, termasuk THEN milik CASE.
    expected := cardinality(flex_ids) + (case when item ->> 'subtest_id' is null then 0 else 1 end);
    if n <> expected then
      raise exception 'subtes pada item % tidak ditemukan atau ganda', idx using errcode = 'P0002';
    end if;

    -- Constraint tabel menjaga bentuk, rentang, dan keunikan (kode 23514 / 23505).
    insert into public.subtest_distribution_items
      (scope_type, scope_id, subtest_id, flexible_subtest_ids, label, sessions_per_week, sort_order)
    values (
      p_scope_type,
      p_scope_id,
      (item ->> 'subtest_id')::uuid,
      flex_ids,
      nullif(btrim(item ->> 'label'), ''),
      (item ->> 'sessions_per_week')::numeric::smallint,
      idx
    );
  end loop;
end;
$$;

create or replace function public.clear_subtest_distribution(p_scope_type text, p_scope_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah distribusi' using errcode = '42501';
  end if;
  delete from public.subtest_distribution_items
   where scope_type = p_scope_type and scope_id = p_scope_id;
end;
$$;

revoke all on function public.set_scheduling_setting(text, text, uuid, smallint, jsonb) from public, anon, authenticated;
revoke all on function public.clear_scheduling_setting(text, text, uuid, smallint) from public, anon, authenticated;
revoke all on function public.set_subtest_distribution(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.clear_subtest_distribution(text, uuid) from public, anon, authenticated;
grant execute on function public.set_scheduling_setting(text, text, uuid, smallint, jsonb) to authenticated, service_role;
grant execute on function public.clear_scheduling_setting(text, text, uuid, smallint) to authenticated, service_role;
grant execute on function public.set_subtest_distribution(text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.clear_subtest_distribution(text, uuid) to authenticated, service_role;
