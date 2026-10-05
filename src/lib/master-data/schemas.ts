import { z } from "zod";
import { endsSameDay, normalizeTime, parseTime, slotEndTime } from "./time";

/**
 * Skema validasi master data. Dipakai di server action (input form) dan saat membaca baris DB.
 * Validasi ini cermin dari constraint di migrasi 20261004110000_create_master_data.sql;
 * database tetap menjadi pertahanan terakhir.
 */

export const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: `${label} harus berupa angka.` })
    .int(`${label} harus berupa bilangan bulat.`)
    .min(min, `${label} minimal ${min}.`)
    .max(max, `${label} maksimal ${max}.`);

// Checkbox HTML: dikirim "on" bila dicentang, tidak dikirim sama sekali bila tidak.
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const textName = (label: string) =>
  z
    .string({ required_error: `${label} wajib diisi.`, invalid_type_error: `${label} tidak valid.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(100, `${label} maksimal 100 karakter.`);

export const idSchema = z.string().uuid("ID tidak valid.");

// ---------------------------------------------------------------- input form

const subtestFields = {
  code: z
    .string({ required_error: "Kode wajib diisi.", invalid_type_error: "Kode tidak valid." })
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9_]{1,20}$/,
      "Kode hanya boleh huruf, angka, dan garis bawah (maksimal 20 karakter).",
    ),
  name: textName("Nama"),
  sortOrder: intField("Urutan", 0, 9999),
  isActive: checkbox,
};

export const subtestCreateSchema = z.object(subtestFields);
export const subtestUpdateSchema = z.object({ id: idSchema, ...subtestFields });

const roomFields = {
  name: textName("Nama ruangan"),
  capacity: intField("Kapasitas", 1, 500),
  isActive: checkbox,
};

export const roomCreateSchema = z.object(roomFields);
export const roomUpdateSchema = z.object({ id: idSchema, ...roomFields });

const TIME_MESSAGE = "Jam mulai harus berformat HH:MM (00:00 sampai 23:59).";

const slotFields = {
  slotNo: intField("Nomor sesi", 1, 99),
  startTime: z
    .string({ required_error: TIME_MESSAGE, invalid_type_error: TIME_MESSAGE })
    .trim()
    .refine((v) => parseTime(v) !== null, TIME_MESSAGE)
    .transform(normalizeTime),
  durationMinutes: intField("Durasi", 15, 480),
  isActive: checkbox,
};

const endsSameDayCheck = {
  check: (v: { startTime: string; durationMinutes: number }) =>
    endsSameDay(v.startTime, v.durationMinutes),
  options: {
    path: ["durationMinutes"],
    message: "Sesi harus selesai sebelum tengah malam.",
  },
};

export const slotCreateSchema = z
  .object(slotFields)
  .refine(endsSameDayCheck.check, endsSameDayCheck.options);
export const slotUpdateSchema = z
  .object({ id: idSchema, ...slotFields })
  .refine(endsSameDayCheck.check, endsSameDayCheck.options);

export const activeDaysSchema = z
  .object({
    days: z
      .array(
        z.coerce
          .number({ invalid_type_error: "Hari tidak valid." })
          .int("Hari tidak valid.")
          .min(1, "Hari tidak valid.")
          .max(7, "Hari tidak valid."),
      )
      .min(1, "Pilih minimal satu hari aktif."),
  })
  .transform((v) => ({ days: [...new Set(v.days)].sort((a, b) => a - b) }));

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Input tidak valid.";
}

// ---------------------------------------------------------------- baris DB -> tipe aplikasi
// Jangan percaya data yang tidak divalidasi: bentuk baris dari Supabase dicek saat runtime.

export const subtestRowSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    sort_order: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
export type Subtest = z.output<typeof subtestRowSchema>;

export const roomRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    capacity: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => ({ id: r.id, name: r.name, capacity: r.capacity, isActive: r.is_active }));
export type Room = z.output<typeof roomRowSchema>;

export const slotRowSchema = z
  .object({
    id: z.string().uuid(),
    slot_no: z.number().int(),
    start_time: z.string(),
    duration_minutes: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => {
    const startTime = normalizeTime(r.start_time);
    return {
      id: r.id,
      slotNo: r.slot_no,
      startTime,
      durationMinutes: r.duration_minutes,
      endTime: slotEndTime(startTime, r.duration_minutes) ?? "",
      isActive: r.is_active,
    };
  });
export type SessionSlot = z.output<typeof slotRowSchema>;

export const dayRowSchema = z
  .object({
    day_of_week: z.number().int(),
    is_active: z.boolean(),
  })
  .transform((r) => ({ dayOfWeek: r.day_of_week, isActive: r.is_active }));
export type CalendarDay = z.output<typeof dayRowSchema>;
