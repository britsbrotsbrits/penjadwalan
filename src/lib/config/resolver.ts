import { parseConfigValue, type ConfigKey, type ScopeType } from "./keys";

/**
 * Resolver konfigurasi. Murni: tanpa Supabase/React/Next.
 *
 * Urutan, dari paling spesifik ke paling umum:
 *   rombel + hari  >  rombel  >  tipe kelas  >  program  >  global
 * Nilai paling spesifik yang ADA menang. Tidak ada nilai bawaan tersembunyi di kode: bila tidak
 * ada baris di level mana pun, hasilnya "missing" (bukan angka karangan).
 * Nilai tersimpan yang rusak (gagal skema) TIDAK dilewati diam-diam: hasilnya "invalid".
 */

export type SettingRow = {
  key: string;
  scopeType: ScopeType;
  scopeId: string | null;
  dayOfWeek: number | null;
  value: unknown;
};

export type ConfigContext = {
  programId?: string | null;
  classTypeId?: string | null;
  rombelId?: string | null;
  /** 1..7 (Senin..Minggu). Hanya dipakai untuk override rombel+hari. */
  dayOfWeek?: number | null;
};

export type ConfigSource = { scopeType: ScopeType; scopeId: string | null; dayOfWeek: number | null };

export type Resolved =
  | { status: "found"; value: number; source: ConfigSource }
  | { status: "invalid"; message: string; source: ConfigSource }
  | { status: "missing" };

function candidates(ctx: ConfigContext): ConfigSource[] {
  const list: ConfigSource[] = [];
  if (ctx.rombelId && ctx.dayOfWeek != null) {
    list.push({ scopeType: "rombel_day", scopeId: ctx.rombelId, dayOfWeek: ctx.dayOfWeek });
  }
  if (ctx.rombelId) list.push({ scopeType: "rombel", scopeId: ctx.rombelId, dayOfWeek: null });
  if (ctx.classTypeId) list.push({ scopeType: "class_type", scopeId: ctx.classTypeId, dayOfWeek: null });
  if (ctx.programId) list.push({ scopeType: "program", scopeId: ctx.programId, dayOfWeek: null });
  list.push({ scopeType: "global", scopeId: null, dayOfWeek: null });
  return list;
}

export function resolveSetting(rows: readonly SettingRow[], key: ConfigKey, ctx: ConfigContext): Resolved {
  for (const source of candidates(ctx)) {
    const row = rows.find(
      (r) =>
        r.key === key &&
        r.scopeType === source.scopeType &&
        r.scopeId === source.scopeId &&
        r.dayOfWeek === source.dayOfWeek,
    );
    if (!row) continue;
    const parsed = parseConfigValue(key, row.value);
    return parsed.ok
      ? { status: "found", value: parsed.value, source }
      : { status: "invalid", message: parsed.message, source };
  }
  return { status: "missing" };
}

const SCOPE_LABEL: Record<ScopeType, string> = {
  global: "global",
  program: "program",
  class_type: "tipe kelas",
  rombel: "rombel",
  rombel_day: "rombel per hari",
};

export function describeSource(source: ConfigSource): string {
  return source.scopeType === "rombel_day" && source.dayOfWeek != null
    ? `${SCOPE_LABEL.rombel_day} (hari ${source.dayOfWeek})`
    : SCOPE_LABEL[source.scopeType];
}
