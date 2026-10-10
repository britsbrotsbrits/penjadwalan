"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapDbError, type DbErrorLike, type MasterEntity } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import { firstIssueMessage } from "@/lib/master-data/schemas";
import {
  classTypeCreateSchema,
  classTypeUpdateSchema,
  programCreateSchema,
  programUpdateSchema,
  rombelCreateSchema,
  rombelDefaultsSchema,
  rombelUpdateSchema,
  studentCreateSchema,
  studentMoveSchema,
  studentUpdateSchema,
} from "@/lib/academic/schemas";

// Setiap mutasi: autentikasi + otorisasi (requireRole) -> validasi Zod -> mutasi (RLS tetap berlaku)
// -> revalidate. Pesan error ke user selalu lewat mapDbError (tidak pernah pesan mentah database).
// Kolom yang tidak boleh berubah (program_id, class_type_id, rombel_id siswa) tidak pernah dikirim
// dari sini; database juga menolaknya lewat hak kolom. Pindah rombel hanya lewat RPC move_student().
// TODO Phase 17: catat audit log untuk perubahan struktur akademik.

function formToRecord(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function dbFailure(error: DbErrorLike, entity: MasterEntity): FormState {
  console.error(`[academic:${entity}]`, error.code, error.message);
  return fail(mapDbError(error, entity));
}

type Table = "programs" | "class_types" | "rombels" | "students";

async function insertRow(
  table: Table,
  values: Record<string, unknown>,
  entity: MasterEntity,
  paths: string[],
  successMessage: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(values);
  if (error) return dbFailure(error, entity);
  for (const path of paths) revalidatePath(path);
  return ok(successMessage);
}

async function updateRow(
  table: Table,
  id: string,
  values: Record<string, unknown>,
  entity: MasterEntity,
  paths: string[],
  successMessage: string,
): Promise<FormState> {
  const supabase = await createClient();
  // .select("id") agar update yang mengenai 0 baris (id salah / tidak berhak) terdeteksi, bukan sukses palsu.
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id");
  if (error) return dbFailure(error, entity);
  if (!data || data.length === 0) {
    return fail("Data tidak ditemukan atau Anda tidak berhak mengubahnya.");
  }
  for (const path of paths) revalidatePath(path);
  return ok(successMessage);
}

// Perubahan program/tipe kelas/rombel memengaruhi dropdown dan label di halaman lain.
const STRUCTURE_PATHS = ["/admin/program", "/admin/tipe-kelas", "/admin/rombel", "/admin/siswa"];

// ---------------------------------------------------------------- program

export async function createProgramAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = programCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "programs",
    { name: v.name, sort_order: v.sortOrder, is_active: v.isActive },
    "program",
    STRUCTURE_PATHS,
    "Program ditambahkan.",
  );
}

export async function updateProgramAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = programUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "programs",
    id,
    { name: v.name, sort_order: v.sortOrder, is_active: v.isActive },
    "program",
    STRUCTURE_PATHS,
    "Tersimpan.",
  );
}

// ---------------------------------------------------------------- tipe kelas

export async function createClassTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = classTypeCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "class_types",
    {
      program_id: v.programId,
      name: v.name,
      default_size: v.defaultSize,
      sort_order: v.sortOrder,
      is_active: v.isActive,
    },
    "tipe kelas",
    STRUCTURE_PATHS,
    "Tipe kelas ditambahkan.",
  );
}

export async function updateClassTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = classTypeUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "class_types",
    id,
    {
      name: v.name,
      default_size: v.defaultSize,
      sort_order: v.sortOrder,
      is_active: v.isActive,
    },
    "tipe kelas",
    STRUCTURE_PATHS,
    "Tersimpan.",
  );
}

// ---------------------------------------------------------------- rombel

export async function createRombelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = rombelCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  return insertRow(
    "rombels",
    {
      class_type_id: v.classTypeId,
      name: v.name,
      start_date: v.startDate,
      end_date: v.endDate,
      fixed_room_id: v.fixedRoomId,
      is_active: v.isActive,
    },
    "rombel",
    [...STRUCTURE_PATHS, "/admin/ruangan"],
    "Rombel ditambahkan.",
  );
}

export async function updateRombelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = rombelUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "rombels",
    id,
    {
      name: v.name,
      start_date: v.startDate,
      end_date: v.endDate,
      fixed_room_id: v.fixedRoomId,
      is_active: v.isActive,
    },
    "rombel",
    [...STRUCTURE_PATHS, "/admin/ruangan"],
    "Tersimpan.",
  );
}

// ---------------------------------------------------------------- sesi default rombel

/** Sesi default rombel (sesi tetap, hari, siklus). Lewat RPC; admin dicek lagi di database. */
export async function saveRombelDefaultsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = rombelDefaultsSchema.safeParse({
    rombelId: String(formData.get("rombelId") ?? ""),
    slotNo: String(formData.get("slotNo") ?? ""),
    days: formData.getAll("days").filter((v): v is string => typeof v === "string"),
    cycleWeeks: String(formData.get("cycleWeeks") ?? ""),
    cycleAnchor: formData.get("cycleAnchor"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rombel_defaults", {
    p_rombel_id: v.rombelId,
    p_slot_no: v.slotNo,
    p_days: v.days,
    p_cycle_weeks: v.cycleWeeks,
    p_cycle_anchor: v.cycleAnchor,
  });
  if (error) {
    console.error("[academic:rombel-defaults]", error.code, error.message);
    return fail(mapDbError(error, "pola sesi"));
  }
  for (const path of [...STRUCTURE_PATHS, "/admin/pola-sesi", "/admin/jadwal"]) revalidatePath(path);
  return ok("Sesi default tersimpan.");
}

// ---------------------------------------------------------------- siswa

export async function createStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = studentCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;
  const values: Record<string, unknown> = {
    full_name: v.fullName,
    rombel_id: v.rombelId,
    is_active: true,
  };
  // Kode kosong: tidak dikirim, sehingga database membuat SIS###### otomatis.
  if (v.studentCode !== undefined) values.student_code = v.studentCode;
  return insertRow("students", values, "siswa", ["/admin/siswa", "/admin/rombel"], "Siswa ditambahkan.");
}

export async function updateStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = studentUpdateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const { id, ...v } = parsed.data;
  return updateRow(
    "students",
    id,
    { student_code: v.studentCode, full_name: v.fullName, is_active: v.isActive },
    "siswa",
    ["/admin/siswa", `/admin/siswa/${id}`, "/admin/rombel"],
    "Tersimpan.",
  );
}

export async function moveStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const parsed = studentMoveSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));
  const v = parsed.data;

  const supabase = await createClient();
  // Satu panggilan RPC = satu transaksi: siswa pindah dan riwayat tercatat bersama atau tidak sama sekali.
  const { error } = await supabase.rpc("move_student", {
    p_student_id: v.studentId,
    p_to_rombel_id: v.rombelId,
    p_reason: v.reason,
  });
  if (error) return dbFailure(error, "siswa");

  for (const path of ["/admin/siswa", `/admin/siswa/${v.studentId}`, "/admin/rombel"]) {
    revalidatePath(path);
  }
  return ok("Siswa dipindahkan.");
}
