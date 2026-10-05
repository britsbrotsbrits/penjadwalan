"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapDbError, type DbErrorLike, type MasterEntity } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import {
  activeDaysSchema,
  firstIssueMessage,
  roomCreateSchema,
  roomUpdateSchema,
  slotCreateSchema,
  slotUpdateSchema,
  subtestCreateSchema,
  subtestUpdateSchema,
} from "@/lib/master-data/schemas";

// Setiap mutasi: autentikasi + otorisasi (requireRole) -> validasi Zod -> mutasi (RLS tetap berlaku)
// -> revalidate. Pesan error ke user selalu lewat mapDbError (tidak pernah pesan mentah database).
// TODO Phase 17: catat audit log untuk perubahan konfigurasi.

function formToRecord(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function dbFailure(error: DbErrorLike, entity: MasterEntity): FormState {
  console.error(`[master-data:${entity}]`, error.code, error.message);
  return fail(mapDbError(error, entity));
}

type Table = "subtests" | "rooms" | "session_slots";

async function insertRow(
  table: Table,
  values: Record<string, unknown>,
  entity: MasterEntity,
  path: string,
  successMessage: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(values);
  if (error) return dbFailure(error, entity);
  revalidatePath(path);
  return ok(successMessage);
}

async function updateRow(
  table: Table,
  id: string,
  values: Record<string, unknown>,
  entity: MasterEntity,
  path: string,
  successMessage: string,
): Promise<FormState> {
  const supabase = await createClient();
  // .select("id") agar update yang mengenai 0 baris (id salah / tidak berhak) terdeteksi, bukan sukses palsu.
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id");
  if (error) return dbFailure(error, entity);
  if (!data || data.length === 0) {
    return fail("Data tidak ditemukan atau Anda tidak berhak mengubahnya.");
  }
  revalidatePath(path);
  return ok(successMessage);
}

// ---------------------------------------------------------------- subtes

export async function createSubtestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = subtestCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "subtests",
    { code: v.code, name: v.name, sort_order: v.sortOrder, is_active: v.isActive },
    "subtes",
    "/admin/subtes",
    "Subtes ditambahkan.",
  );
}

export async function updateSubtestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = subtestUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "subtests",
    id,
    { code: v.code, name: v.name, sort_order: v.sortOrder, is_active: v.isActive },
    "subtes",
    "/admin/subtes",
    "Tersimpan.",
  );
}

// ---------------------------------------------------------------- ruangan

export async function createRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = roomCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "rooms",
    { name: v.name, capacity: v.capacity, is_active: v.isActive },
    "ruangan",
    "/admin/ruangan",
    "Ruangan ditambahkan.",
  );
}

export async function updateRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = roomUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  const result = await updateRow(
    "rooms",
    id,
    { name: v.name, capacity: v.capacity, is_active: v.isActive },
    "ruangan",
    "/admin/ruangan",
    "Tersimpan.",
  );
  // Kapasitas/status ruangan memengaruhi peringatan ruangan tetap di halaman rombel.
  if (result.status === "success") revalidatePath("/admin/rombel");
  return result;
}

// ---------------------------------------------------------------- slot sesi

export async function createSlotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = slotCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "session_slots",
    {
      slot_no: v.slotNo,
      start_time: v.startTime,
      duration_minutes: v.durationMinutes,
      is_active: v.isActive,
    },
    "slot",
    "/admin/kalender",
    "Slot sesi ditambahkan.",
  );
}

export async function updateSlotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = slotUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "session_slots",
    id,
    {
      slot_no: v.slotNo,
      start_time: v.startTime,
      duration_minutes: v.durationMinutes,
      is_active: v.isActive,
    },
    "slot",
    "/admin/kalender",
    "Tersimpan.",
  );
}

// ---------------------------------------------------------------- hari aktif

export async function saveActiveDaysAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = activeDaysSchema.safeParse({ days: formData.getAll("days") });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const supabase = await createClient();
  // Satu panggilan RPC = satu transaksi: ketujuh hari berubah bersama atau tidak sama sekali.
  const { error } = await supabase.rpc("set_active_days", { p_days: parsed.data.days });
  if (error) return dbFailure(error, "hari");

  revalidatePath("/admin/kalender");
  return ok("Hari aktif tersimpan.");
}
