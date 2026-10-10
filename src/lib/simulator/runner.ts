import { analyzeFeasibility, type FeasibilityReport } from "../scheduler/feasibility";
import { expandRequirements, totalRequiredSessions, type RequirementIssue } from "../scheduler/requirements";
import type { Requirement, SchedulerFn, SchedulerResult, SchedulingSnapshot } from "../scheduler/types";
import { scheduler as defaultScheduler } from "../scheduler/solve";
import { generateScenario, type SimulationMode } from "./generator";
import { evaluateSchedule, type ScheduleReport } from "./metrics";

/**
 * Runner simulator: scenario sintetis -> kebutuhan -> analisis kelayakan -> scheduler -> metrik.
 * Murni dan in-memory: TIDAK menyentuh database produksi. Scheduler disuntikkan (SchedulerFn) agar
 * simulator, tes, dan produksi memakai scheduler yang sama (Phase 9).
 */

/** Scheduler kosong (untuk uji): tidak menjadwalkan apa pun dan mengatakannya terang-terangan. */
export const unavailableScheduler: SchedulerFn = ({ requirements }) => ({
  scheduled: [],
  unscheduled: requirements.map((r) => ({
    requirementId: r.id,
    missing: r.sessions,
    reason: "SCHEDULER_NOT_AVAILABLE" as const,
    detail: "Scheduler tidak dijalankan.",
  })),
});

export type ScenarioSummary = {
  days: number;
  slotsPerDay: number;
  subtests: number;
  rooms: number;
  rombels: number;
  students: number;
  tutors: number;
  tutorCells: number;
  requirements: number;
  requiredSessions: number;
};

export type SimulationRun = {
  mode: SimulationMode;
  seed: number;
  notes: string[];
  scenario: ScenarioSummary;
  snapshot: SchedulingSnapshot;
  requirements: Requirement[];
  requirementIssues: RequirementIssue[];
  feasibility: FeasibilityReport;
  schedulerResult: SchedulerResult;
  report: ScheduleReport;
  /** false bila yang dipakai scheduler kosong (unavailableScheduler). */
  schedulerAvailable: boolean;
};

export function summarizeScenario(snapshot: SchedulingSnapshot, requirements: readonly Requirement[]): ScenarioSummary {
  return {
    days: snapshot.days.length,
    slotsPerDay: snapshot.slotNos.length,
    subtests: snapshot.subtests.length,
    rooms: snapshot.rooms.length,
    rombels: snapshot.rombels.length,
    students: snapshot.rombels.reduce((n, r) => n + r.studentCount, 0),
    tutors: snapshot.tutors.length,
    tutorCells: snapshot.tutors.reduce((n, t) => n + t.availability.length, 0),
    requirements: requirements.length,
    requiredSessions: totalRequiredSessions(requirements),
  };
}

export function runSimulation(options: { mode: SimulationMode; seed: number; scheduler?: SchedulerFn }): SimulationRun {
  const { mode, seed } = options;
  const scheduler = options.scheduler ?? defaultScheduler;
  const { snapshot, notes } = generateScenario(mode, seed);
  const { requirements, issues } = expandRequirements(snapshot.rombels, snapshot.days);
  const feasibility = analyzeFeasibility(snapshot, requirements);
  const schedulerResult = scheduler({ snapshot, requirements, seed });
  const report = evaluateSchedule(snapshot, requirements, schedulerResult);
  return {
    mode,
    seed,
    notes,
    scenario: summarizeScenario(snapshot, requirements),
    snapshot,
    requirements,
    requirementIssues: issues,
    feasibility,
    schedulerResult,
    report,
    schedulerAvailable: scheduler !== unavailableScheduler,
  };
}
