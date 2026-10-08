-- Phase 13: presensi mentor (attendance).
--
-- Model sederhana (atas permintaan): satu catatan per sesi = siapa yang SEBENARNYA mengajar.
--   * status: HADIR (mengajar sesinya sendiri), TUKAR (menukar sesi dengan mentor lain),
--     MENGGANTIKAN (menggantikan mentor lain). Ketiganya masuk presensi (ekspor sheet, Phase 16).
--   * Tidak hadir = TIDAK ada catatan (tidak masuk sheet).
--   * TUKAR dan MENGGANTIKAN wajib menyebut mentor lawan (other_tutor_id).
--   * Tanpa alur persetujuan. Mentor mengisi sendiri sekali pada hari sesi (tidak bisa diubah setelah
--     dikirim); admin bisa menambah, mengubah, dan menghapus (admin_*). Koreksi admin menyimpan
--     edited_by dan edit_note. TODO Phase 17: audit log (penghapusan admin belum punya riwayat).
--   * teaching_sessions TIDAK diubah: jadwal tetap berisi mentor rencana, presensi berisi kenyataan.
--   * Satu sesi satu catatan (unik), dan satu mentor tidak bisa tercatat mengajar dua sesi pada
--     tanggal + sesi yang sama (session_date dan slot_no disalin dari sesi sebagai pengaman terakhir).
--   * Tabel hanya bisa ditulis lewat fungsi; tidak ada grant tulis langsung dan tidak ada DELETE langsung.
--   * "Hari ini" = tanggal di Asia/Jakarta.

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.teaching_sessions (id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles (id) on delete restrict,
  status text not null,
  other_tutor_id uuid references public.tutor_profiles (id) on delete restrict,
  session_date date not null,
  slot_no smallint not null,
  check_in_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  edited_by uuid references public.profiles (id) on delete set null,
  edit_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_session_key unique (session_id),
  constraint attendance_status check (status in ('HADIR', 'TUKAR', 'MENGGANTIKAN')),
  constraint attendance_other_rule check (
    (status = 'HADIR' and other_tutor_id is null)
    or (status in ('TUKAR', 'MENGGANTIKAN') and other_tutor_id is not null and other_tutor_id <> tutor_id)
  ),
  constraint attendance_note_length check (edit_note is null or char_length(edit_note) <= 500)
);

create unique index attendance_tutor_slot_key on public.attendance (tutor_id, session_date, slot_no);
create index attendance_date_idx on public.attendance (session_date);

create trigger attendance_set_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

alter table public.attendance enable row level security;

create policy attendance_select_admin on public.attendance
  for select to authenticated using ((select public.is_admin()));
create policy attendance_select_own on public.attendance
  for select to authenticated using (tutor_id = (select public.current_tutor_id()));

revoke all on table public.attendance from public, anon, authenticated;
grant select on table public.attendance to authenticated;
grant all on table public.attendance to service_role;

-- ---------------------------------------------------------------------------
-- Tanggal hari ini (Asia/Jakarta)
-- ---------------------------------------------------------------------------

create function public._today_jakarta() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;
revoke all on function public._today_jakarta() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mentor: kirim presensi (sekali, pada hari sesi)
-- ---------------------------------------------------------------------------

