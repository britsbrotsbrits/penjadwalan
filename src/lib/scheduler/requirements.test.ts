import { describe, expect, it } from "vitest";
import { expandRequirements, totalRequiredSessions } from "./requirements";
import type { SchedRombel } from "./types";

const rombel = (over: Partial<SchedRombel>): SchedRombel => ({
  id: "r1", name: "R1", classTypeId: "c1", studentCount: 10, fixedRoomId: null,
  sessionsPerDay: 2, weeklySessions: 3, distribution: null, ...over,
});

describe("expandRequirements", () => {
  it("distribusi tidak ada: tanpa kebutuhan, isu DISTRIBUTION_MISSING (tidak dikarang)", () => {
    const r = expandRequirements([rombel({})]);
    expect(r.requirements).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(["DISTRIBUTION_MISSING"]);
    expect(expandRequirements([rombel({ distribution: [] })]).issues.map((i) => i.code)).toEqual(["DISTRIBUTION_MISSING"]);
  });

  it("item biasa dan fleksibel menjadi kebutuhan; total cocok = tanpa isu", () => {
    const r = expandRequirements([
      rombel({
        weeklySessions: 4,
        distribution: [
          { subtestId: "pm", flexibleSubtestIds: [], label: null, sessionsPerWeek: 2 },
          { subtestId: null, flexibleSubtestIds: ["kmm", "ppu"], label: "KMM/PPU Flexible", sessionsPerWeek: 1 },
          { subtestId: "pk", flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 },
        ],
      }),
    ]);
    expect(r.issues).toEqual([]);
    expect(r.requirements).toEqual([
      { id: "r1#0", rombelId: "r1", allowedSubtestIds: ["pm"], label: "pm", sessions: 2 },
      { id: "r1#1", rombelId: "r1", allowedSubtestIds: ["kmm", "ppu"], label: "KMM/PPU Flexible", sessions: 1 },
      { id: "r1#2", rombelId: "r1", allowedSubtestIds: ["pk"], label: "pk", sessions: 1 },
    ]);
    expect(totalRequiredSessions(r.requirements)).toBe(4);
  });

  it("total berbeda: kebutuhan tetap dari distribusi, isu mismatch menyebut kedua angka (TBD-05)", () => {
    const r = expandRequirements([
      rombel({ weeklySessions: 6, distribution: [{ subtestId: "pm", flexibleSubtestIds: [], label: null, sessionsPerWeek: 2 }] }),
    ]);
    expect(totalRequiredSessions(r.requirements)).toBe(2);
    expect(r.issues).toEqual([
      {
        code: "DISTRIBUTION_MISMATCH",
        rombelId: "r1",
        message: "R1: total distribusi (2) tidak sama dengan total sesi per minggu (6). Tidak ada sesi tambahan yang dibuat.",
      },
    ]);
  });

  it("total sesi/minggu belum diatur: tidak ada isu mismatch", () => {
    const r = expandRequirements([
      rombel({ weeklySessions: null, distribution: [{ subtestId: "pm", flexibleSubtestIds: [], label: null, sessionsPerWeek: 2 }] }),
    ]);
    expect(r.issues).toEqual([]);
  });
});
