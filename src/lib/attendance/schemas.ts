import { z } from "zod";
import { parseIsoDate } from "../validation/dates";
import { ATTENDANCE_STATUSES } from "./labels";

const uuid = (msg: string) => z.string({ required_error: msg }).uuid(msg);
const status = z.enum(ATTENDANCE_STATUSES as unknown as [string, ...string[]], { errorMap: () => ({ message: "Pilih status presensi." }) });
const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Mentor lawan tidak valid.");

function otherRule(v: { status: string; otherTutorId: string | null; tutorId?: string }, ctx: z.RefinementCtx) {
  if (v.status === "HADIR" && v.otherTutorId !== null) {
    ctx.addIssue({ code: "custom", path: ["otherTutorId"], message: "HADIR tidak memakai mentor lawan." });
  }
  if (v.status !== "HADIR" && v.otherTutorId === null) {
    ctx.addIssue({ code: "custom", path: ["otherTutorId"], message: "Pilih mentor lawan untuk TUKAR atau MENGGANTIKAN." });
  }
  if (v.tutorId && v.otherTutorId === v.tutorId) {
    ctx.addIssue({ code: "custom", path: ["otherTutorId"], message: "Mentor lawan tidak boleh sama dengan mentor yang mengajar." });
  }
}

export const submitAttendanceSchema = z
  .object({ sessionId: uuid("Sesi tidak valid."), status, otherTutorId: optionalUuid })
  .superRefine(otherRule);

export const adminAttendanceSchema = z
  .object({
    sessionId: uuid("Sesi tidak valid."),
    tutorId: uuid("Pilih mentor yang mengajar."),
    status,
    otherTutorId: optionalUuid,
    note: z.string().trim().max(500, "Catatan maksimal 500 karakter."),
  })
  .superRefine(otherRule);

export const attendanceDeleteSchema = z.object({ id: uuid("ID tidak valid.") });

export const dateParamSchema = z
  .string()
  .trim()
  .refine((v) => parseIsoDate(v) !== null, "Tanggal tidak valid.");
