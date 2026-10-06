import type { Requirement, SchedRombel } from "./types";

/**
 * Langkah 1 pipeline scheduler: konfigurasi + distribusi subtes -> daftar kebutuhan sesi.
 * Aturan inti (TBD-03, TBD-05): sesi TIDAK dikarang. Kebutuhan hanya berasal dari distribusi yang ada.
 * Distribusi tidak ada -> tidak ada kebutuhan untuk rombel itu (dicatat sebagai isu). Total berbeda
 * dari total sesi/minggu -> kebutuhan tetap dari distribusi apa adanya, dan selisih dicatat sebagai isu.
 */

export type RequirementIssueCode = "DISTRIBUTION_MISSING" | "DISTRIBUTION_MISMATCH";

export type RequirementIssue = {
  code: RequirementIssueCode;
  rombelId: string;
  message: string;
};

export type ExpandedRequirements = {
  requirements: Requirement[];
  issues: RequirementIssue[];
};

export function expandRequirements(rombels: readonly SchedRombel[]): ExpandedRequirements {
  const requirements: Requirement[] = [];
  const issues: RequirementIssue[] = [];

  for (const rombel of rombels) {
    if (rombel.distribution === null || rombel.distribution.length === 0) {
      issues.push({
        code: "DISTRIBUTION_MISSING",
        rombelId: rombel.id,
        message: `${rombel.name}: distribusi subtes belum ada; tidak ada kebutuhan sesi yang dibuat.`,
      });
      continue;
    }

    let total = 0;
    rombel.distribution.forEach((item, index) => {
      const allowed = item.subtestId ? [item.subtestId] : [...item.flexibleSubtestIds];
      if (allowed.length === 0 || item.sessionsPerWeek <= 0) return;
      total += item.sessionsPerWeek;
      requirements.push({
        id: `${rombel.id}#${index}`,
        rombelId: rombel.id,
        allowedSubtestIds: allowed,
        label: item.label ?? item.subtestId ?? "?",
        sessions: item.sessionsPerWeek,
      });
    });

    if (rombel.weeklySessions !== null && rombel.weeklySessions !== total) {
      issues.push({
        code: "DISTRIBUTION_MISMATCH",
        rombelId: rombel.id,
        message: `${rombel.name}: total distribusi (${total}) tidak sama dengan total sesi per minggu (${rombel.weeklySessions}). Tidak ada sesi tambahan yang dibuat.`,
      });
    }
  }

  return { requirements, issues };
}

export function totalRequiredSessions(requirements: readonly Requirement[]): number {
  return requirements.reduce((sum, r) => sum + r.sessions, 0);
}
