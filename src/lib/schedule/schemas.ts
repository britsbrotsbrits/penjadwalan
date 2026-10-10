import { z } from "zod";
import { parseIsoDate, diffDays } from "../validation/dates";

/** Batas panjang periode; cermin constraint schedule_periods_max_length di database. */
export const MAX_PERIOD_DAYS = 92;

const isoDate = (label: string) =>
  z
    .string({ required_error: `${label} wajib diisi.` })
    .trim()
    .refine((v) => parseIsoDate(v) !== null, `${label} tidak valid.`);

const periodFields = {
  name: z
    .string({ required_error: "Nama periode wajib diisi." })
    .trim()
    .min(1, "Nama periode wajib diisi.")
    .max(100, "Nama periode maksimal 100 karakter."),
  startDate: isoDate("Tanggal mulai"),
  endDate: isoDate("Tanggal selesai"),
};

function checkRange(v: { startDate: string; endDate: string }, ctx: z.RefinementCtx) {
  if (parseIsoDate(v.startDate) === null || parseIsoDate(v.endDate) === null) return;
  const days = diffDays(v.startDate, v.endDate) + 1;
  if (days < 1) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai." });
  } else if (days > MAX_PERIOD_DAYS) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: `Periode maksimal ${MAX_PERIOD_DAYS} hari.` });
  }
}

export const periodCreateSchema = z.object(periodFields).superRefine(checkRange);
export const periodUpdateSchema = z.object({ id: z.string().uuid("ID tidak valid."), ...periodFields }).superRefine(checkRange);

export const generateSchema = z.object({
  periodId: z.string().uuid("ID tidak valid."),
  seed: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 4294967295), "Seed harus bilangan bulat 0 sampai 4294967295."),
  confirmReplace: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const generateAdditionalSchema = z.object({
  periodId: z.string().uuid("ID tidak valid."),
  seed: generateSchema.shape.seed,
});

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const statusChangeSchema = z
  .object({
    periodId: z.string().uuid("ID tidak valid."),
    to: z.enum(["APPROVED", "GENERATED", "LOCKED", "CANCELLED"], { errorMap: () => ({ message: "Status tujuan tidak valid." }) }),
    confirm: checkbox,
  })
  .superRefine((v, ctx) => {
    if ((v.to === "LOCKED" || v.to === "CANCELLED") && !v.confirm) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Centang konfirmasi: perpindahan ini tidak bisa dibatalkan." });
    }
  });

const sessionFields = {
  sessionDate: isoDate("Tanggal"),
  slotNo: z.coerce.number({ invalid_type_error: "Sesi tidak valid." }).int("Sesi tidak valid.").min(1, "Sesi tidak valid.").max(99, "Sesi tidak valid."),
  subtestId: z.string().uuid("Pilih subtes."),
  tutorId: z.string().uuid("Pilih mentor."),
  roomId: z.string().uuid("Pilih ruangan."),
};

export const sessionCreateSchema = z.object({
  periodId: z.string().uuid("ID tidak valid."),
  rombelId: z.string().uuid("Pilih rombel."),
  ...sessionFields,
});
export const sessionUpdateSchema = z.object({ id: z.string().uuid("ID tidak valid."), ...sessionFields });
export const sessionCancelSchema = z.object({ id: z.string().uuid("ID tidak valid.") });

// ---------------------------------------------------------------- baris DB -> tipe aplikasi
export const periodRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    status: z.enum(["DRAFT", "GENERATED", "APPROVED", "LOCKED", "CANCELLED"]),
  })
  .transform((r) => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, status: r.status }));
export type SchedulePeriod = z.output<typeof periodRowSchema>;

export const sessionRowSchema = z
  .object({
    id: z.string().uuid(),
    period_id: z.string().uuid(),
    session_date: z.string(),
    slot_no: z.number().int(),
    rombel_id: z.string().uuid(),
    subtest_id: z.string().uuid(),
    tutor_id: z.string().uuid(),
    room_id: z.string().uuid(),
    source: z.enum(["GENERATED", "MANUAL", "ADDITIONAL"]),
    display_label: z.string().nullable().optional().default(null),
  })
  .transform((r) => ({
    id: r.id,
    periodId: r.period_id,
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    rombelId: r.rombel_id,
    subtestId: r.subtest_id,
    tutorId: r.tutor_id,
    roomId: r.room_id,
    source: r.source,
    displayLabel: r.display_label,
  }));
export type TeachingSession = z.output<typeof sessionRowSchema>;

export const runRowSchema = z
  .object({ id: z.string().uuid(), seed: z.number(), summary: z.unknown(), created_at: z.string() })
  .transform((r) => ({ id: r.id, seed: r.seed, summary: r.summary, createdAt: r.created_at }));
export type SchedulingRun = z.output<typeof runRowSchema>;

export const unscheduledRowSchema = z
  .object({
    id: z.string().uuid(),
    rombel_id: z.string().uuid(),
    label: z.string(),
    subtest_ids: z.array(z.string().uuid()),
    missing_per_week: z.number().int(),
    reason_code: z.string(),
    detail: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    rombelId: r.rombel_id,
    label: r.label,
    subtestIds: r.subtest_ids,
    missingPerWeek: r.missing_per_week,
    reasonCode: r.reason_code,
    detail: r.detail,
  }));
export type UnscheduledRequirement = z.output<typeof unscheduledRowSchema>;
