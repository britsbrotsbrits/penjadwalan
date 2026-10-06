import type { DistributionScope, ResolvedDistribution } from "./distribution";
import type { Resolved } from "./resolver";

/**
 * Validasi konfigurasi akademik satu konteks (tipe kelas atau rombel). Murni.
 *
 * Aturan inti (TBD-03, TBD-05): bila total sesi/minggu berbeda dari total distribusi subtes,
 * sistem MELAPORKAN selisihnya sebagai error dan TIDAK menambah/mengurangi sesi secara otomatis.
 * Program tanpa distribusi hanya diberi peringatan "distribusi belum ada".
 */

export type ConfigIssueCode =
  | "SESSIONS_PER_DAY_MISSING"
  | "SESSIONS_PER_DAY_INVALID"
  | "SESSIONS_PER_DAY_EXCEEDS_SLOTS"
  | "WEEKLY_SESSIONS_MISSING"
  | "WEEKLY_SESSIONS_INVALID"
  | "WEEKLY_EXCEEDS_CAPACITY"
  | "DISTRIBUTION_MISSING"
  | "DISTRIBUTION_MISMATCH"
  | "DISTRIBUTION_SUBTEST_UNKNOWN"
  | "DISTRIBUTION_SUBTEST_INACTIVE";

export type ConfigIssue = {
  code: ConfigIssueCode;
  /** error = konfigurasi tidak bisa dipenuhi/ bertentangan; warning = belum lengkap atau perlu perhatian. */
  severity: "error" | "warning";
  message: string;
};

export type SubtestInfo = { id: string; code: string; name: string; isActive: boolean };

export type ValidationInput = {
  sessionsPerDay: Resolved;
  weeklySessions: Resolved;
  distribution: ResolvedDistribution;
  subtests: readonly SubtestInfo[];
  /** Jumlah hari aktif (kalender) dan sesi aktif (slot) saat ini. */
  activeDayCount: number;
  activeSlotCount: number;
};

export function validateAcademicConfig(input: ValidationInput): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (code: ConfigIssueCode, severity: ConfigIssue["severity"], message: string) =>
    issues.push({ code, severity, message });

  const { sessionsPerDay: perDay, weeklySessions: weekly, distribution } = input;

  if (perDay.status === "missing") add("SESSIONS_PER_DAY_MISSING", "warning", "Sesi per hari belum diatur.");
  if (perDay.status === "invalid") add("SESSIONS_PER_DAY_INVALID", "error", `Sesi per hari tersimpan tidak valid: ${perDay.message}`);
  if (perDay.status === "found" && input.activeSlotCount > 0 && perDay.value > input.activeSlotCount) {
    add(
      "SESSIONS_PER_DAY_EXCEEDS_SLOTS",
      "error",
      `Sesi per hari (${perDay.value}) melebihi jumlah sesi aktif di kalender (${input.activeSlotCount}).`,
    );
  }

  if (weekly.status === "missing") add("WEEKLY_SESSIONS_MISSING", "warning", "Total sesi per minggu belum diatur.");
  if (weekly.status === "invalid") add("WEEKLY_SESSIONS_INVALID", "error", `Total sesi per minggu tersimpan tidak valid: ${weekly.message}`);
  if (
    weekly.status === "found" &&
    perDay.status === "found" &&
    input.activeDayCount > 0 &&
    weekly.value > perDay.value * input.activeDayCount
  ) {
    add(
      "WEEKLY_EXCEEDS_CAPACITY",
      "warning",
      `Total sesi per minggu (${weekly.value}) melebihi ${perDay.value} sesi x ${input.activeDayCount} hari aktif = ${perDay.value * input.activeDayCount}.`,
    );
  }

  if (distribution.status === "missing") {
    add("DISTRIBUTION_MISSING", "warning", "Distribusi subtes belum ada.");
  } else {
    if (weekly.status === "found" && distribution.total !== weekly.value) {
      add(
        "DISTRIBUTION_MISMATCH",
        "error",
        `Total distribusi subtes (${distribution.total}) tidak sama dengan total sesi per minggu (${weekly.value}). Sistem tidak menambah atau mengurangi sesi secara otomatis.`,
      );
    }
    const byId = new Map(input.subtests.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const check = (id: string, where: string) => {
      const s = byId.get(id);
      const key = `${id}`;
      if (!s) {
        if (!seen.has(`u${key}`)) add("DISTRIBUTION_SUBTEST_UNKNOWN", "error", `${where}: subtes tidak ditemukan.`);
        seen.add(`u${key}`);
      } else if (!s.isActive && !seen.has(`i${key}`)) {
        add("DISTRIBUTION_SUBTEST_INACTIVE", "warning", `${where}: subtes ${s.code} sudah nonaktif.`);
        seen.add(`i${key}`);
      }
    };
    for (const item of distribution.items) {
      if (item.subtestId) check(item.subtestId, "Distribusi");
      for (const id of item.flexibleSubtestIds) check(id, `Item ${item.label ?? "fleksibel"}`);
    }
  }

  return issues;
}

export function worstConfigSeverity(issues: readonly ConfigIssue[]): "ok" | "warning" | "error" {
  if (issues.some((i) => i.severity === "error")) return "error";
  return issues.length > 0 ? "warning" : "ok";
}

const SCOPE_NAME: Record<DistributionScope, string> = {
  program: "program",
  class_type: "tipe kelas",
  rombel: "rombel",
};
export function describeDistributionScope(scope: DistributionScope): string {
  return SCOPE_NAME[scope];
}
