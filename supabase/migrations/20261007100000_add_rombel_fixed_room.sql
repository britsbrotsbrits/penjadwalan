-- Phase 6: ruangan tetap (fixed room) per rombel.
--
-- Prasyarat: migrasi Phase 3 (rooms) dan Phase 4 (rombels).
--
-- Keputusan desain:
--   * rombels.fixed_room_id nullable. NULL = tidak ada ruangan tetap (scheduler memilih ruangan).
--   * Beberapa rombel BOLEH memakai ruangan tetap yang sama (DEC-03). Bentrok waktu tetap hard
--     constraint di penjadwalan; UI memberi peringatan bila ruangan dibagi.
--   * Ruangan tetap harus ada dan AKTIF saat dipilih. Perubahan nilai dicek; menyimpan rombel tanpa
--     mengganti ruangannya tidak dicek ulang, sehingga rombel yang ruangannya kelak dinonaktifkan
--     tetap bisa diedit (ruangan nonaktif ditandai peringatan di UI, bukan diblokir).
--   * Kapasitas ruangan vs jumlah siswa TIDAK dipaksa di database (jumlah siswa berubah-ubah, DEC-02).
--     Itu dicek oleh validator/scheduler (hard constraint) dan diperingatkan di UI.
--   * rooms ON DELETE RESTRICT, dan tidak ada DELETE untuk siapa pun: ruangan hanya dinonaktifkan.

alter table public.rombels
  add column fixed_room_id uuid references public.rooms (id) on delete restrict;

create index rombels_fixed_room_idx on public.rombels (fixed_room_id) where fixed_room_id is not null;

create function public.rombels_check_fixed_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fixed_room_id is not null
     and (tg_op = 'INSERT' or new.fixed_room_id is distinct from old.fixed_room_id) then
    if not exists (
      select 1 from public.rooms r where r.id = new.fixed_room_id and r.is_active
    ) then
      raise exception 'rombels_fixed_room_active: ruangan tetap tidak ada atau tidak aktif'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger rombels_check_fixed_room
  before insert or update of fixed_room_id on public.rombels
  for each row execute function public.rombels_check_fixed_room();

revoke all on function public.rombels_check_fixed_room() from public, anon, authenticated;

-- Hak kolom bersifat tambahan: kolom baru ini boleh diisi/diubah admin (RLS tetap membatasi ke admin).
grant insert (fixed_room_id) on table public.rombels to authenticated;
grant update (fixed_room_id) on table public.rombels to authenticated;
