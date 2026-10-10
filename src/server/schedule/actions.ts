"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapDbError, type DbErrorLike, type MasterEntity } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import { firstIssueMessage } from "@/lib/master-data/schemas";
import {
  generateAdditionalSchema,
  generateSchema,
  statusChangeSchema,
  periodCreateSchema,
  periodUpdateSchema,
  sessionCancelSchema,
  sessionCreateSchema,
  sessionUpdateSchema,
} from "@/lib/schedule/schemas";
import { planSchedule } from "@/lib/schedule/plan";
import { planAdditional } from "@/lib/schedule/additional";
import { canGenerateAdditional } from "@/lib/validation/transitions";
import { getPeriod, listPeriodSessions, loadSchedulingSnapshot } from "./queries";

// Setiap mutasi: requireRole -> Zod -> RPC (admin dan aturan jadwal dicek lagi di database) -> mapDbError.
// Tabel jadwal hanya bisa ditulis lewat RPC. TODO Phase 17: audit log perubahan jadwal.

function dbFailure(error: DbErrorLike, entity: MasterEntity): FormState {
  console.error(`[schedule:${entity}]`, error.code, error.message);
  return fail(mapDbError(error, entity));
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function refresh(periodId?: string) {
  revalidatePath("/admin/jadwal");
  if (periodId) revalidatePath(`/admin/jadwal/${periodId}`);
}

export async function createPeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = periodCreateSchema.safeParse({
    name: text(formData, "name"),
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_schedule_period", {
    p_name: parsed.data.name,
    p_start: parsed.data.startDate,
    p_end: parsed.data.endDate,
  });
  if (error) return dbFailure(error, "periode jadwal");
  refresh();
  return ok("Periode jadwal dibuat.");
}

export async function updatePeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = periodUpdateSchema.safeParse({
    id: text(formData, "id"),
    name: text(formData, "name"),
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_schedule_period", {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
    p_start: parsed.data.startDate,
    p_end: parsed.data.endDate,
  });
  if (error) return dbFailure(error, "periode jadwal");
  refresh(parsed.data.id);
  return ok("Periode jadwal disimpan.");
}

/**
 * Generate Jadwal (full) untuk satu periode dari data nyata saat ini (DEC-06: langsung/sinkron).
 * Menggantikan SELURUH sesi periode itu, termasuk hasil edit manual, sehingga bila sudah ada sesi
 * admin harus mencentang konfirmasi. Bila tidak ada kebutuhan sesi sama sekali, jadwal lama TIDAK
 * dihapus (kemungkinan distribusi belum diatur).
 */
export async function generateScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = generateSchema.safeParse({
    periodId: text(formData, "periodId"),
    seed: text(formData, "seed"),
    confirmReplace: formData.get("confirmReplace") ?? false,
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { periodId, confirmReplace } = parsed.data;

  const period = await getPeriod(periodId);
  if (!period) return fail("Periode jadwal tidak ditemukan.");
  if (period.status !== "DRAFT" && period.status !== "GENERATED") {
    return fail(`Jadwal berstatus ${period.status} tidak dapat digenerate ulang.`);
  }

  const existing = await listPeriodSessions(periodId);
  if (existing.length > 0 && !confirmReplace) {
    return fail(
      `Periode ini sudah berisi ${existing.length} sesi. Generate akan menggantikan semuanya (termasuk edit manual). Centang konfirmasi untuk melanjutkan.`,
    );
  }

  const seed = parsed.data.seed ?? Math.floor(Math.random() * 4294967296);

  let built;
  try {
    built = await loadSchedulingSnapshot();
  } catch (e) {
    console.error("[schedule:snapshot]", e);
    return fail("Gagal memuat data untuk penjadwalan. Coba lagi.");
  }

  const plan = planSchedule({
    snapshot: built.snapshot,
    seed,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    windows: built.rombelWindows,
  });

  if (plan.summary.weeklyRequired === 0) {
    const reasons = [...plan.summary.issues, ...built.issues].slice(0, 3).map((i) => i.message).join(" ");
    return fail(
      `Tidak ada kebutuhan sesi untuk dijadwalkan, jadi jadwal lama tidak diubah. ${reasons || "Atur distribusi subtes rombel terlebih dahulu."}`.trim(),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_generated_schedule", {
    p_period_id: periodId,
    p_seed: seed,
    p_summary: { ...plan.summary, configIssues: built.issues },
    p_sessions: plan.sessions.map((s) => ({
      session_date: s.sessionDate,
      slot_no: s.slotNo,
      rombel_id: s.rombelId,
      subtest_id: s.subtestId,
      tutor_id: s.tutorId,
      room_id: s.roomId,
      display_label: s.displayLabel ?? null,
    })),
    p_unscheduled: plan.unscheduled,
  });
  if (error) return dbFailure(error, "jadwal");

  refresh(periodId);
  const s = plan.summary;
  return ok(
    `Jadwal dibuat: ${s.datedSessions} pertemuan (${s.weeklyScheduled} per minggu dari ${s.weeklyRequired} kebutuhan). ` +
      (s.weeklyUnscheduled > 0 ? `${s.weeklyUnscheduled} sesi per minggu belum terjadwal. ` : "Semua kebutuhan terpenuhi. ") +
      `Seed ${seed}.`,
  );
}

function sessionFields(formData: FormData) {
  return {
    sessionDate: text(formData, "sessionDate"),
    slotNo: text(formData, "slotNo"),
    subtestId: text(formData, "subtestId"),
    tutorId: text(formData, "tutorId"),
    roomId: text(formData, "roomId"),
  };
}

export async function createSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = sessionCreateSchema.safeParse({
    periodId: text(formData, "periodId"),
    rombelId: text(formData, "rombelId"),
    ...sessionFields(formData),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_teaching_session", {
    p_period_id: d.periodId,
    p_session_date: d.sessionDate,
    p_slot_no: d.slotNo,
    p_rombel_id: d.rombelId,
    p_subtest_id: d.subtestId,
    p_tutor_id: d.tutorId,
    p_room_id: d.roomId,
  });
  if (error) return dbFailure(error, "jadwal");
  refresh(d.periodId);
  return ok("Sesi ditambahkan.");
}

