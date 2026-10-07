import { describe, expect, it } from "vitest";
import { generateScenario } from "../simulator/generator";
import { scheduler } from "../scheduler/solve";
import { checkWeeklyDistribution } from "../validation/weekly-distribution";
import { expandRequirements } from "../scheduler/requirements";
import { planSchedule } from "./plan";

describe("planSchedule", () => {
  const { snapshot } = generateScenario("small", 11);
  const plan = planSchedule({ snapshot, seed: 11, periodStart: "2026-11-02", periodEnd: "2026-11-29" });

  it("deterministik untuk input dan seed yang sama", () => {
    const again = planSchedule({ snapshot, seed: 11, periodStart: "2026-11-02", periodEnd: "2026-11-29" });
    expect(again).toEqual(plan);
  });

  it("ringkasan konsisten dengan hasil scheduler", () => {
    const { requirements } = expandRequirements(snapshot.rombels);
    const direct = scheduler({ snapshot, requirements, seed: 11 });
    expect(plan.summary.weeklyScheduled).toBe(direct.scheduled.length);
    expect(plan.summary.weeklyRequired).toBe(requirements.reduce((n, r) => n + r.sessions, 0));
    expect(plan.summary.weeklyScheduled + plan.summary.weeklyUnscheduled).toBe(plan.summary.weeklyRequired);
    expect(plan.summary.datedSessions).toBe(plan.sessions.length);
    expect(plan.summary.seed).toBe(11);
  });

  it("empat minggu penuh = pola mingguan diulang empat kali", () => {
    expect(plan.sessions.length).toBe(plan.summary.weeklyScheduled * 4);
  });

  it("jadwal hasil scheduler lolos pemeriksaan distribusi mingguan pada minggu lengkap", () => {
    const { requirements } = expandRequirements(snapshot.rombels);
    // Kebutuhan yang tidak terpenuhi sudah tercatat di unscheduled; hanya rombel penuh yang diperiksa.
    const incomplete = new Set(plan.unscheduled.map((u) => u.rombel_id));
    const issues = checkWeeklyDistribution({
      sessions: plan.sessions, requirements, periodStart: "2026-11-02", periodEnd: "2026-11-29",
      rombelIds: snapshot.rombels.map((r) => r.id).filter((id) => !incomplete.has(id)),
    });
    expect(issues).toEqual([]);
  });

  it("kebutuhan belum terpenuhi memuat rombel, alasan, dan jumlah per minggu", () => {
    for (const u of plan.unscheduled) {
      expect(u.missing_per_week).toBeGreaterThan(0);
      expect(snapshot.rombels.some((r) => r.id === u.rombel_id)).toBe(true);
      expect(u.subtest_ids.length).toBeGreaterThan(0);
    }
  });

  it("scheduler yang tidak tersedia: semua kebutuhan tercatat, tidak ada sesi", () => {
    const none = planSchedule({
      snapshot, seed: 1, periodStart: "2026-11-02", periodEnd: "2026-11-08",
      scheduler: ({ requirements }) => ({
        scheduled: [],
        unscheduled: requirements.map((r) => ({ requirementId: r.id, missing: r.sessions, reason: "SCHEDULER_NOT_AVAILABLE" as const })),
      }),
    });
    expect(none.sessions).toEqual([]);
    expect(none.summary.weeklyUnscheduled).toBe(none.summary.weeklyRequired);
    expect(none.unscheduled.every((u) => u.reason_code === "SCHEDULER_NOT_AVAILABLE")).toBe(true);
  });
});
