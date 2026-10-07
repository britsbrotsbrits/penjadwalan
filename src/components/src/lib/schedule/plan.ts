import { expandRequirements, type RequirementIssue } from "../scheduler/requirements";
import { scheduler as defaultScheduler } from "../scheduler/solve";
import type { SchedulerFn, SchedulingSnapshot, UnscheduledReason } from "../scheduler/types";
import { expandWeeklyPattern, type DatedSession, type RombelWindow } from "../validation/expand";

/**
 * Rencana jadwal untuk satu periode (Generate Jadwal / full). Murni.
 * Langkah: kebutuhan dari distribusi -> scheduler (pola mingguan) -> pertemuan bertanggal.
 * Tidak membaca atau menulis database.
 */

export type UnscheduledRow = {
  rombel_id: string;
  label: string;
  subtest_ids: string[];
  missing_per_week: number;
  reason_code: UnscheduledReason;
  detail: string | null;
};

export type PlanSummary = {
  seed: number;
  weeklyRequired: number;
  weeklyScheduled: number;
  weeklyUnscheduled: number;
  datedSessions: number;
  issues: RequirementIssue[];
};

export type SchedulePlan = {
  sessions: DatedSession[];
  unscheduled: UnscheduledRow[];
  summary: PlanSummary;
};

export function planSchedule(input: {
  snapshot: SchedulingSnapshot;
  seed: number;
  periodStart: string;
  periodEnd: string;
  windows?: ReadonlyMap<string, RombelWindow>;
  scheduler?: SchedulerFn;
}): SchedulePlan {
  const { snapshot, seed } = input;
  const { requirements, issues } = expandRequirements(snapshot.rombels);
  const run = input.scheduler ?? defaultScheduler;
  const result = run({ snapshot, requirements, seed });

  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const unscheduled: UnscheduledRow[] = [];
  for (const u of result.unscheduled) {
    const req = reqById.get(u.requirementId);
    if (!req || u.missing <= 0) continue;
    unscheduled.push({
      rombel_id: req.rombelId,
      label: req.label,
      subtest_ids: [...req.allowedSubtestIds],
      missing_per_week: u.missing,
      reason_code: u.reason,
      detail: u.detail ?? null,
    });
  }

  const sessions = expandWeeklyPattern(result.scheduled, input.periodStart, input.periodEnd, input.windows);
  const weeklyRequired = requirements.reduce((n, r) => n + r.sessions, 0);
  return {
    sessions,
    unscheduled,
    summary: {
      seed,
      weeklyRequired,
      weeklyScheduled: result.scheduled.length,
      weeklyUnscheduled: unscheduled.reduce((n, u) => n + u.missing_per_week, 0),
      datedSessions: sessions.length,
      issues,
    },
  };
}
