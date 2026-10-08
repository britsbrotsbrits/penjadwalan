import { z } from "zod";
import { checkbox, idSchema, intField } from "../master-data/schemas";

/**
 * Skema validasi tutor. Cermin dari constraint di migrasi 20261006100000_create_tutors.sql;
 * database tetap pertahanan terakhir.
 */

// Rate dalam Rupiah bulat. Kosong = belum diisi (NULL), bukan 0.
const rateField = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v),
  z
    .string({ invalid_type_error: "Rate tidak valid." })
    .trim()
    .regex(/^\d{1,9}$/, "Rate harus berupa angka bulat Rupiah tanpa titik atau koma.")
    .transform(Number)
    .refine((n) => n <= 100_000_000, "Rate maksimal Rp100.000.000 per sesi.")
    .nullable(),
);

export const tutorUpdateSchema = z.object({
  tutorId: idSchema,
  fullName: z
    .string({ required_error: "Nama wajib diisi.", invalid_type_error: "Nama tidak valid." })
    .trim()
    .min(1, "Nama wajib diisi.")
    .max(200, "Nama maksimal 200 karakter."),
  accountActive: checkbox,
  level: intField("Level", 0, 99),
  rate: rateField,
  schedulable: checkbox,
});

const emailField = z
  .string({ required_error: "Email wajib diisi." })
  .trim()
  .toLowerCase()
  .min(1, "Email wajib diisi.")
  .max(254, "Email terlalu panjang.")
  .email("Format email tidak valid.");

/** Tambah mentor baru dari aplikasi (akun login dibuat lewat Supabase Auth Admin API). */
export const tutorCreateSchema = z.object({
  fullName: z
    .string({ required_error: "Nama wajib diisi.", invalid_type_error: "Nama tidak valid." })
    .trim()
    .min(1, "Nama wajib diisi.")
    .max(200, "Nama maksimal 200 karakter."),
  email: emailField,
  level: intField("Level", 0, 99),
  rate: rateField,
  schedulable: checkbox,
  sendInvite: checkbox,
});

/** Ganti email akun mentor (mis. dari email sementara ke email asli). */
export const tutorEmailSchema = z.object({
  tutorId: idSchema,
  email: emailField,
  sendReset: checkbox,
});

export const competenciesSchema = z.object({
  tutorId: idSchema,
  subtestIds: z
    .array(idSchema)
    .max(100, "Terlalu banyak subtes.")
    .transform((ids) => [...new Set(ids)]),
});

// ---------------------------------------------------------------- baris DB -> tipe aplikasi

export const tutorProfileRowSchema = z
  .object({
    id: z.string().uuid(),
    profile_id: z.string().uuid(),
    level: z.number().int(),
    rate_per_session: z.number().int().nullable(),
    is_active: z.boolean(),
    availability_updated_at: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    profileId: r.profile_id,
    level: r.level,
    ratePerSession: r.rate_per_session,
    isSchedulable: r.is_active,
    availabilityUpdatedAt: r.availability_updated_at,
  }));
export type TutorProfile = z.output<typeof tutorProfileRowSchema>;

export const tutorAccountRowSchema = z
  .object({
    id: z.string().uuid(),
    role: z.string(),
    full_name: z.string(),
    is_active: z.boolean(),
  })
  .transform((r) => ({ id: r.id, role: r.role, fullName: r.full_name, isAccountActive: r.is_active }));
export type TutorAccount = z.output<typeof tutorAccountRowSchema>;

export const competencyRowSchema = z
  .object({ tutor_id: z.string().uuid(), subtest_id: z.string().uuid() })
  .transform((r) => ({ tutorId: r.tutor_id, subtestId: r.subtest_id }));
export type Competency = z.output<typeof competencyRowSchema>;

export const availabilityRowSchema = z
  .object({
    tutor_id: z.string().uuid(),
    day_of_week: z.number().int(),
    slot_no: z.number().int(),
    available: z.boolean(),
  })
  .transform((r) => ({
    tutorId: r.tutor_id,
    day: r.day_of_week,
    slotNo: r.slot_no,
    available: r.available,
  }));
export type TutorAvailabilityRow = z.output<typeof availabilityRowSchema>;

export const emailRowSchema = z.object({ id: z.string().uuid(), email: z.string().nullable() });
