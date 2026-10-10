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
  it("siklus 3 minggu: hanya minggu ke-0, 3, 6 dari jangkar yang berisi sesi", () => {
    const pat = [s(2, 4), s(3, 4), s(5, 4)]; // Selasa, Rabu, Jumat
    const w = new Map([["r1", { start: null, end: null, cycleWeeks: 3, cycleAnchor: "2026-11-04" }]]);
    // jangkar 4 Nov (Rabu) -> minggu 2 Nov; 9 minggu sampai 3 Jan
    const out = expandWeeklyPattern(pat, "2026-11-02", "2027-01-03", w);
    const weeks = [...new Set(out.map((x) => x.sessionDate.slice(0, 10)))];
    expect(weeks).toEqual(["2026-11-03", "2026-11-04", "2026-11-06", "2026-11-24", "2026-11-25", "2026-11-27", "2026-12-15", "2026-12-16", "2026-12-18"]);
  });
  it("siklus tanpa jangkar mengikuti minggu pertama periode; jangkar bergeser mengubah minggu aktif", () => {
    const pat = [s(2, 4)];
    const noAnchor = new Map([["r1", { start: null, end: null, cycleWeeks: 3, cycleAnchor: null }]]);
    expect(expandWeeklyPattern(pat, "2026-11-02", "2026-11-30", noAnchor).map((x) => x.sessionDate)).toEqual(["2026-11-03", "2026-11-24"]);
    const shifted = new Map([["r1", { start: null, end: null, cycleWeeks: 3, cycleAnchor: "2026-11-09" }]]);
    expect(expandWeeklyPattern(pat, "2026-11-02", "2026-11-30", shifted).map((x) => x.sessionDate)).toEqual(["2026-11-10", "2026-12-01"].filter((d) => d <= "2026-11-30"));
  });
  it("jangkar setelah awal periode: minggu sebelum jangkar tetap mengikuti siklus (mundur)", () => {
    const pat = [s(2, 4)];
    const w = new Map([["r1", { start: null, end: null, cycleWeeks: 3, cycleAnchor: "2026-11-23" }]]);
    expect(expandWeeklyPattern(pat, "2026-11-02", "2026-11-30", w).map((x) => x.sessionDate)).toEqual(["2026-11-03", "2026-11-24"]);
  });
  it("siklus 1 atau tidak diisi = tiap minggu; siklus bekerja bersama jendela tanggal rombel", () => {
    const pat = [s(1, 1)];
    const one = new Map([["r1", { start: null, end: null, cycleWeeks: 1 }]]);
    expect(expandWeeklyPattern(pat, "2026-11-02", "2026-11-16", one)).toHaveLength(3);
    const both = new Map([["r1", { start: "2026-11-09", end: null, cycleWeeks: 2, cycleAnchor: "2026-11-02" }]]);
    expect(expandWeeklyPattern(pat, "2026-11-02", "2026-11-30", both).map((x) => x.sessionDate)).toEqual(["2026-11-16", "2026-11-30"]);
  });
});
