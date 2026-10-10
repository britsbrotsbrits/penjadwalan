import { z } from "zod";
import { idSchema } from "../master-data/schemas";
import { CONFIG_DEFS, SCOPE_TYPES, isConfigKey, type ConfigKey } from "./keys";
import type { PatternItem } from "./pattern";
import type { DistributionItem } from "./distribution";
import type { SettingRow } from "./resolver";

/** Skema baris database + parser form konfigurasi dan distribusi. Murni. */

export const settingRowSchema = z
  .object({
    key: z.string(),
    scope_type: z.enum(SCOPE_TYPES),
    scope_id: z.string().uuid().nullable(),
    day_of_week: z.number().int().nullable(),
    value: z.unknown(),
  })
  .transform(
    (r): SettingRow => ({
      key: r.key,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
      dayOfWeek: r.day_of_week,
      value: r.value,
    }),
  );

export const distributionRowSchema = z
  .object({
    scope_type: z.enum(["program", "class_type", "rombel"]),
    scope_id: z.string().uuid(),
    subtest_id: z.string().uuid().nullable(),
    flexible_subtest_ids: z.array(z.string().uuid()),
    label: z.string().nullable(),
    sessions_per_week: z.number().int(),
    sort_order: z.number().int(),
  })
  .transform(
    (r): DistributionItem => ({
      scopeType: r.scope_type,
      scopeId: r.scope_id,
      subtestId: r.subtest_id,
      flexibleSubtestIds: r.flexible_subtest_ids,
      label: r.label,
      sessionsPerWeek: r.sessions_per_week,
      sortOrder: r.sort_order,
    }),
  );

export const patternRowSchema = z
  .object({
    scope_type: z.enum(["program", "class_type", "rombel"]),
    scope_id: z.string().uuid(),
    slot_no: z.number().int(),
    kind: z.enum(["SUBTEST", "DRILLING"]),
  })
  .transform((r): PatternItem => ({ scopeType: r.scope_type, scopeId: r.scope_id, slotNo: r.slot_no, kind: r.kind }));

export const exclusionRowSchema = z
  .object({ subtest_a: z.string().uuid(), subtest_b: z.string().uuid() })
  .transform((r) => ({ subtestA: r.subtest_a, subtestB: r.subtest_b }));

// ---------------------------------------------------------------- form konfigurasi per scope

/** Isian angka opsional: kosong = null (artinya "ikut parent": nilai di scope ini dihapus). */
export type OptionalValue = { ok: true; value: number | null } | { ok: false; message: string };

export function parseOptionalValue(key: ConfigKey, raw: unknown): OptionalValue {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null };
  }
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  const parsed = CONFIG_DEFS[key].schema.safeParse(n);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? "Nilai tidak valid." };
}

export const scopeConfigFormSchema = z.object({
  scopeType: z.enum(["program", "class_type", "rombel"]),
  scopeId: idSchema,
});

export { isConfigKey };

// ---------------------------------------------------------------- form distribusi

export const FLEX_VALUE = "__flex__";
export const MAX_DISTRIBUTION_ROWS = 20;

export type DistributionFormRow = {
  /** "" (baris kosong), id subtes, atau FLEX_VALUE. */
  subtest: string;
  label: string;
  flexible: string[];
  sessions: string;
};

export type DistributionRpcItem =
  | { subtest_id: string; sessions_per_week: number }
  | { label: string; flexible_subtest_ids: string[]; sessions_per_week: number };

export type DistributionParse =
  | { ok: true; items: DistributionRpcItem[] }
  | { ok: false; message: string };

const sessionsSchema = CONFIG_DEFS.weekly_sessions.schema.pipe(z.number().max(99, "Sesi per minggu maksimal 99."));

export function parseDistributionRows(rows: readonly DistributionFormRow[]): DistributionParse {
  if (rows.length > MAX_DISTRIBUTION_ROWS) {
    return { ok: false, message: `Maksimal ${MAX_DISTRIBUTION_ROWS} baris.` };
  }
  const items: DistributionRpcItem[] = [];
  const seenSubtests = new Set<string>();
  const seenLabels = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const no = i + 1;
    const subtest = row.subtest.trim();
    const sessionsRaw = row.sessions.trim();
    if (subtest === "" && sessionsRaw === "" && row.label.trim() === "") continue; // baris kosong

    if (subtest === "") return { ok: false, message: `Baris ${no}: pilih subtes atau item fleksibel.` };
    if (sessionsRaw === "") return { ok: false, message: `Baris ${no}: sesi per minggu wajib diisi.` };
    const n = sessionsSchema.safeParse(Number(sessionsRaw));
    if (!n.success) return { ok: false, message: `Baris ${no}: ${n.error.issues[0]?.message ?? "sesi tidak valid."}` };

    if (subtest === FLEX_VALUE) {
      const label = row.label.trim();
      if (label === "") return { ok: false, message: `Baris ${no}: nama item fleksibel wajib diisi.` };
      if (label.length > 100) return { ok: false, message: `Baris ${no}: nama item maksimal 100 karakter.` };
      const ids = [...new Set(row.flexible)];
      if (ids.length < 2) return { ok: false, message: `Baris ${no}: pilih minimal 2 subtes yang boleh mengisi item fleksibel.` };
      if (ids.some((id) => !idSchema.safeParse(id).success)) return { ok: false, message: `Baris ${no}: subtes tidak valid.` };
      const labelKey = label.toLowerCase();
      if (seenLabels.has(labelKey)) return { ok: false, message: `Baris ${no}: nama item fleksibel "${label}" sudah dipakai.` };
      seenLabels.add(labelKey);
      items.push({ label, flexible_subtest_ids: ids, sessions_per_week: n.data });
    } else {
      if (!idSchema.safeParse(subtest).success) return { ok: false, message: `Baris ${no}: subtes tidak valid.` };
      if (seenSubtests.has(subtest)) return { ok: false, message: `Baris ${no}: subtes yang sama sudah ada di baris lain.` };
      seenSubtests.add(subtest);
      items.push({ subtest_id: subtest, sessions_per_week: n.data });
    }
  }

  if (items.length === 0) {
    return { ok: false, message: "Isi minimal satu baris, atau gunakan tombol Hapus distribusi." };
  }
  return { ok: true, items };
}

export const distributionScopeFormSchema = scopeConfigFormSchema;
