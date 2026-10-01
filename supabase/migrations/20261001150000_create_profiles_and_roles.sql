-- Phase 2: identitas dan role.
--
-- Isi migrasi ini:
--   * enum user_role, tabel profiles (1:1 dengan auth.users)
--   * trigger pembuatan profile saat user baru (selalu 'tutor' + NONAKTIF)
--   * helper RLS: current_user_role(), is_admin()
--   * RLS + grant minimum pada profiles
--   * guard: non-admin tidak bisa mengubah role/is_active; admin aktif terakhir tidak bisa dicopot
--
-- Keputusan keamanan (docs/phase-0/04-security-rls.md):
--   * Role disimpan di profiles.role, BUKAN di user_metadata (user bisa mengubah metadata sendiri).
--   * Profile baru selalu tutor + is_active = false. Admin mengaktifkan lewat server/SQL.
--     Dengan begitu, kalau signup publik tidak sengaja terbuka, user asing tidak mendapat akses apa pun.
--   * Konteks tepercaya tanpa JWT user (service_role, SQL editor) memiliki auth.uid() = NULL
--     dan boleh mengubah role/is_active. Itu jalur bootstrap admin pertama.

-- ---------------------------------------------------------------------------
-- Tipe dan tabel
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'tutor');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'tutor',
  full_name text not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 200)
);

comment on table public.profiles is
  'Profil aplikasi 1:1 dengan auth.users. Sumber kebenaran role (admin/tutor). Soft delete lewat is_active.';

-- ---------------------------------------------------------------------------
-- Fungsi util: updated_at
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pembuatan profile otomatis saat user baru
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Role TIDAK pernah diambil dari metadata. Hanya nama tampilan, dipotong sesuai constraint.
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper RLS (SECURITY DEFINER agar tidak rekursif terhadap RLS profiles)
-- ---------------------------------------------------------------------------

-- Role user saat ini; NULL jika belum login, tidak punya profile, atau nonaktif.
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- Guard perubahan profiles (pertahanan terakhir, di luar RLS dan kode aplikasi)
-- ---------------------------------------------------------------------------

create function public.profiles_guard_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profiles.id tidak boleh diubah' using errcode = '42501';
  end if;

  -- User dengan JWT yang bukan admin tidak boleh mengubah role atau status aktif (eskalasi hak akses).
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'hanya admin yang boleh mengubah role atau is_active' using errcode = '42501';
  end if;

  -- Selalu harus tersisa minimal satu admin aktif, supaya sistem tidak terkunci.
  if old.role = 'admin' and old.is_active
     and not (new.role = 'admin' and new.is_active) then
    if not exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and p.role = 'admin'
        and p.is_active
    ) then
      raise exception 'tidak boleh menonaktifkan atau menurunkan admin aktif terakhir'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_changes
  before update on public.profiles
  for each row execute function public.profiles_guard_changes();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Baca: diri sendiri (termasuk bila nonaktif, agar aplikasi bisa menampilkan status), atau admin.
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

-- Ubah: diri sendiri hanya bila aktif (kolom dibatasi lewat grant + guard); admin untuk semua.
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.current_user_role()) is not null)
  with check (id = (select auth.uid()));

create policy profiles_update_admin
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Sengaja TIDAK ada policy INSERT/DELETE: profile dibuat oleh trigger signup,
-- dan dihapus hanya lewat cascade dari auth.users (atau service_role). Nonaktifkan lewat is_active.

-- ---------------------------------------------------------------------------
-- Grants (least privilege; default privilege Supabase terlalu longgar)
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, role, is_active) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- Helper RLS hanya untuk user login; fungsi trigger tidak boleh dipanggil lewat RPC.
revoke all on function public.current_user_role() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.profiles_guard_changes() from public, anon, authenticated;
