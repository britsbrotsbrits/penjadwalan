import { describe, expect, it } from "vitest";
import { generateScenario } from "../simulator/generator";
import { evaluateSchedule } from "../simulator/metrics";
import { runSimulation } from "../simulator/runner";
import { expandRequirements } from "./requirements";
import { buildContext, ScheduleState } from "./state";
import { createScheduler, orderRequirements, scheduler } from "./solve";
import type { Requirement, SchedRombel, SchedTutor, SchedulingSnapshot } from "./types";

const cells = (days: number[], slots: number[]) => days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo })));
const tutor = (id: string, competencies: string[], av = cells([1, 2], [1, 2])): SchedTutor => ({ id, name: id, level: 50, competencies, availability: av });
const rombel = (over: Partial<SchedRombel> = {}): SchedRombel => ({
  id: "r1", name: "R1", classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 2, weeklySessions: null, distribution: null, ...over,
});
const snap = (over: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot => ({
  days: [1, 2],
  slotNos: [1, 2],
  subtests: [{ id: "pm", code: "PM" }, { id: "pk", code: "PK" }],
  rooms: [{ id: "a", name: "A", capacity: 20 }, { id: "b", name: "B", capacity: 10 }],
  rombels: [rombel()],
  tutors: [tutor("t1", ["pm", "pk"])],
  ...over,
});
const req = (over: Partial<Requirement> = {}): Requirement => ({ id: "r1#0", rombelId: "r1", allowedSubtestIds: ["pm"], label: "PM", sessions: 2, ...over });
const run = (s: SchedulingSnapshot, r: Requirement[], seed = 1) => {
  const result = scheduler({ snapshot: s, requirements: r, seed });
  return { result, report: evaluateSchedule(s, r, result) };
};

describe("scheduler: kasus sederhana", () => {
  it("menjadwalkan semua kebutuhan tanpa pelanggaran, ruangan paling pas, sebar antar hari", () => {
    const { result, report } = run(snap(), [req()]);
    expect(report.violations).toEqual([]);
    expect(report.completionPercent).toBe(100);
    expect(result.unscheduled).toEqual([]);
    expect(new Set(result.scheduled.map((s) => s.roomId))).toEqual(new Set(["b"])); // 10 siswa -> ruangan 10 (paling pas)
    expect(new Set(result.scheduled.map((s) => s.day)).size).toBe(2); // sebar hari
  });

  it("deterministik; seed berbeda boleh berbeda tetapi tetap valid", () => {
    const s = generateScenario("realistic", 3).snapshot;
    const { requirements } = expandRequirements(s.rombels);
    expect(scheduler({ snapshot: s, requirements, seed: 5 })).toEqual(scheduler({ snapshot: s, requirements, seed: 5 }));
    for (const seed of [1, 2]) {
      expect(evaluateSchedule(s, requirements, scheduler({ snapshot: s, requirements, seed })).violations).toEqual([]);
    }
  });

  it("item fleksibel memakai subtes yang diperbolehkan dan menyeimbangkan keduanya", () => {
    const s = snap({ tutors: [tutor("t1", ["pm"], cells([1, 2], [1, 2])), tutor("t2", ["pk"], cells([1, 2], [1, 2]))] });
    const flex = req({ allowedSubtestIds: ["pm", "pk"], label: "PM/PK Flexible", sessions: 2 });
    const { result, report } = run(s, [flex]);
    expect(report.violations).toEqual([]);
    expect(result.scheduled.map((x) => x.subtestId).sort()).toEqual(["pk", "pm"]);
  });

  it("ruangan tetap dipatuhi", () => {
    const s = snap({ rombels: [rombel({ fixedRoomId: "a" })] });
    const { result, report } = run(s, [req()]);
    expect(report.violations).toEqual([]);
    expect(new Set(result.scheduled.map((x) => x.roomId))).toEqual(new Set(["a"]));
  });
});

describe("scheduler: alasan tidak terjadwal (explain)", () => {
  const first = (s: SchedulingSnapshot, r: Requirement[]) => run(s, r).result.unscheduled[0]!;

  it("NO_COMPETENT_TUTOR", () => {
    const u = first(snap({ tutors: [tutor("t1", ["pk"])] }), [req()]);
    expect([u.reason, u.missing]).toEqual(["NO_COMPETENT_TUTOR", 2]);
  });

  it("NO_AVAILABLE_TUTOR_SLOT: tutor kompeten hanya punya 1 sel; sisanya dijelaskan", () => {
    const u = first(snap({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }])] }), [req()]);
    expect([u.reason, u.missing]).toEqual(["NO_AVAILABLE_TUTOR_SLOT", 1]);
    expect(u.detail).toContain("sel");
  });

  it("NO_ROOM_CAPACITY: rombel lebih besar dari semua ruangan", () => {
    expect(first(snap({ rombels: [rombel({ studentCount: 99 })] }), [req()]).reason).toBe("NO_ROOM_CAPACITY");
  });

  it("FIXED_ROOM_BUSY: dua rombel berbagi satu ruangan tetap yang penuh", () => {
    const s = snap({
      rombels: [rombel({ id: "r1", fixedRoomId: "a" }), rombel({ id: "r2", name: "R2", fixedRoomId: "a" })],
      tutors: [tutor("t1", ["pm"]), tutor("t2", ["pm"])],
    });
    const rs = [req({ sessions: 3 }), req({ id: "r2#0", rombelId: "r2", sessions: 3 })];
    const { result, report } = run(s, rs);
    expect(report.violations).toEqual([]);
    expect(report.scheduled).toBe(4); // 2 hari x 2 sesi pada satu ruangan
    expect(result.unscheduled.every((u) => u.reason === "FIXED_ROOM_BUSY")).toBe(true);
    expect(result.unscheduled.reduce((n, u) => n + u.missing, 0)).toBe(2); // 6 dibutuhkan - 4 slot ruangan
  });

  it("NO_FREE_ROOM: ruangan yang muat habis dipakai rombel lain", () => {
    const s = snap({
      rooms: [{ id: "a", name: "A", capacity: 20 }],
      rombels: [rombel({ id: "r1" }), rombel({ id: "r2", name: "R2" })],
      tutors: [tutor("t1", ["pm"]), tutor("t2", ["pm"])],
    });
    const rs = [req({ sessions: 3 }), req({ id: "r2#0", rombelId: "r2", sessions: 3 })];
    const { result } = run(s, rs);
    expect(result.scheduled).toHaveLength(4);
    expect(result.unscheduled.every((u) => u.reason === "NO_FREE_ROOM")).toBe(true);
  });

  it("NO_ROMBEL_SLOT: batas 1 sesi/hari", () => {
    const s = snap({ rombels: [rombel({ sessionsPerDay: 1 })], tutors: [tutor("t1", ["pm"])] });
    const { result } = run(s, [req({ sessions: 3 })]);
    expect(result.scheduled).toHaveLength(2);
    expect([result.unscheduled[0]!.missing, result.unscheduled[0]!.reason]).toEqual([1, "NO_ROMBEL_SLOT"]);
  });

  it("tidak pernah menjadwalkan di luar hard constraint walau tidak muat", () => {
    const s = snap({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }])] });
    expect(run(s, [req({ sessions: 4 })]).report.violations).toEqual([]);
  });
});

