import type { Requirement, SchedRombel } from "./types";

/**
 * Langkah 1 pipeline scheduler: konfigurasi + distribusi subtes -> daftar kebutuhan sesi.
 * Aturan inti (TBD-03, TBD-05): sesi TIDAK dikarang. Kebutuhan hanya berasal dari distribusi yang ada.
 * Distribusi tidak ada -> tidak ada kebutuhan untuk rombel itu (dicatat sebagai isu). Total berbeda
 * dari total sesi/minggu -> kebutuhan tetap dari distribusi apa adanya, dan selisih dicatat sebagai isu.
 */

export type RequirementIssueCode = "DISTRIBUTION_MISSING" | "DISTRIBUTION_MISMATCH" | "PATTERN_MISMATCH";

export type RequirementIssue = {
  code: RequirementIssueCode;
  rombelId: string;
  message: string;
};

export type ExpandedRequirements = {
  requirements: Requirement[];
  issues: RequirementIssue[];
};

export function expandRequirements(rombels: readonly SchedRombel[], regularDays?: readonly number[]): ExpandedRequirements {
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

    const pi = patternIssue(rombel, total, regularDays);
    if (pi) issues.push(pi);

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

/** Pemeriksaan tambahan (Phase 14): total distribusi vs jumlah sesi subtes yang disediakan pola. */
function patternIssue(rombel: SchedRombel, total: number, regularDays: readonly number[] | undefined): RequirementIssue | null {
  if (!rombel.pattern || regularDays === undefined) return null;
  const dayCount = rombel.days && rombel.days.length > 0 ? regularDays.filter((d) => rombel.days!.includes(d)).length : regularDays.length;
  const capacity = rombel.pattern.subtestSlots.length * dayCount;
  if (total === capacity) return null;
  return {
    code: "PATTERN_MISMATCH",
    rombelId: rombel.id,
    message:
      total > capacity
        ? `${rombel.name}: distribusi butuh ${total} sesi per minggu, pola sesi hanya menyediakan ${capacity}. Kelebihan ${total - capacity} tidak bisa dijadwalkan.`
        : `${rombel.name}: distribusi ${total} sesi per minggu, pola sesi menyediakan ${capacity}. ${capacity - total} sesi subtes dibiarkan kosong.`,
  };
}

export function totalRequiredSessions(requirements: readonly Requirement[]): number {
  return requirements.reduce((sum, r) => sum + r.sessions, 0);
}
