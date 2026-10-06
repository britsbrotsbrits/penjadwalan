import { describe, expect, it } from "vitest";
import type { Requirement, ScheduledSession, SchedulerResult, SchedulingSnapshot } from "../scheduler/types";
import { evaluateSchedule } from "./metrics";

const cells = (days: number[], slots: number[]) => days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo })));
const snapshot: SchedulingSnapshot = {
  days: [1, 2],
  slotNos: [1, 2, 3],
  subtests: [{ id: "pm", code: "PM" }, { id: "pk", code: "PK" }],
  rooms: [{ id: "big", name: "Big", capacity: 20 }, { id: "small", name: "Small", capacity: 3 }],
  rombels: [
    { id: "r1", name: "R1", classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 2, weeklySessions: 3, distribution: null },
    { id: "r2", name: "R2", classTypeId: "c", studentCount: 10, fixedRoomId: "big", sessionsPerDay: 1, weeklySessions: 1, distribution: null },
  ],
  tutors: [
    { id: "t1", name: "T1", level: 10, competencies: ["pm", "pk"], availability: cells([1, 2], [1, 2, 3]) },
    { id: "t2", name: "T2", level: 20, competencies: ["pm"], availability: cells([1], [1]) },
    { id: "t3", name: "T3", level: 30, competencies: ["pk"], availability: [] },
  ],
};
const requirements: Requirement[] = [
  { id: "r1#0", rombelId: "r1", allowedSubtestIds: ["pm"], label: "PM", sessions: 2 },
  { id: "r1#1", rombelId: "r1", allowedSubtestIds: ["pm", "pk"], label: "Flex", sessions: 1 },
  { id: "r2#0", rombelId: "r2", allowedSubtestIds: ["pk"], label: "PK", sessions: 1 },
];
const s = (over: Partial<ScheduledSession>): ScheduledSession => ({
  requirementId: "r1#0", rombelId: "r1", subtestId: "pm", tutorId: "t1", roomId: "big", day: 1, slotNo: 1, ...over,
});
const codes = (scheduled: ScheduledSession[], unscheduled: SchedulerResult["unscheduled"] = []) =>
  evaluateSchedule(snapshot, requirements, { scheduled, unscheduled }).violations.map((v) => v.code);

const clean: ScheduledSession[] = [
  s({ day: 1, slotNo: 1 }),
  s({ day: 2, slotNo: 1 }),
  s({ requirementId: "r1#1", subtestId: "pk", day: 2, slotNo: 2 }),
  s({ requirementId: "r2#0", rombelId: "r2", subtestId: "pk", day: 1, slotNo: 2 }),
];

