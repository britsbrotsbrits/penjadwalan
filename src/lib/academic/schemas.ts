import { z } from "zod";
import { checkbox, idSchema, intField, textName } from "../master-data/schemas";
import { compareIsoDates, isValidIsoDate } from "./dates";

/**
 * Skema validasi struktur akademik. Cermin dari constraint di migrasi
 * 20261005100000_create_academic_structure.sql; database tetap pertahanan terakhir.
 * Kolom yang tidak boleh diubah setelah dibuat (program_id, class_type_id, rombel_id siswa)
 * sengaja tidak ada di skema update.
 */

// Tanggal opsional dari <input type="date">: kosong -> null, selain itu harus tanggal nyata.
const optionalDate = (label: string) =>
  z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v),
    z
      .string({ invalid_type_error: `${label} tidak valid.` })
      .trim()
      .refine(isValidIsoDate, `${label} harus berupa tanggal yang valid (YYYY-MM-DD).`)
      .nullable(),
  );

// ---------------------------------------------------------------- program

const programFields = {
  name: textName("Nama program"),
  sortOrder: intField("Urutan", 0, 9999),
  isActive: checkbox,
};
export const programCreateSchema = z.object(programFields);
export const programUpdateSchema = z.object({ id: idSchema, ...programFields });

// ---------------------------------------------------------------- tipe kelas

const classTypeFields = {
  name: textName("Nama tipe kelas"),
  defaultSize: intField("Ukuran standar", 1, 500),
  sortOrder: intField("Urutan", 0, 9999),
  isActive: checkbox,
};
export const classTypeCreateSchema = z.object({ programId: idSchema, ...classTypeFields });
// programId tidak bisa diubah (kolom tidak diberi hak UPDATE).
export const classTypeUpdateSchema = z.object({ id: idSchema, ...classTypeFields });

// ---------------------------------------------------------------- rombel

const rombelFields = {
  name: textName("Nama rombel"),
  startDate: optionalDate("Tanggal mulai"),
  endDate: optionalDate("Tanggal selesai"),
  isActive: checkbox,
};

const datesOrderCheck = {
  check: (v: { startDate: string | null; endDate: string | null }) =>
    v.startDate === null || v.endDate === null || compareIsoDates(v.startDate, v.endDate) <= 0,
  options: {
    path: ["endDate"],
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
  },
};

export const rombelCreateSchema = z
  .object({ classTypeId: idSchema, ...rombelFields })
  .refine(datesOrderCheck.check, datesOrderCheck.options);
// classTypeId tidak bisa diubah (kolom tidak diberi hak UPDATE).
export const rombelUpdateSchema = z
  .object({ id: idSchema, ...rombelFields })
  .refine(datesOrderCheck.check, datesOrderCheck.options);

// ---------------------------------------------------------------- siswa

const studentName = z
  .string({ required_error: "Nama siswa wajib diisi.", invalid_type_error: "Nama siswa tidak valid." })
  .trim()
  .min(1, "Nama siswa wajib diisi.")
  .max(200, "Nama siswa maksimal 200 karakter.");

const STUDENT_CODE_MESSAGE =
  "Kode siswa hanya boleh huruf, angka, titik, garis bawah, dan strip (maksimal 30 karakter).";

const studentCode = z
  .string({ invalid_type_error: "Kode siswa tidak valid." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9._-]{1,30}$/, STUDENT_CODE_MESSAGE);

/** Pembuatan: kode boleh dikosongkan -> dibuat otomatis oleh database (SIS000001, dst). */
export const studentCreateSchema = z.object({
  fullName: studentName,
  rombelId: idSchema,
  studentCode: z.preprocess(
    (v) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    studentCode.optional(),
  ),
});

/** rombelId tidak ada di sini: pindah rombel hanya lewat studentMoveSchema + move_student(). */
export const studentUpdateSchema = z.object({
  id: idSchema,
  fullName: studentName,
  studentCode,
  isActive: checkbox,
});

export const studentMoveSchema = z.object({
  studentId: idSchema,
  rombelId: idSchema,
  reason: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v),
    z
      .string({ invalid_type_error: "Alasan tidak valid." })
      .trim()
      .max(500, "Alasan maksimal 500 karakter.")
      .nullable(),
  ),
});

// ---------------------------------------------------------------- baris DB -> tipe aplikasi

export const programRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    sort_order: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }));
export type Program = z.output<typeof programRowSchema>;

export const classTypeRowSchema = z
  .object({
    id: z.string().uuid(),
    program_id: z.string().uuid(),
    name: z.string(),
    default_size: z.number().int(),
    sort_order: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    programId: r.program_id,
    name: r.name,
    defaultSize: r.default_size,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
export type ClassType = z.output<typeof classTypeRowSchema>;

export const rombelRowSchema = z
  .object({
    id: z.string().uuid(),
    class_type_id: z.string().uuid(),
    name: z.string(),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    is_active: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    classTypeId: r.class_type_id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    isActive: r.is_active,
  }));
export type Rombel = z.output<typeof rombelRowSchema>;

export const studentRowSchema = z
  .object({
    id: z.string().uuid(),
    student_code: z.string(),
    full_name: z.string(),
    rombel_id: z.string().uuid(),
    is_active: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    studentCode: r.student_code,
    fullName: r.full_name,
    rombelId: r.rombel_id,
    isActive: r.is_active,
  }));
export type Student = z.output<typeof studentRowSchema>;

export const historyRowSchema = z
  .object({
    id: z.string().uuid(),
    student_id: z.string().uuid(),
    from_rombel_id: z.string().uuid().nullable(),
    to_rombel_id: z.string().uuid(),
    changed_by: z.string().uuid().nullable(),
    reason: z.string().nullable(),
    changed_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    studentId: r.student_id,
    fromRombelId: r.from_rombel_id,
    toRombelId: r.to_rombel_id,
    changedBy: r.changed_by,
    reason: r.reason,
    changedAt: r.changed_at,
  }));
export type RombelHistory = z.output<typeof historyRowSchema>;

export const rombelCountRowSchema = z
  .object({
    rombel_id: z.string().uuid(),
    active_students: z.number().int(),
    total_students: z.number().int(),
  })
  .transform((r) => ({
    rombelId: r.rombel_id,
    activeStudents: r.active_students,
    totalStudents: r.total_students,
  }));
export type RombelCount = z.output<typeof rombelCountRowSchema>;
