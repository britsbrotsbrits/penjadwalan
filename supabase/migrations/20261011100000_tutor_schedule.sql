-- Phase 12: jadwal untuk mentor sendiri.
--   * my_schedule(p_from, p_to): sesi SCHEDULED milik mentor yang sedang login, hanya dari periode
--     APPROVED atau LOCKED (jadwal Draft/Generated belum final dan tidak boleh bocor ke mentor).
--   * Mentor tidak diberi akses baca ke tabel jadwal/rombel; fungsi ini SECURITY DEFINER dan hanya
--     mengembalikan kolom yang dibutuhkan tampilan (tanggal, sesi, nama rombel, subtes, ruangan).
--   * Rentang dibatasi 93 hari per panggilan.

create function public.my_schedule(p_from date, p_to date)
returns table (
  session_date date,
  slot_no smallint,
  rombel_name text,
  subtest_code text,
  subtest_name text,
  room_name text,
  period_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tid uuid := public.current_tutor_id();
begin
  if tid is null then
    raise exception 'hanya mentor aktif yang boleh melihat jadwal ini' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'rentang tanggal tidak valid' using errcode = '22023';
  end if;

  return query
  select ts.session_date, ts.slot_no, rb.name, st.code, st.name, rm.name, sp.name
    from public.teaching_sessions ts
    join public.schedule_periods sp on sp.id = ts.period_id
    join public.rombels rb on rb.id = ts.rombel_id
    join public.subtests st on st.id = ts.subtest_id
    join public.rooms rm on rm.id = ts.room_id
   where ts.tutor_id = tid
     and ts.status = 'SCHEDULED'
     and sp.status in ('APPROVED', 'LOCKED')
     and ts.session_date between p_from and p_to
   order by ts.session_date, ts.slot_no;
end;
$$;

revoke all on function public.my_schedule(date, date) from public, anon, authenticated;
grant execute on function public.my_schedule(date, date) to authenticated, service_role;