describe("evaluateSchedule", () => {
  it("jadwal bersih: tanpa pelanggaran, 100% selesai", () => {
    const r = evaluateSchedule(snapshot, requirements, { scheduled: clean, unscheduled: [] });
    expect(r.violations).toEqual([]);
    expect(r.required).toBe(4);
    expect(r.scheduled).toBe(4);
    expect(r.completionPercent).toBe(100);
    expect(r.unscheduledSessions).toBe(0);
  });

  it("tanpa kebutuhan = 100%", () => {
    expect(evaluateSchedule(snapshot, [], { scheduled: [], unscheduled: [] }).completionPercent).toBe(100);
  });

  it("belum terjadwal dengan alasan: persentase dan pembukuan benar", () => {
    const r = evaluateSchedule(snapshot, requirements, {
      scheduled: clean.slice(0, 2),
      unscheduled: [
        { requirementId: "r1#1", missing: 1, reason: "NO_FREE_ROOM" },
        { requirementId: "r2#0", missing: 1, reason: "NO_AVAILABLE_TUTOR_SLOT" },
      ],
    });
    expect(r.violations).toEqual([]);
    expect(r.completionPercent).toBe(50);
    expect(r.unscheduledByReason).toEqual({ NO_FREE_ROOM: 1, NO_AVAILABLE_TUTOR_SLOT: 1 });
  });

  it("mendeteksi bentrok tutor, ruangan, dan rombel", () => {
    const tutorClash = [s({ day: 1, slotNo: 1 }), s({ requirementId: "r2#0", rombelId: "r2", subtestId: "pm", day: 1, slotNo: 1, roomId: "big" })];
    expect(codes(tutorClash, [{ requirementId: "r1#0", missing: 1, reason: "NO_FREE_ROOM" }])).toContain("TUTOR_CONFLICT");
    const roomClash = [s({ day: 1, slotNo: 1 }), s({ requirementId: "r1#1", subtestId: "pk", tutorId: "t2", day: 1, slotNo: 1 })];
    expect(codes(roomClash)).toContain("ROOM_CONFLICT");
    const rombelClash = [s({ day: 1, slotNo: 1 }), s({ requirementId: "r1#1", subtestId: "pm", tutorId: "t2", roomId: "small", day: 1, slotNo: 1 })];
    expect(codes(rombelClash)).toContain("ROMBEL_CONFLICT");
  });

  it("mendeteksi kapasitas, kompetensi, availability", () => {
    expect(codes([s({ roomId: "small" })])).toContain("CAPACITY_VIOLATION");
    expect(codes([s({ tutorId: "t2", subtestId: "pk" })])).toContain("COMPETENCY_VIOLATION"); // t2 tidak kompeten PK
    expect(codes([s({ requirementId: "r2#0", rombelId: "r2", subtestId: "pm", tutorId: "t1", day: 1, slotNo: 2 })])).toContain("COMPETENCY_VIOLATION"); // di luar item yang diizinkan
    expect(codes([s({ tutorId: "t2", day: 2, slotNo: 2 })])).toContain("AVAILABILITY_VIOLATION");
    expect(codes([s({ tutorId: "t3", subtestId: "pk", requirementId: "r1#1" })])).toContain("AVAILABILITY_VIOLATION");
  });

  it("mendeteksi batas harian dan ruangan tetap", () => {
    const three = [1, 2, 3].map((slotNo) => s({ slotNo, requirementId: slotNo === 3 ? "r1#1" : "r1#0", subtestId: "pm" }));
    expect(codes(three)).toContain("DAILY_LIMIT_VIOLATION");
    expect(codes([s({ requirementId: "r2#0", rombelId: "r2", subtestId: "pk", roomId: "small" })])).toContain("FIXED_ROOM_VIOLATION");
  });

  it("referensi tidak valid: id tak dikenal, di luar grid, rombel tak cocok dengan kebutuhan", () => {
    expect(codes([s({ tutorId: "x" })])).toContain("INVALID_REFERENCE");
    expect(codes([s({ roomId: "x" })])).toContain("INVALID_REFERENCE");
    expect(codes([s({ requirementId: "x" })])).toContain("INVALID_REFERENCE");
    expect(codes([s({ day: 9 })])).toContain("INVALID_REFERENCE");
    expect(codes([s({ slotNo: 9 })])).toContain("INVALID_REFERENCE");
    expect(codes([s({ rombelId: "r2" })])).toContain("INVALID_REFERENCE");
    expect(codes([], [{ requirementId: "zzz", missing: 1, reason: "NO_FREE_ROOM" }])).toContain("INVALID_REFERENCE");
  });

  it("pembukuan: kelebihan jadwal dan sesi hilang tanpa dilaporkan terdeteksi", () => {
    const over = [s({ day: 1, slotNo: 1 }), s({ day: 2, slotNo: 1 }), s({ day: 2, slotNo: 2, tutorId: "t1" })];
    expect(codes(over)).toContain("OVER_SCHEDULED");
    // butuh 4, hanya 1 terjadwal dan tidak ada yang dilaporkan belum terjadwal
    expect(codes([s({})])).toContain("ACCOUNTING_MISMATCH");
  });

  it("hitungan pelanggaran per kode konsisten dengan daftar", () => {
    const r = evaluateSchedule(snapshot, requirements, { scheduled: [s({ roomId: "small" })], unscheduled: [] });
    expect(r.violationCounts.CAPACITY_VIOLATION).toBe(1);
    expect(r.violationCounts.TUTOR_CONFLICT).toBe(0);
    expect(Object.values(r.violationCounts).reduce((a, b) => a + b, 0)).toBe(r.violations.length);
  });

  it("beban kerja: termasuk tutor tanpa sesi", () => {
    const w = evaluateSchedule(snapshot, requirements, { scheduled: clean, unscheduled: [] }).workload;
    expect(w.tutors).toBe(3);
    expect(w.active).toBe(1);
    expect(w.idle).toBe(2);
    expect(w.max).toBe(4);
    expect(w.min).toBe(0);
    expect(w.mean).toBe(1.33);
    expect(w.busiest[0]).toEqual({ tutorId: "t1", name: "T1", sessions: 4 });
  });

  it("permintaan tutor belum dimodelkan dinyatakan terang", () => {
    expect(evaluateSchedule(snapshot, requirements, { scheduled: [], unscheduled: [] }).unmetRequests).toEqual({ modeled: false, count: 0 });
  });
});
