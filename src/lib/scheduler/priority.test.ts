import { describe, expect, it } from "vitest";
import { computeQuota, sessionValue } from "./priority";
import { expandRequirements } from "./requirements";
import { scheduler } from "./solve";
import type { SchedRombel, SchedTutor, SchedulingSnapshot } from "./types";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5];
const allCells = DAYS.flatMap((day) => SLOTS.map((slotNo) => ({ day, slotNo })));
// Mentor dengan n sel tercentang: sel diambil merata lintas hari dan sesi (n <= 25).
const checked = (n: number) => {
  const order = SLOTS.flatMap((slotNo) => DAYS.map((day) => ({ day, slotNo })));
  return order.slice(0, n);
};
const subtests = [{ id: "ppu", code: "PPU" }, { id: "kmm", code: "KMM" }];
const tutor = (id: string, level: number, n: number): SchedTutor => ({ id, name: id, level, competencies: ["ppu", "kmm"], availability: n === 25 ? allCells : checked(n) });
const rombel = (id: string, slot: number): SchedRombel => ({
  id, name: id, classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 1, weeklySessions: null,
  distribution: [{ subtestId: "ppu", flexibleSubtestIds: [], label: null, sessionsPerWeek: 5 }],
  pattern: { subtestSlots: [slot], drillingSlots: [] },
});

// Lima mentor PPU/KMM: level 20..99 dengan centang 25, 25, 20, 15, 10 (kuota 5, 10, 12, 12, 10 -> lihat computeQuota).
const TUTORS = [tutor("L20", 20, 25), tutor("L40", 40, 25), tutor("L60", 60, 20), tutor("L80", 80, 15), tutor("L99", 99, 10)];
const run = (rombelCount: number, seed = 1) => {
  const rombels = Array.from({ length: rombelCount }, (_, i) => rombel(`r${i}`, (i % 5) + 1));
  const snapshot: SchedulingSnapshot = {
    days: DAYS, slotNos: SLOTS, subtests,
    rooms: Array.from({ length: 12 }, (_, i) => ({ id: `room${i}`, name: `R${i}`, capacity: 40 })),
    rombels, tutors: TUTORS,
  };
  const { requirements } = expandRequirements(snapshot.rombels, snapshot.days);
  const result = scheduler({ snapshot, requirements, seed });
  const count = new Map(TUTORS.map((t) => [t.id, 0]));
  for (const s of result.scheduled) count.set(s.tutorId, (count.get(s.tutorId) ?? 0) + 1);
  return { result, count };
};

describe("computeQuota", () => {
  it("jatah dasar 20% dari centang (dibulatkan ke atas); kuota = centang x level / 100", () => {
    expect(computeQuota(30, 20)).toEqual({ floor: 6, quota: 6, level: 20 });
    expect(computeQuota(10, 99)).toEqual({ floor: 2, quota: 10, level: 99 });
    expect(computeQuota(20, 60)).toEqual({ floor: 4, quota: 12, level: 60 });
    expect(computeQuota(25, 40)).toEqual({ floor: 5, quota: 10, level: 40 });
  });
  it("level 0 diperlakukan seperti jatah dasar saja (tidak nol sesi)", () => {
    expect(computeQuota(20, 0)).toEqual({ floor: 4, quota: 4, level: 0 });
  });
  it("nilai sesi: jatah dasar > kuota (level tinggi lebih besar) > melewati kuota; selalu menurun", () => {
    const hi = computeQuota(20, 99);
    const lo = computeQuota(20, 20);
    expect(sessionValue(lo, 0)).toBeGreaterThan(sessionValue(hi, hi.floor));
    expect(sessionValue(hi, hi.floor)).toBeGreaterThan(sessionValue(lo, lo.quota));
    expect(sessionValue(hi, hi.floor)).toBeGreaterThan(sessionValue(computeQuota(20, 60), computeQuota(20, 60).floor));
    for (const q of [hi, lo]) for (let n = 0; n < 30; n++) expect(sessionValue(q, n)).toBeGreaterThan(sessionValue(q, n + 1));
  });
});

const excess = (count: Map<string, number>) =>
  TUTORS.map((t) => (count.get(t.id) ?? 0) - computeQuota(t.availability.length, t.level).floor);

describe("prioritas level pada pembagian sesi", () => {
  it("kebutuhan sedang (30 sesi): semua mentor dapat jatah dasar, kelebihan mengalir ke level tinggi lebih dulu", () => {
    for (const seed of [1, 2, 3]) {
      const { count, result } = run(6, seed);
      expect(result.unscheduled).toEqual([]);
      const ex = excess(count); // urut level 20, 40, 60, 80, 99
      for (const e of ex) expect(e).toBeGreaterThanOrEqual(0);
      // Kelebihan di atas jatah dasar tidak pernah lebih besar pada level yang lebih rendah.
      for (let i = 1; i < ex.length; i++) expect(ex[i]!).toBeGreaterThanOrEqual(ex[i - 1]!);
      expect(count.get("L99")!).toBeGreaterThanOrEqual(9);
    }
  });
  it("kebutuhan kecil (15 sesi, kurang dari total jatah dasar): tidak ada yang melewati jatah dasarnya dan semua kebagian", () => {
    const { count, result } = run(3);
    expect(result.unscheduled).toEqual([]);
    for (const t of TUTORS) {
      const v = count.get(t.id)!;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(computeQuota(t.availability.length, t.level).floor);
    }
  });
  it("kebutuhan sama dengan total kuota (50 sesi): level rendah tetap pada jatah dasarnya dan semuanya terjadwal", () => {
    const { result, count } = run(10);
    expect(result.unscheduled).toEqual([]);
    expect(count.get("L20")!).toBe(5);
    expect(count.get("L99")!).toBe(10);
  });
});