create function public.submit_attendance(p_session_id uuid, p_status text, p_other_tutor_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_tutor_id();
  s public.teaching_sessions;
  per_status text;
  existing public.attendance;
  new_id uuid;
begin
  if me is null then
    raise exception 'hanya mentor aktif yang boleh mengisi presensi' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('HADIR', 'TUKAR', 'MENGGANTIKAN') then
    raise exception 'status presensi tidak valid' using errcode = '22023';
  end if;

  select * into s from public.teaching_sessions where id = p_session_id;
  if not found or s.status <> 'SCHEDULED' then
    raise exception 'ATT_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select status into per_status from public.schedule_periods where id = s.period_id;
  if per_status not in ('APPROVED', 'LOCKED') then
    raise exception 'ATT_PERIOD_NOT_FINAL' using errcode = '55000';
  end if;
  if s.session_date <> public._today_jakarta() then
    raise exception 'ATT_NOT_TODAY' using errcode = '55000';
  end if;

  if p_status = 'HADIR' then
    if p_other_tutor_id is not null then
      raise exception 'ATT_OTHER_NOT_ALLOWED' using errcode = '22023';
    end if;
    if s.tutor_id <> me then
      raise exception 'ATT_NOT_YOUR_SESSION' using errcode = 'P0001';
    end if;
  else
    if p_other_tutor_id is null then
      raise exception 'ATT_OTHER_REQUIRED' using errcode = '22023';
    end if;
    if p_other_tutor_id = me
       or not exists (select 1 from public.tutor_profiles tp where tp.id = p_other_tutor_id) then
      raise exception 'ATT_OTHER_INVALID' using errcode = '22023';
    end if;
  end if;

  select * into existing from public.attendance where session_id = p_session_id;
  if found then
    raise exception 'ATT_ALREADY:%', existing.status using errcode = '23505';
  end if;

  insert into public.attendance (session_id, tutor_id, status, other_tutor_id, session_date, slot_no, recorded_by)
  values (p_session_id, me, p_status, p_other_tutor_id, s.session_date, s.slot_no, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: tambah / ubah / hapus
-- ---------------------------------------------------------------------------

create function public.admin_set_attendance(
  p_session_id uuid, p_tutor_id uuid, p_status text, p_other_tutor_id uuid default null, p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.teaching_sessions;
  per_status text;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  new_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah presensi' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('HADIR', 'TUKAR', 'MENGGANTIKAN') then
    raise exception 'status presensi tidak valid' using errcode = '22023';
  end if;
  if note is not null and char_length(note) > 500 then
    raise exception 'catatan terlalu panjang' using errcode = '22023';
  end if;
  if p_status = 'HADIR' and p_other_tutor_id is not null then
    raise exception 'ATT_OTHER_NOT_ALLOWED' using errcode = '22023';
  end if;
  if p_status <> 'HADIR' and p_other_tutor_id is null then
    raise exception 'ATT_OTHER_REQUIRED' using errcode = '22023';
  end if;
  if p_status <> 'HADIR' and p_other_tutor_id = p_tutor_id then
    raise exception 'ATT_OTHER_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = p_tutor_id) then
    raise exception 'mentor tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_other_tutor_id is not null
     and not exists (select 1 from public.tutor_profiles tp where tp.id = p_other_tutor_id) then
    raise exception 'ATT_OTHER_INVALID' using errcode = '22023';
  end if;

  select * into s from public.teaching_sessions where id = p_session_id;
  if not found or s.status <> 'SCHEDULED' then
    raise exception 'ATT_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select status into per_status from public.schedule_periods where id = s.period_id;
  if per_status = 'CANCELLED' then
    raise exception 'ATT_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.attendance
    (session_id, tutor_id, status, other_tutor_id, session_date, slot_no, recorded_by, edited_by, edit_note)
  values
    (p_session_id, p_tutor_id, p_status, p_other_tutor_id, s.session_date, s.slot_no, auth.uid(), auth.uid(), note)
  on conflict (session_id) do update
    set tutor_id = excluded.tutor_id, status = excluded.status, other_tutor_id = excluded.other_tutor_id,
        edited_by = auth.uid(), edit_note = excluded.edit_note
  returning id into new_id;
  return new_id;
end;
$$;

create function public.admin_delete_attendance(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'hanya admin yang boleh mengubah presensi' using errcode = '42501';
  end if;
  delete from public.attendance where id = p_id;
  if not found then
    raise exception 'catatan presensi tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bacaan untuk mentor (nama sudah teresolusi; mentor tidak punya akses baca ke tabel jadwal/rombel)
-- ---------------------------------------------------------------------------

-- Semua sesi hari ini (periode Approved/Locked) beserta status presensinya. Mentor perlu melihat
-- semuanya karena TUKAR/MENGGANTIKAN bisa terjadi pada sesi mentor lain.
create function public.attendance_today()
returns table (
  session_id uuid, session_date date, slot_no smallint, rombel_name text, subtest_code text, room_name text,
  planned_tutor_id uuid, planned_tutor_name text,
  attendance_id uuid, attendance_tutor_id uuid, attendance_tutor_name text, attendance_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_tutor_id() is null then
    raise exception 'hanya mentor aktif yang boleh melihat presensi' using errcode = '42501';
  end if;
  return query
  select ts.id, ts.session_date, ts.slot_no, rb.name, st.code, rm.name,
         ts.tutor_id, coalesce(pp.full_name, ''),
         a.id, a.tutor_id, coalesce(ap.full_name, ''), a.status
    from public.teaching_sessions ts
    join public.schedule_periods sp on sp.id = ts.period_id
    join public.rombels rb on rb.id = ts.rombel_id
    join public.subtests st on st.id = ts.subtest_id
    join public.rooms rm on rm.id = ts.room_id
    join public.tutor_profiles ptp on ptp.id = ts.tutor_id
    join public.profiles pp on pp.id = ptp.profile_id
    left join public.attendance a on a.session_id = ts.id
    left join public.tutor_profiles atp on atp.id = a.tutor_id
    left join public.profiles ap on ap.id = atp.profile_id
   where ts.session_date = public._today_jakarta()
     and ts.status = 'SCHEDULED'
     and sp.status in ('APPROVED', 'LOCKED')
   order by ts.slot_no, rb.name;
end;
$$;

-- Riwayat presensi mentor sendiri.
create function public.my_attendance(p_from date, p_to date)
returns table (
  session_date date, slot_no smallint, rombel_name text, subtest_code text,
  status text, other_tutor_name text, planned_tutor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_tutor_id();
begin
  if me is null then
    raise exception 'hanya mentor aktif yang boleh melihat presensi' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'rentang tanggal tidak valid' using errcode = '22023';
  end if;
  return query
  select a.session_date, a.slot_no, rb.name, st.code, a.status,
         coalesce(op.full_name, ''), coalesce(pp.full_name, '')
    from public.attendance a
    join public.teaching_sessions ts on ts.id = a.session_id
    join public.rombels rb on rb.id = ts.rombel_id
    join public.subtests st on st.id = ts.subtest_id
    join public.tutor_profiles ptp on ptp.id = ts.tutor_id
    join public.profiles pp on pp.id = ptp.profile_id
    left join public.tutor_profiles otp on otp.id = a.other_tutor_id
    left join public.profiles op on op.id = otp.profile_id
   where a.tutor_id = me and a.session_date between p_from and p_to
   order by a.session_date, a.slot_no;
end;
$$;

-- Daftar nama mentor untuk dipilih sebagai lawan TUKAR/MENGGANTIKAN.
create function public.tutor_names()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin() or public.current_tutor_id() is not null, false) then
    raise exception 'tidak berhak' using errcode = '42501';
  end if;
  return query
  select tp.id, coalesce(nullif(p.full_name, ''), '(tanpa nama)')
    from public.tutor_profiles tp
    join public.profiles p on p.id = tp.profile_id
   where p.is_active and p.role = 'tutor'
   order by 2, 1;
end;
$$;

revoke all on function
  public.submit_attendance(uuid, text, uuid),
  public.admin_set_attendance(uuid, uuid, text, uuid, text),
  public.admin_delete_attendance(uuid),
  public.attendance_today(),
  public.my_attendance(date, date),
  public.tutor_names()
  from public, anon, authenticated;

grant execute on function
  public.submit_attendance(uuid, text, uuid),
  public.admin_set_attendance(uuid, uuid, text, uuid, text),
  public.admin_delete_attendance(uuid),
  public.attendance_today(),
  public.my_attendance(date, date),
  public.tutor_names()
  to authenticated, service_role;