export async function updateSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = sessionUpdateSchema.safeParse({ id: text(formData, "id"), ...sessionFields(formData) });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_teaching_session", {
    p_id: d.id,
    p_session_date: d.sessionDate,
    p_slot_no: d.slotNo,
    p_subtest_id: d.subtestId,
    p_tutor_id: d.tutorId,
    p_room_id: d.roomId,
  });
  if (error) return dbFailure(error, "jadwal");
  revalidatePath("/admin/jadwal/[id]", "page");
  return ok("Sesi disimpan.");
}

export async function cancelSessionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = sessionCancelSchema.safeParse({ id: text(formData, "id") });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_teaching_session", { p_id: parsed.data.id });
  if (error) return dbFailure(error, "jadwal");
  revalidatePath("/admin/jadwal/[id]", "page");
  return ok("Sesi dibatalkan.");
}

/**
 * Ubah status periode (Approve, tarik persetujuan, Lock, Cancel). Aturan sebenarnya ditegakkan database
 * (set_period_status); Lock dan Cancel tidak bisa dibatalkan sehingga butuh konfirmasi. TODO Phase 17: audit log.
 */
export async function setPeriodStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = statusChangeSchema.safeParse({
    periodId: text(formData, "periodId"),
    to: text(formData, "to"),
    confirm: formData.get("confirm") ?? false,
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_period_status", { p_id: parsed.data.periodId, p_to: parsed.data.to });
  if (error) return dbFailure(error, "periode jadwal");
  refresh(parsed.data.periodId);
  return ok("Status periode diperbarui.");
}

/**
 * Generate Additional: melengkapi kebutuhan yang belum terpenuhi TANPA mengubah sesi yang sudah ada.
 * Hanya untuk periode Generated atau Approved. Bila tidak ada kebutuhan tersisa, tidak ada yang disimpan.
 */
export async function generateAdditionalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = generateAdditionalSchema.safeParse({ periodId: text(formData, "periodId"), seed: text(formData, "seed") });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { periodId } = parsed.data;

  const period = await getPeriod(periodId);
  if (!period) return fail("Periode jadwal tidak ditemukan.");
  if (!canGenerateAdditional(period.status)) {
    return fail(`Generate Additional hanya untuk periode Generated atau Approved (status sekarang: ${period.status}).`);
  }

  const existing = await listPeriodSessions(periodId);
  const seed = parsed.data.seed ?? Math.floor(Math.random() * 4294967296);

  let built;
  try {
    built = await loadSchedulingSnapshot();
  } catch (e) {
    console.error("[schedule:snapshot]", e);
    return fail("Gagal memuat data untuk penjadwalan. Coba lagi.");
  }

  const plan = planAdditional({
    snapshot: built.snapshot,
    existing: existing.map((x) => ({
      sessionDate: x.sessionDate,
      slotNo: x.slotNo,
      rombelId: x.rombelId,
      subtestId: x.subtestId,
      tutorId: x.tutorId,
      roomId: x.roomId,
    })),
    seed,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    windows: built.rombelWindows,
  });

  if (plan.summary.weeklyRequired === 0) {
    return fail("Tidak ada kebutuhan sesi (distribusi subtes belum diatur), jadi tidak ada yang bisa ditambahkan.");
  }
  if (plan.sessions.length === 0 && plan.unscheduled.length === 0) {
    return fail("Tidak ada kebutuhan yang kurang: semua kebutuhan per minggu sudah terpenuhi oleh sesi yang ada.");
  }
  if (plan.sessions.length === 0) {
    return fail(
      `Tidak ada sesi tambahan yang bisa dijadwalkan (${plan.summary.weeklyUnscheduled} sesi per minggu masih belum terpenuhi). Periksa alasan di daftar kebutuhan belum terjadwal, atau perbaiki data (mentor, availability, ruangan).`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_additional_schedule", {
    p_period_id: periodId,
    p_seed: seed,
    p_summary: { ...plan.summary, configIssues: built.issues },
    p_sessions: plan.sessions.map((x) => ({
      session_date: x.sessionDate,
      slot_no: x.slotNo,
      rombel_id: x.rombelId,
      subtest_id: x.subtestId,
      tutor_id: x.tutorId,
      room_id: x.roomId,
      display_label: x.displayLabel ?? null,
    })),
    p_unscheduled: plan.unscheduled,
  });
  if (error) return dbFailure(error, "jadwal");

  refresh(periodId);
  const s = plan.summary;
  return ok(
    `Sesi tambahan dibuat: ${s.datedSessions} pertemuan (${s.weeklyScheduled} per minggu). ` +
      (s.weeklyUnscheduled > 0 ? `${s.weeklyUnscheduled} sesi per minggu masih belum terpenuhi. ` : "Semua kebutuhan kini terpenuhi. ") +
      `Sesi yang sudah ada tidak diubah. Seed ${seed}.`,
  );
}
