import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/fetch-all";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/attendance/labels";

// Hanya untuk kode server. Mentor membaca lewat fungsi database (nama sudah teresolusi); admin membaca tabel.
// Halaman tetap memanggil requireRole() sendiri.

const statusSchema = z.enum(ATTENDANCE_STATUSES as unknown as [AttendanceStatus, ...AttendanceStatus[]]);

function failed(what: string, error: { code?: string; message?: string }): Error {
  console.error(`[attendance:${what}]`, error.code, error.message);
  return new Error(`Gagal memuat ${what}.`);
}

const tutorNameSchema = z.object({ id: z.string().uuid(), name: z.string() });
export async function listTutorNames(): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tutor_names");
  if (error) throw failed("daftar mentor", error);
  return z.array(tutorNameSchema).parse(data ?? []);
}

const todaySchema = z
  .object({
    session_id: z.string().uuid(),
    session_date: z.string(),
    slot_no: z.number().int(),
    rombel_name: z.string(),
    subtest_code: z.string(),
    room_name: z.string(),
    planned_tutor_id: z.string().uuid(),
    planned_tutor_name: z.string(),
    attendance_id: z.string().uuid().nullable(),
    attendance_tutor_id: z.string().uuid().nullable(),
    attendance_tutor_name: z.string().nullable(),
    attendance_status: statusSchema.nullable(),
  })
  .transform((r) => ({
    sessionId: r.session_id,
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    rombelName: r.rombel_name,
    subtestCode: r.subtest_code,
    roomName: r.room_name,
    plannedTutorId: r.planned_tutor_id,
    plannedTutorName: r.planned_tutor_name,
    attendanceId: r.attendance_id,
    attendanceTutorId: r.attendance_tutor_id,
    attendanceTutorName: r.attendance_tutor_name ?? "",
    attendanceStatus: r.attendance_status,
  }));
export type TodaySession = z.output<typeof todaySchema>;

export async function listTodaySessions(): Promise<TodaySession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_today");
  if (error) throw failed("sesi hari ini", error);
  return z.array(todaySchema).parse(data ?? []);
}

const mineSchema = z
  .object({
    session_date: z.string(),
    slot_no: z.number().int(),
    rombel_name: z.string(),
    subtest_code: z.string(),
    status: statusSchema,
    other_tutor_name: z.string(),
    planned_tutor_name: z.string(),
  })
  .transform((r) => ({
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    rombelName: r.rombel_name,
    subtestCode: r.subtest_code,
    status: r.status,
    otherTutorName: r.other_tutor_name,
    plannedTutorName: r.planned_tutor_name,
  }));
export type MyAttendance = z.output<typeof mineSchema>;

export async function listMyAttendance(from: string, to: string): Promise<MyAttendance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_attendance", { p_from: from, p_to: to });
  if (error) throw failed("riwayat presensi", error);
  return z.array(mineSchema).parse(data ?? []);
}

// ------------------------------------------------------------------ admin

const adminRowSchema = z
  .object({
    id: z.string().uuid(),
    session_id: z.string().uuid(),
    tutor_id: z.string().uuid(),
    status: statusSchema,
    other_tutor_id: z.string().uuid().nullable(),
    session_date: z.string(),
    slot_no: z.number().int(),
    edit_note: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    sessionId: r.session_id,
    tutorId: r.tutor_id,
    status: r.status,
    otherTutorId: r.other_tutor_id,
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    editNote: r.edit_note ?? "",
  }));
export type AdminAttendance = z.output<typeof adminRowSchema>;

export async function listAttendanceBetween(from: string, to: string): Promise<AdminAttendance[]> {
  const supabase = await createClient();
  const rows = await fetchAll("presensi", (a, b) =>
    supabase
      .from("attendance")
      .select("id, session_id, tutor_id, status, other_tutor_id, session_date, slot_no, edit_note")
      .gte("session_date", from)
      .lte("session_date", to)
      .order("session_date", { ascending: true })
      .order("slot_no", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
  return z.array(adminRowSchema).parse(rows);
}

const sessionSchema = z
  .object({
    id: z.string().uuid(),
    session_date: z.string(),
    slot_no: z.number().int(),
    rombel_id: z.string().uuid(),
    subtest_id: z.string().uuid(),
    tutor_id: z.string().uuid(),
    room_id: z.string().uuid(),
  })
  .transform((r) => ({
    id: r.id,
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    rombelId: r.rombel_id,
    subtestId: r.subtest_id,
    tutorId: r.tutor_id,
    roomId: r.room_id,
  }));
export type SessionOnDate = z.output<typeof sessionSchema>;

/** Sesi SCHEDULED pada rentang tanggal (periode yang bukan Cancelled), untuk memilih sesi saat mencatat presensi. */
export async function listSessionsBetween(from: string, to: string): Promise<SessionOnDate[]> {
  const supabase = await createClient();
  const rows = await fetchAll("sesi", (a, b) =>
    supabase
      .from("teaching_sessions")
      .select("id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, schedule_periods!inner(status)")
      .eq("status", "SCHEDULED")
      .neq("schedule_periods.status", "CANCELLED")
      .gte("session_date", from)
      .lte("session_date", to)
      .order("session_date", { ascending: true })
      .order("slot_no", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
  return z.array(sessionSchema).parse(rows);
}
