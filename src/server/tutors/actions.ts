"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapDbError, type DbErrorLike, type MasterEntity } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import { firstIssueMessage } from "@/lib/master-data/schemas";
import { buildAvailabilityPayload } from "@/lib/tutors/availability";
import { competenciesSchema, tutorUpdateSchema } from "@/lib/tutors/schemas";
import { idSchema } from "@/lib/master-data/schemas";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";
import { getMyTutorProfile } from "./queries";

// Setiap mutasi: autentikasi + otorisasi (requireRole) -> validasi Zod -> fungsi database
// (cek hak akses diulang di database) -> revalidate. Pesan error ke user selalu lewat mapDbError.
// TODO Phase 17: catat audit log untuk perubahan data tutor, kompetensi, dan availability.

function dbFailure(error: DbErrorLike, entity: MasterEntity): FormState {
  console.error(`[tutors:${entity}]`, error.code, error.message);
  return fail(mapDbError(error, entity));
}

/**
 * Grid availability diambil dari DATABASE (hari aktif x slot aktif), bukan dari form, supaya
 * klien tidak bisa menyisipkan sel di luar grid yang berlaku.
 */
async function loadActiveGrid(): Promise<{ days: number[]; slotNos: number[] }> {
  const [days, slots] = await Promise.all([listCalendarDays(), listSessionSlots()]);
  return {
    days: days.filter((d) => d.isActive).map((d) => d.dayOfWeek).sort((a, b) => a - b),
    slotNos: slots.filter((s) => s.isActive).map((s) => s.slotNo).sort((a, b) => a - b),
  };
}

async function saveAvailability(tutorId: string, formData: FormData): Promise<FormState> {
  const grid = await loadActiveGrid();
  if (grid.days.length === 0 || grid.slotNos.length === 0) {
    return fail("Belum ada hari aktif atau slot sesi aktif. Atur di menu Kalender dulu.");
  }
  const checked = formData.getAll("cell").filter((v): v is string => typeof v === "string");
  const payload = buildAvailabilityPayload(checked, grid.days, grid.slotNos);
  if (payload === null) {
    return fail("Pilihan availability tidak sesuai dengan jadwal yang berlaku. Muat ulang halaman.");
  }

  const supabase = await createClient();
  // Satu panggilan RPC = satu transaksi: seluruh availability diganti atau tidak sama sekali.
  const { error } = await supabase.rpc("set_tutor_availability", {
    p_tutor_id: tutorId,
    p_cells: payload,
  });
  if (error) return dbFailure(error, "availability");
  return ok("Availability tersimpan.");
}

// ---------------------------------------------------------------- admin

export async function updateTutorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = tutorUpdateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_tutor", {
    p_tutor_id: v.tutorId,
    p_full_name: v.fullName,
    p_account_active: v.accountActive,
    p_level: v.level,
    p_rate: v.rate,
    p_schedulable: v.schedulable,
  });
  if (error) return dbFailure(error, "tutor");

  revalidatePath("/admin/mentor");
  revalidatePath("/admin/kompetensi");
  revalidatePath("/admin/availability");
  return ok("Tersimpan.");
}

export async function saveCompetenciesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = competenciesSchema.safeParse({
    tutorId: formData.get("tutorId"),
    subtestIds: formData.getAll("subtestIds"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_tutor_competencies", {
    p_tutor_id: parsed.data.tutorId,
    p_subtest_ids: parsed.data.subtestIds,
  });
  if (error) return dbFailure(error, "kompetensi");

  revalidatePath("/admin/kompetensi");
  return ok("Kompetensi tersimpan.");
}

export async function saveTutorAvailabilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["admin"]);
  const id = idSchema.safeParse(formData.get("tutorId"));
  if (!id.success) return fail(firstIssueMessage(id.error));

  const result = await saveAvailability(id.data, formData);
  if (result.status === "success") {
    revalidatePath("/admin/availability");
    revalidatePath(`/admin/availability/${id.data}`);
  }
  return result;
}

// ---------------------------------------------------------------- tutor

export async function saveMyAvailabilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["tutor"]);
  // Id tutor SELALU diturunkan dari sesi (RLS hanya mengembalikan baris milik sendiri);
  // nilai apa pun dari form diabaikan.
  const mine = await getMyTutorProfile();
  if (!mine) return fail("Akun Anda belum terdaftar sebagai tutor. Hubungi admin.");

  const result = await saveAvailability(mine.id, formData);
  if (result.status === "success") {
    revalidatePath("/tutor");
    revalidatePath("/tutor/availability");
    revalidatePath("/admin/availability");
    revalidatePath(`/admin/availability/${mine.id}`);
  }
  return result;
}