describe("orderRequirements dan state", () => {
  it("kebutuhan paling ketat (pasokan tutor kecil) lebih dulu", () => {
    const s = snap({
      tutors: [tutor("t1", ["pm"], cells([1, 2], [1, 2])), tutor("t2", ["pm", "pk"], cells([1, 2], [1, 2])), tutor("t3", ["pm"], cells([1, 2], [1, 2]))],
    });
    const rs = [req({ id: "a", allowedSubtestIds: ["pm"], sessions: 2 }), req({ id: "b", allowedSubtestIds: ["pk"], sessions: 2 })];
    expect(orderRequirements(buildContext(s, rs), rs).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("state: add lalu remove mengembalikan semua indeks ke semula", () => {
    const st = new ScheduleState();
    const id = st.add({ requirementId: "q", rombelId: "r1", subtestId: "pm", tutorId: "t1", roomId: "a", day: 1, slotNo: 1 });
    expect(st.tutorAt.size + st.roomAt.size + st.rombelAt.size).toBe(3);
    st.remove(id);
    expect(st.sessions.size + st.tutorAt.size + st.roomAt.size + st.rombelAt.size + st.rombelDay.size + st.tutorLoad.size + st.perRequirement.size).toBe(0);
    expect(() => st.remove(id)).toThrow();
  });
});

describe("scheduler pada skenario simulator", () => {
  it("small dan realistic: 0 pelanggaran, pembukuan benar, penyelesaian tinggi (banyak seed)", () => {
    for (const mode of ["small", "realistic"] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const r = runSimulation({ mode, seed, scheduler });
        expect(r.report.violations).toEqual([]);
        expect(r.report.scheduled + r.report.unscheduledSessions).toBe(r.report.required);
        expect(r.report.completionPercent).toBeGreaterThan(mode === "small" ? 99 : 95);
        for (const u of r.schedulerResult.unscheduled) expect(u.detail && u.detail.length > 0).toBe(true);
      }
    }
  });

  it("repair menambah hasil tanpa melanggar aturan", () => {
    const without = runSimulation({ mode: "realistic", seed: 1, scheduler: createScheduler({ repairBudget: 0 }) });
    const withRepair = runSimulation({ mode: "realistic", seed: 1, scheduler });
    expect(without.report.violations).toEqual([]);
    expect(withRepair.report.violations).toEqual([]);
    expect(withRepair.report.scheduled).toBeGreaterThan(without.report.scheduled);
  });

  it("stress: tanpa pelanggaran, tidak melebihi slot ruangan, dan selesai dalam batas waktu", () => {
    const t0 = Date.now();
    const r = runSimulation({ mode: "stress", seed: 1, scheduler });
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.report.violations).toEqual([]);
    expect(r.report.scheduled).toBeLessThanOrEqual(r.snapshot.rooms.length * r.snapshot.days.length * r.snapshot.slotNos.length);
    expect(r.report.scheduled + r.report.unscheduledSessions).toBe(r.report.required);
  });
});
