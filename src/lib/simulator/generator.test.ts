import { describe, expect, it } from "vitest";
import { expandRequirements, totalRequiredSessions } from "../scheduler/requirements";
import { generateScenario, scaleDistribution, SIMULATION_MODES } from "./generator";

describe("scaleDistribution", () => {
  it("total selalu tepat, baseline 12 -> 12 persis", () => {
    expect(scaleDistribution([1, 1, 1, 2, 3, 2, 1, 1], 12)).toEqual([1, 1, 1, 2, 3, 2, 1, 1]);
    for (const total of [1, 5, 6, 7, 24, 36, 100]) {
      expect(scaleDistribution([1, 1, 1, 2, 3, 2, 1, 1], total).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(scaleDistribution([1, 2], 0)).toEqual([0, 0]);
    expect(scaleDistribution([0, 0], 5)).toEqual([0, 0]);
  });
});

describe("generateScenario", () => {
  it("deterministik: mode dan seed sama = snapshot sama persis", () => {
    for (const mode of SIMULATION_MODES) {
      expect(generateScenario(mode, 11)).toEqual(generateScenario(mode, 11));
    }
    expect(generateScenario("small", 1).snapshot).not.toEqual(generateScenario("small", 2).snapshot);
  });

  it("ukuran bertingkat: small < realistic < stress", () => {
    const n = (m: "small" | "realistic" | "stress") => generateScenario(m, 5).snapshot;
    expect(n("small").rombels.length).toBe(3);
    expect(n("realistic").rombels.length).toBeGreaterThanOrEqual(14);
    expect(n("stress").rombels.length).toBeGreaterThan(n("realistic").rombels.length);
    expect(n("stress").tutors.length).toBeGreaterThan(n("realistic").tutors.length);
    expect(n("small").tutors.length).toBeLessThan(n("realistic").tutors.length);
  });

  it("realistic meniru struktur: 7 subtes, 15 ruangan, 8 sesi, 6 hari, semua 14 tipe kelas", () => {
    const s = generateScenario("realistic", 5).snapshot;
    expect(s.subtests.map((x) => x.code)).toEqual(["LBI", "LBE", "PU", "PPU", "KMM", "PM", "PK"]);
    expect(s.rooms).toHaveLength(15);
    expect(s.slotNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(s.rombels.map((r) => r.classTypeId)).size).toBe(14);
  });

  it("setiap subtes punya tutor kompeten; tutor valid", () => {
    for (const mode of SIMULATION_MODES) {
      const s = generateScenario(mode, 9).snapshot;
      for (const sub of s.subtests) {
        expect(s.tutors.filter((t) => t.competencies.includes(sub.id)).length).toBeGreaterThanOrEqual(2);
      }
      for (const t of s.tutors) {
        expect(t.level >= 0 && t.level <= 99).toBe(true);
        expect(new Set(t.competencies).size).toBe(t.competencies.length);
        for (const c of t.availability) {
          expect(s.days.includes(c.day) && s.slotNos.includes(c.slotNo)).toBe(true);
        }
      }
    }
  });

  it("distribusi: item fleksibel KMM/PPU, total = sesi per minggu bila tidak sengaja dibuat berbeda", () => {
    const s = generateScenario("realistic", 5).snapshot;
    const gap = s.rombels.filter((r) => r.name.startsWith("Gap Year Junior"));
    expect(gap.length).toBeGreaterThan(0);
    const exact = gap.find((r) => r.weeklySessions === 12)!;
    expect(exact.distribution!.reduce((n, i) => n + i.sessionsPerWeek, 0)).toBe(12);
    const flex = exact.distribution!.filter((i) => i.subtestId === null);
    expect(flex).toHaveLength(1);
    expect(flex[0]!.flexibleSubtestIds).toEqual(["sub-KMM", "sub-PPU"]);
    expect(s.subtests).toHaveLength(7); // fleksibel bukan subtes baru
  });

  it("sesi per hari mengikuti default master prompt", () => {
    const s = generateScenario("realistic", 5).snapshot;
    const perDay = (prefix: string) => s.rombels.find((r) => r.name.startsWith(prefix))!.sessionsPerDay;
    expect(perDay("Kelas 3 SMA General")).toBe(1);
    expect(perDay("Kelas 3 SMA Fast Track")).toBe(2);
    expect(perDay("Super Camp VVIP")).toBe(6);
    expect(perDay("Super Intensif VIP")).toBe(4);
    expect(perDay("Gap Year Platinum")).toBe(2);
  });

  it("small tidak punya discrepancy; ruangan tetap hanya yang muat", () => {
    const small = generateScenario("small", 3).snapshot;
    expect(expandRequirements(small.rombels).issues).toEqual([]);
    for (const mode of SIMULATION_MODES) {
      const s = generateScenario(mode, 3).snapshot;
      for (const r of s.rombels.filter((x) => x.fixedRoomId)) {
        expect(s.rooms.find((room) => room.id === r.fixedRoomId)!.capacity).toBeGreaterThanOrEqual(r.studentCount);
      }
    }
  });

  it("realistic/stress memuat discrepancy sengaja pada seed tertentu, dan kebutuhan tetap dari distribusi", () => {
    let found = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = generateScenario("stress", seed).snapshot;
      const { issues, requirements } = expandRequirements(s.rombels);
      found += issues.filter((i) => i.code === "DISTRIBUTION_MISMATCH").length;
      expect(totalRequiredSessions(requirements)).toBe(
        s.rombels.reduce((n, r) => n + r.distribution!.reduce((m, i) => m + i.sessionsPerWeek, 0), 0),
      );
    }
    expect(found).toBeGreaterThan(0);
  });
});
