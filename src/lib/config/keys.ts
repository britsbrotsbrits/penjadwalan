import { z } from "zod";

/**
 * Registry key konfigurasi. Setiap key punya skema Zod sendiri; nilai yang tersimpan dan
 * nilai dari form divalidasi dengan skema yang sama. Cermin constraint di migrasi
 * 20261008100000_create_academic_config.sql (database tetap pertahanan terakhir).
 * Menambah key baru = tambah di sini DAN di constraint database.
 */

export const CONFIG_KEYS = ["sessions_per_day", "weekly_sessions"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const SCOPE_TYPES = ["global", "program", "class_type", "rombel", "rombel_day"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const CONFIG_DEFS = {
  sessions_per_day: {
    label: "Sesi per hari",
    schema: z
      .number({ invalid_type_error: "Sesi per hari harus berupa angka." })
      .int("Sesi per hari harus bilangan bulat.")
      .min(1, "Sesi per hari minimal 1.")
      .max(99, "Sesi per hari maksimal 99."),
  },
  weekly_sessions: {
    label: "Total sesi per minggu",
    schema: z
      .number({ invalid_type_error: "Total sesi per minggu harus berupa angka." })
      .int("Total sesi per minggu harus bilangan bulat.")
      .min(1, "Total sesi per minggu minimal 1.")
      .max(999, "Total sesi per minggu maksimal 999."),
  },
} as const satisfies Record<ConfigKey, { label: string; schema: z.ZodType<number> }>;

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

export function isScopeType(value: string): value is ScopeType {
  return (SCOPE_TYPES as readonly string[]).includes(value);
}

export type ParsedValue = { ok: true; value: number } | { ok: false; message: string };

/** Validasi nilai mentah (dari database atau form) terhadap skema key-nya. */
export function parseConfigValue(key: ConfigKey, raw: unknown): ParsedValue {
  const r = CONFIG_DEFS[key].schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: r.error.issues[0]?.message ?? "Nilai tidak valid." };
}
