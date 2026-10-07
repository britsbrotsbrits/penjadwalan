import { describe, expect, it } from "vitest";
import type { ScheduledSession } from "../scheduler/types";
import { expandWeeklyPattern } from "./expand";

const s = (day: number, slotNo: number, rombelId = "r1"): ScheduledSession => ({
  requirementId: "q", rombelId, subtestId: "s", tutorId: "t", roomId: "k", day, slotNo,
});

describe("expandWeeklyPattern", () => {
  it("membuat pertemuan di setiap tanggal yang jatuh pada hari pola", () => {
    // 2 Nov 2026 = Senin; 2 minggu penuh.
    const out = expandWeeklyPattern([s(1, 1), s(3, 2)], "2026-11-02", "2026-11-15");
    expect(out.map((x) => `${x.sessionDate}#${x.slotNo}`)).toEqual([
      "2026-11-02#1", "2026-11-04#2", "2026-11-09#1", "2026-11-11#2",
    ]);
  });
  it("periode parsial hanya memuat tanggal di dalam rentang", () => {
    const out = expandWeeklyPattern([s(1, 1), s(5, 1)], "2026-11-04", "2026-11-10");
    expect(out.map((x) => x.sessionDate)).toEqual(["2026-11-06", "2026-11-09"]);
  });
  it("urutan deterministik: tanggal, sesi, rombel", () => {
    const out = expandWeeklyPattern([s(1, 2, "b"), s(1, 1, "z"), s(1, 1, "a")], "2026-11-02", "2026-11-02");
    expect(out.map((x) => `${x.slotNo}${x.rombelId}`)).toEqual(["1a", "1z", "2b"]);
  });
  it("jendela rombel membatasi tanggal sesi", () => {
    const windows = new Map([["r1", { start: "2026-11-09", end: null }]]);
    const out = expandWeeklyPattern([s(1, 1)], "2026-11-02", "2026-11-16", windows);
    expect(out.map((x) => x.sessionDate)).toEqual(["2026-11-09", "2026-11-16"]);
    const closed = new Map([["r1", { start: null, end: "2026-11-08" }]]);
    expect(expandWeeklyPattern([s(1, 1)], "2026-11-02", "2026-11-16", closed).map((x) => x.sessionDate)).toEqual(["2026-11-02"]);
  });
  it("pola kosong atau hari yang tidak ada = kosong", () => {
    expect(expandWeeklyPattern([], "2026-11-02", "2026-11-15")).toEqual([]);
    expect(expandWeeklyPattern([s(7, 1)], "2026-11-02", "2026-11-07")).toEqual([]);
  });
});
