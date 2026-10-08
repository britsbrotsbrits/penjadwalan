"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapDbError, type DbErrorLike } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import { firstIssueMessage } from "@/lib/master-data/schemas";
import { adminAttendanceSchema, attendanceDeleteSchema, submitAttendanceSchema } from "@/lib/attendance/schemas";

// Setiap mutasi: requireRole -> Zod -> RPC (hak akses dan aturan dicek lagi di database) -> mapDbError.
// TODO Phase 17: audit log perubahan/penghapusan presensi oleh admin.

function dbFailure(error: DbErrorLike): FormState {
  console.error("[attendance]", error.code, error.message);
  return fail(mapDbError(error, "presensi"));
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function submitAttendanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["tutor"]);
  const parsed = submitAttendanceSchema.safeParse({
    sessionId: text(formData, "sessionId"),
    status: text(formData, "status"),
    otherTutorId: text(formData, "otherTutorId"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_attendance", {
    p_session_id: parsed.data.sessionId,
    p_status: parsed.data.status,
    p_other_tutor_id: parsed.data.otherTutorId,
  });
  if (error) return dbFailure(error);
  revalidatePath("/tutor/absensi");
  return ok("Presensi tersimpan.");
}

export async function adminSetAttendanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = adminAttendanceSchema.safeParse({
    sessionId: text(formData, "sessionId"),
    tutorId: text(formData, "tutorId"),
    status: text(formData, "status"),
    otherTutorId: text(formData, "otherTutorId"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_attendance", {
    p_session_id: parsed.data.sessionId,
    p_tutor_id: parsed.data.tutorId,
    p_status: parsed.data.status,
    p_other_tutor_id: parsed.data.otherTutorId,
    p_note: parsed.data.note === "" ? null : parsed.data.note,
  });
  if (error) return dbFailure(error);
  revalidatePath("/admin/absensi");
  return ok("Presensi disimpan.");
}

export async function adminDeleteAttendanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = attendanceDeleteSchema.safeParse({ id: text(formData, "id") });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_attendance", { p_id: parsed.data.id });
  if (error) return dbFailure(error);
  revalidatePath("/admin/absensi");
  return ok("Catatan presensi dihapus.");
}
