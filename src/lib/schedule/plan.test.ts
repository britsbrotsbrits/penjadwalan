import { describe, expect, it } from "vitest";
import { generateScenario } from "../simulator/generator";
import { scheduler } from "../scheduler/solve";
import { checkWeeklyDistribution } from "../validation/weekly-distribution";
import { expandRequirements } from "../scheduler/requirements";
import { flexLabels, planSchedule } from "./plan";
import type { SchedulingSnapshot } from "../scheduler/types";

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

describe("planSchedule: pola sesi, label fleksibel, hari dan siklus rombel", () => {
  const cells = (days: number[], slots: number[]) => days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo })));
  const snap: SchedulingSnapshot = {
    days: [1, 2, 3, 4, 5],
    tryoutDays: [6],
    slotNos: [1, 2, 3, 4, 5],
    subtests: [{ id: "pk", code: "PK" }, { id: "pm", code: "PM" }, { id: "pu", code: "PU" }],
    rooms: [{ id: "k1", name: "K1", capacity: 30 }, { id: "k2", name: "K2", capacity: 30 }],
    rombels: [
      {
        id: "gy", name: "Gold A", classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 2, weeklySessions: null,
        pattern: { subtestSlots: [1, 3], drillingSlots: [2] },
        distribution: [
          { subtestId: null, flexibleSubtestIds: ["pk", "pm"], label: "PK/PM Flexible", sessionsPerWeek: 1 },
          { subtestId: "pu", flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 },
        ],
      },
      {
        id: "k2", name: "XI A", classTypeId: "c2", studentCount: 10, fixedRoomId: null, sessionsPerDay: 1, weeklySessions: null,
        pattern: { subtestSlots: [4], drillingSlots: [] }, days: [2, 3, 5],
        distribution: [
          { subtestId: "pk", flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 },
          { subtestId: "pm", flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 },
          { subtestId: "pu", flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 },
        ],
      },
    ],
    tutors: [{ id: "t1", name: "T1", level: 1, competencies: ["pk", "pm", "pu"], availability: cells([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]) }],
  };
  const windows = new Map([["k2", { start: null, end: null, cycleWeeks: 3, cycleAnchor: "2026-11-02" }]]);
  const plan = planSchedule({ snapshot: snap, seed: 3, periodStart: "2026-11-02", periodEnd: "2026-12-06", windows });

  it("label fleksibel: PK/PM ditulis apa adanya, bukan diacak jadi PK atau PM; subtes biasa tanpa label", () => {
    const flex = plan.sessions.filter((x) => x.rombelId === "gy" && x.displayLabel);
    expect(flex.length).toBeGreaterThan(0);
    expect(new Set(flex.map((x) => x.displayLabel))).toEqual(new Set(["PK/PM"]));
    expect(plan.sessions.filter((x) => x.rombelId === "gy" && !x.displayLabel).every((x) => x.subtestId === "pu")).toBe(true);
    expect(flexLabels(snap, [{ id: "a", rombelId: "r", allowedSubtestIds: ["pk"], label: "PK", sessions: 1 }]).size).toBe(0);
  });

  it("Gap Year tidak pernah punya sesi 2 (DRILLING) dan tidak ada sesi di hari tryout (Sabtu)", () => {
    expect(plan.sessions.some((x) => x.rombelId === "gy" && x.slotNo === 2)).toBe(false);
    expect(plan.sessions.some((x) => new Date(x.sessionDate + "T00:00:00Z").getUTCDay() === 6)).toBe(false);
  });

  it("kelas 2: sesi 4, hanya Selasa/Rabu/Jumat, hanya satu minggu tiap tiga minggu", () => {
    const mine = plan.sessions.filter((x) => x.rombelId === "k2");
    expect(mine.every((x) => x.slotNo === 4)).toBe(true);
    const dows = new Set(mine.map((x) => new Date(x.sessionDate + "T00:00:00Z").getUTCDay()));
    expect([...dows].sort()).toEqual([2, 3, 5]);
    expect([...new Set(mine.map((x) => x.sessionDate.slice(0, 7)))]).toEqual(["2026-11"]);
    // periode 2 Nov - 6 Des: minggu 2 Nov dan 23 Nov (3 minggu kemudian) saja
    expect([...new Set(mine.map((x) => x.sessionDate))].sort()).toEqual([
      "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-24", "2026-11-25", "2026-11-27",
    ]);
    expect(plan.unscheduled).toEqual([]);
  });
});
