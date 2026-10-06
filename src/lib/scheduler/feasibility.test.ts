import { describe, expect, it } from "vitest";
import { analyzeFeasibility } from "./feasibility";
import type { Requirement, SchedRombel, SchedTutor, SchedulingSnapshot } from "./types";

const cells = (days: number[], slots: number[]) => days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo })));
const tutor = (id: string, competencies: string[], av = cells([1, 2], [1, 2])): SchedTutor => ({
  id, name: id, level: 50, competencies, availability: av,
});
const rombel = (over: Partial<SchedRombel> = {}): SchedRombel => ({
  id: "r1", name: "R1", classTypeId: "c", studentCount: 10, fixedRoomId: null,
  sessionsPerDay: 2, weeklySessions: null, distribution: null, ...over,
});
const base = (over: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot => ({
  days: [1, 2],
  slotNos: [1, 2],
  subtests: [{ id: "pm", code: "PM" }, { id: "pk", code: "PK" }],
  rooms: [{ id: "a", name: "A", capacity: 20 }, { id: "b", name: "B", capacity: 5 }],
  rombels: [rombel()],
  tutors: [tutor("t1", ["pm", "pk"])],
  ...over,
});
const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: "r1#0", rombelId: "r1", allowedSubtestIds: ["pm"], label: "PM", sessions: 2, ...over,
});
const codes = (s: SchedulingSnapshot, r: Requirement[]) => analyzeFeasibility(s, r).issues.map((i) => i.code);

describe("analyzeFeasibility", () => {
  it("kasus sehat: layak, tanpa isu", () => {
    const r = analyzeFeasibility(base(), [req()]);
    expect(r.feasible).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.subtestSupply.find((s) => s.code === "PM")).toEqual({ subtestId: "pm", code: "PM", required: 2, competentTutors: 1, supplyCells: 4 });
  });

  it("subtes tanpa tutor kompeten", () => {
    const r = analyzeFeasibility(base({ tutors: [tutor("t1", ["pk"])] }), [req()]);
    expect(r.feasible).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(["NO_COMPETENT_TUTOR"]);
    expect(r.issues[0]!.message).toBe("R1 / PM: tidak ada tutor yang kompeten untuk PM.");
  });

  it("kapasitas tutor kompeten kurang dari kebutuhan subtes", () => {
    const s = base({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }])] });
    expect(codes(s, [req({ sessions: 2 })])).toContain("INSUFFICIENT_TUTOR_CAPACITY");
    expect(codes(s, [req({ sessions: 1 })])).not.toContain("INSUFFICIENT_TUTOR_CAPACITY");
  });

  it("sel di luar grid tidak dihitung", () => {
    const s = base({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }, { day: 6, slotNo: 9 }])] });
    expect(codes(s, [req({ sessions: 2 })])).toContain("INSUFFICIENT_TUTOR_CAPACITY");
  });

  it("item fleksibel memakai gabungan tutor semua subtes yang diperbolehkan", () => {
    const s = base({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }]), tutor("t2", ["pk"], [{ day: 1, slotNo: 2 }])] });
    const flex = req({ allowedSubtestIds: ["pm", "pk"], sessions: 2, label: "PM/PK Flexible" });
    expect(codes(s, [flex])).toEqual([]);
    expect(codes(s, [{ ...flex, sessions: 3 }])).toContain("INSUFFICIENT_TUTOR_CAPACITY");
  });

  it("total kebutuhan melebihi total sel tutor", () => {
    const s = base({ tutors: [tutor("t1", ["pm"], [{ day: 1, slotNo: 1 }])] });
    expect(codes(s, [req({ sessions: 1 }), req({ id: "x", allowedSubtestIds: ["pm"], sessions: 1 })])).toContain("TUTOR_CAPACITY_TOTAL");
  });

  it("rombel lebih besar dari ruangan terbesar, dan ruangan tetap kekecilan", () => {
    const s = base({ rombels: [rombel({ studentCount: 25 })] });
    expect(codes(s, [req()])).toContain("NO_ROOM_CAPACITY");
    const f = base({ rombels: [rombel({ studentCount: 10, fixedRoomId: "b" })] });
    const r = analyzeFeasibility(f, [req()]);
    expect(r.issues.map((i) => i.code)).toEqual(["FIXED_ROOM_TOO_SMALL"]);
    expect(r.issues[0]!.message).toBe("R1: ruangan tetap B (5) kurang dari 10 siswa.");
    expect(codes(base({ rombels: [rombel({ fixedRoomId: "hilang" })] }), [req()])).toEqual(["FIXED_ROOM_TOO_SMALL"]);
  });

  it("bottleneck ruangan: kelas besar melebihi slot ruangan yang muat", () => {
    // 1 ruangan muat >= 10 (A), 2 hari x 2 sesi = 4 slot; kebutuhan 5 sesi (3 rombel, beda tutor tak relevan di sini).
    const s = base({
      rombels: [rombel({ id: "r1" }), rombel({ id: "r2", name: "R2" })],
      tutors: [tutor("t1", ["pm"], cells([1, 2], [1, 2])), tutor("t2", ["pm"], cells([1, 2], [1, 2]))],
    });
    const r = analyzeFeasibility(s, [req({ sessions: 3 }), req({ id: "r2#0", rombelId: "r2", sessions: 2 })]);
    expect(r.issues.map((i) => i.code)).toEqual(["ROOM_CAPACITY_BOTTLENECK"]);
    expect(r.roomBottlenecks).toEqual([{ minSize: 10, requiredSessions: 5, roomCount: 1, roomSlots: 4 }]);
  });

  it("batas per hari: kebutuhan melebihi sesi/hari x hari", () => {
    const s = base({ rombels: [rombel({ sessionsPerDay: 1 })] });
    const r = analyzeFeasibility(s, [req({ sessions: 3 })]);
    expect(r.issues.map((i) => i.code)).toEqual(["ROMBEL_SLOT_CAPACITY"]);
    expect(r.issues[0]!.message).toBe("R1: butuh 3 sesi per minggu, tetapi batas 1/hari x 2 hari hanya 2.");
  });

  it("sesi per hari melebihi jumlah sesi aktif; sesi per hari belum diatur = peringatan saja", () => {
    expect(codes(base({ rombels: [rombel({ sessionsPerDay: 3 })] }), [req()])).toEqual(["SESSIONS_PER_DAY_EXCEEDS_SLOTS"]);
    const r = analyzeFeasibility(base({ rombels: [rombel({ sessionsPerDay: null })] }), [req()]);
    expect(r.feasible).toBe(true);
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([["SESSIONS_PER_DAY_MISSING", "warning"]]);
  });

  it("rombel tanpa kebutuhan tidak diperiksa", () => {
    const s = base({ rombels: [rombel({ studentCount: 999 })] });
    expect(analyzeFeasibility(s, []).issues).toEqual([]);
  });
});
