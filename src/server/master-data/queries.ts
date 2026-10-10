import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  dayRowSchema,
  roomRowSchema,
  slotRowSchema,
  subtestRowSchema,
  type CalendarDay,
  type Room,
  type SessionSlot,
  type Subtest,
} from "@/lib/master-data/schemas";

// Hanya untuk kode server. Query berjalan dengan sesi user (anon key + cookie), jadi RLS berlaku:
// hasil kosong berarti user tidak berhak, bukan error. Halaman tetap memanggil requireRole() sendiri.

function loadFailed(what: string): Error {
  return new Error(`Gagal memuat ${what}.`);
}

export async function listSubtests(): Promise<Subtest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subtests")
    .select("id, code, name, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (error) throw loadFailed("subtes");
  return z.array(subtestRowSchema).parse(data ?? []);
}

export async function listRooms(): Promise<Room[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, capacity, is_active")
    .order("name", { ascending: true });
  if (error) throw loadFailed("ruangan");
  return z.array(roomRowSchema).parse(data ?? []);
}

export async function listSessionSlots(): Promise<SessionSlot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("session_slots")
    .select("id, slot_no, start_time, duration_minutes, is_active")
    .order("slot_no", { ascending: true });
  if (error) throw loadFailed("slot sesi");
  return z.array(slotRowSchema).parse(data ?? []);
}

export async function listCalendarDays(): Promise<CalendarDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_days")
    .select("day_of_week, is_active, is_tryout")
    .order("day_of_week", { ascending: true });
  if (error) throw loadFailed("hari aktif");
  return z.array(dayRowSchema).parse(data ?? []);
}
