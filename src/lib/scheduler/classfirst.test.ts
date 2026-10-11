import { describe, expect, it } from "vitest";
import { resolvePattern, describePattern } from "../config/pattern";
import { evaluateSchedule } from "../simulator/metrics";
import { expandRequirements } from "./requirements";
import { searchPlacement, DEFAULT_WEIGHTS } from "./candidates";
import { buildContext, ScheduleState } from "./state";
import { createScheduler, scheduler } from "./solve";
import { buildSnapshot, type SnapshotInput } from "./snapshot";
import type { SchedRombel, SchedTutor, SchedulingSnapshot } from "./types";

const DAYS = [1, 2, 3, 4, 5];
const cells = (days: number[], slots: number[]) => days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo })));
const tutor = (id: string, comp: string[], av = cells(DAYS, [1, 2, 3, 4, 5])): SchedTutor => ({ id, name: id, level: 1, competencies: comp, availability: av });
const SUBS = ["PK", "PU", "PM", "PPU", "KMM", "LBI", "LBE"];
const subtests = SUBS.map((c) => ({ id: c.toLowerCase(), code: c }));
const allComp = SUBS.map((c) => c.toLowerCase());

const rombel = (id: string, slots: number[], dist: SchedRombel["distribution"], over: Partial<SchedRombel> = {}): SchedRombel => ({
  id, name: id, classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: slots.length, weeklySessions: null,
  distribution: dist, pattern: { subtestSlots: slots, drillingSlots: [] }, ...over,
});
const item = (code: string, n = 1) => ({ subtestId: code.toLowerCase(), flexibleSubtestIds: [], label: null, sessionsPerWeek: n });
const flex = (a: string, b: string, n = 1) => ({ subtestId: null, flexibleSubtestIds: [a.toLowerCase(), b.toLowerCase()], label: `${a}/${b} Flexible`, sessionsPerWeek: n });

const snap = (rombels: SchedRombel[], tutors: SchedTutor[], over: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot => ({
  days: DAYS, slotNos: [1, 2, 3, 4, 5], subtests,
  rooms: Array.from({ length: 12 }, (_, i) => ({ id: `room${i}`, name: `R${i}`, capacity: 40 })),
  rombels, tutors, ...over,
});
const go = (s: SchedulingSnapshot, seed = 1, frozen?: Parameters<typeof scheduler>[0]["frozen"]) => {
  const { requirements, issues } = expandRequirements(s.rombels, s.days);
  const result = scheduler({ snapshot: s, requirements, seed, frozen });
  return { requirements, issues, result, report: evaluateSchedule(s, requirements, result) };
};

describe("SMA: satu rombel = satu sesi tetap", () => {
  const dist = [item("PK"), item("PU"), item("PM"), item("PPU"), item("KMM")];
  const rombels = [rombel("gA", [4], dist), rombel("gB", [4], dist), rombel("vC", [5], dist)];
  const tutors = Array.from({ length: 8 }, (_, i) => tutor(`t${i}`, allComp));

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: sesi konstan Senin-Jumat, lima hari, distribusi utuh, tanpa pelanggaran`, () => {
      const { result, report, issues } = go(snap(rombels, tutors), seed);
      expect(issues).toEqual([]);
      expect(report.violations).toEqual([]);
      expect(result.unscheduled).toEqual([]);
      for (const r of rombels) {
        const mine = result.scheduled.filter((s) => s.rombelId === r.id);
        expect(mine).toHaveLength(5);
        expect(new Set(mine.map((s) => s.slotNo))).toEqual(new Set(r.pattern!.subtestSlots));
        expect(new Set(mine.map((s) => s.day))).toEqual(new Set(DAYS));
        expect(mine.map((s) => s.subtestId).sort()).toEqual(["kmm", "pk", "pm", "ppu", "pu"]);
      }
    });
  }

  it("tidak pernah memakai sesi 1-3 untuk SMA walau mentor hanya tersedia di sana", () => {
    const early = tutors.map((t) => ({ ...t, availability: cells(DAYS, [1, 2, 3]) }));
    const { result } = go(snap(rombels, early));
    expect(result.scheduled).toEqual([]);
    expect(result.unscheduled.length).toBeGreaterThan(0);
  });
});

describe("Gap Year: SUBTEST / DRILLING / SUBTEST", () => {
  const dist = [item("PK"), item("PU"), item("PM"), item("PPU"), item("KMM"), item("LBI"), item("LBE"), flex("PK", "PM"), flex("KMM", "PPU"), flex("LBI", "PU")];
  const gy = (id: string) => rombel(id, [1, 3], dist, { pattern: { subtestSlots: [1, 3], drillingSlots: [2] } });
  const tutors = Array.from({ length: 10 }, (_, i) => tutor(`t${i}`, allComp));

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: dua sesi subtes per hari, sesi 2 kosong, semua distribusi terpenuhi`, () => {
      const { result, report, requirements } = go(snap([gy("jA"), gy("gold")], tutors), seed);
      expect(report.violations).toEqual([]);
      expect(result.unscheduled).toEqual([]);
      expect(result.scheduled.some((s) => s.slotNo === 2)).toBe(false);
      for (const id of ["jA", "gold"]) {
        const mine = result.scheduled.filter((s) => s.rombelId === id);
        expect(mine).toHaveLength(10);
        for (const day of DAYS) expect(mine.filter((s) => s.day === day)).toHaveLength(2);
        for (const req of requirements.filter((r) => r.rombelId === id)) {
          expect(mine.filter((s) => s.requirementId === req.id)).toHaveLength(req.sessions);
        }
        // subtes biasa tidak muncul dua kali pada hari yang sama
        for (const day of DAYS) {
          const reqs = mine.filter((s) => s.day === day).map((s) => s.requirementId);
          expect(new Set(reqs).size).toBe(reqs.length);
        }
      }
    });
  }

  it("item fleksibel tetap satu kebutuhan dengan subtes dari daftar yang diizinkan", () => {
    const { result, requirements } = go(snap([gy("jA")], tutors));
    const fl = requirements.find((r) => r.allowedSubtestIds.length === 2 && r.allowedSubtestIds.includes("pk"))!;
    const placed = result.scheduled.filter((s) => s.requirementId === fl.id);
    expect(placed).toHaveLength(1);
    expect(fl.allowedSubtestIds).toContain(placed[0]!.subtestId);
  });
});

describe("distribusi lebih penting daripada availability mentor", () => {
  it("mentor langka: sel kelas ditukar di dalam rombel, distribusi tetap utuh (semua seed)", () => {
    // 4 sel (hari 1-2 x sesi 1,3); KMM hanya bisa diajar t1 yang hanya tersedia di (2,3).
    const r = rombel("gy", [1, 3], [item("PK"), item("PU"), item("PM"), item("KMM")], { sessionsPerDay: 2 });
    const t1 = tutor("t1", ["kmm"], [{ day: 2, slotNo: 3 }]);
    const t2 = tutor("t2", ["pk", "pu", "pm"], cells([1, 2], [1, 3]));
    for (let seed = 1; seed <= 12; seed++) {
      const { result, report } = go(snap([r], [t1, t2], { days: [1, 2] }), seed);
      expect(report.violations).toEqual([]);
      expect(result.unscheduled).toEqual([]);
      const kmm = result.scheduled.find((s) => s.subtestId === "kmm")!;
      expect([kmm.day, kmm.slotNo]).toEqual([2, 3]);
    }
  });

  it("mentor penghalang diganti mentor lain supaya kebutuhan kelas tetap masuk", () => {
    // Satu sel; dua rombel di sesi yang sama; t1 kompeten PK dan PU, t2 hanya PU. Keduanya harus terjadwal.
    const rA = rombel("a", [1], [item("PU")], { sessionsPerDay: 1 });
    const rB = rombel("b", [1], [item("PK")], { sessionsPerDay: 1 });
    const t1 = tutor("t1", ["pk", "pu"], cells([1], [1]));
    const t2 = tutor("t2", ["pu"], cells([1], [1]));
    for (let seed = 1; seed <= 6; seed++) {
      const { result } = go(snap([rA, rB], [t1, t2], { days: [1] }), seed);
      expect(result.unscheduled).toEqual([]);
      expect(result.scheduled).toHaveLength(2);
    }
  });

  it("tidak ada mentor sama sekali: tetap dilaporkan, kelas tidak dipindah sembarangan", () => {
    const r = rombel("gy", [1, 3], [item("PK")], { sessionsPerDay: 2 });
    const { result } = go(snap([r], [tutor("t", ["pu"])], { days: [1] }));
    expect(result.scheduled).toEqual([]);
    expect(result.unscheduled[0]!.reason).toBe("NO_COMPETENT_TUTOR");
    expect(result.unscheduled[0]!.missing).toBe(1);
  });
});

describe("kelebihan distribusi dan sel pola", () => {
  it("distribusi lebih besar dari sel pola: kelebihan dilaporkan NO_ROMBEL_SLOT, sisanya utuh", () => {
    const r = rombel("gy", [1, 3], [item("PK"), item("PU"), item("PM")], { sessionsPerDay: 2 });
    const { result, issues } = go(snap([r], [tutor("t1", allComp), tutor("t2", allComp)], { days: [1] }));
    expect(issues.map((i) => i.code)).toContain("PATTERN_MISMATCH");
    expect(result.scheduled).toHaveLength(2);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]!.reason).toBe("NO_ROMBEL_SLOT");
    expect(result.unscheduled[0]!.missing).toBe(1);
  });

  it("distribusi lebih kecil dari sel: tidak ada sesi karangan, sel dibiarkan kosong", () => {
    const r = rombel("gy", [1, 3], [item("PK")], { sessionsPerDay: 2 });
    const { result, issues } = go(snap([r], [tutor("t1", allComp)]));
    expect(result.scheduled).toHaveLength(1);
    expect(issues.some((i) => i.code === "PATTERN_MISMATCH")).toBe(true);
  });
});

describe("jadwal mentor berurutan", () => {
  it("sesi 1, 2, 3 pada satu hari dibagi tanpa jeda kosong bila memungkinkan", () => {
    const rs = [rombel("a", [1], [item("PK")], { sessionsPerDay: 1 }), rombel("b", [3], [item("PU")], { sessionsPerDay: 1 }), rombel("c", [2], [item("PM")], { sessionsPerDay: 1 })];
    const ts = [tutor("t1", allComp, cells([1], [1, 2, 3])), tutor("t2", allComp, cells([1], [1, 2, 3]))];
    for (let seed = 1; seed <= 10; seed++) {
      const { result } = go(snap(rs, ts, { days: [1] }), seed);
      expect(result.unscheduled).toEqual([]);
      const byTutor = new Map<string, number[]>();
      for (const s of result.scheduled) byTutor.set(s.tutorId, [...(byTutor.get(s.tutorId) ?? []), s.slotNo]);
      for (const slots of byTutor.values()) {
        slots.sort();
        expect(slots[slots.length - 1]! - slots[0]! + 1).toBe(slots.length);
      }
    }
  });
});

describe("rombel tanpa pola dan sesi beku", () => {
  it("rombel tanpa pola tetap dijadwalkan dengan cara lama", () => {
    const old: SchedRombel = { id: "old", name: "old", classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 1, weeklySessions: null, distribution: [item("PK", 3)] };
    const { result, report } = go(snap([old], [tutor("t", allComp)]));
    expect(report.violations).toEqual([]);
    expect(result.scheduled).toHaveLength(3);
  });

  it("sesi beku menutup selnya; sesi baru memakai sel pola yang lain dan hasil tidak memuat sesi beku", () => {
    const r = rombel("sma", [4], [item("PK"), item("PU"), item("PM")], { sessionsPerDay: 1 });
    const frozen = [{ requirementId: "x", rombelId: "sma", subtestId: "pk", tutorId: "t0", roomId: "room0", day: 1, slotNo: 4 }];
    const { result } = go(snap([r], [tutor("t0", allComp), tutor("t1", allComp)]), 1, frozen);
    expect(result.scheduled).toHaveLength(3);
    expect(result.scheduled.every((s) => s.slotNo === 4 && s.day !== 1)).toBe(true);
    expect(new Set(result.scheduled.map((s) => s.day)).size).toBe(3);
  });
});

describe("snapshot: pola, hari tryout", () => {
  const input = (): SnapshotInput => ({
    days: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isActive: true, isTryout: d === 6 })),
    slots: [1, 2, 3, 4, 5].map((n) => ({ slotNo: n, isActive: n !== 5 })),
    subtests: [{ id: "s1", code: "PM", isActive: true }],
    rooms: [{ id: "k", name: "A", capacity: 30, isActive: true }],
    programs: [{ id: "p" }],
    classTypes: [{ id: "gy", programId: "p", defaultSize: 10 }, { id: "sma", programId: "p", defaultSize: 10 }],
    rombels: [
      { id: "r1", name: "Gold A", classTypeId: "gy", fixedRoomId: null, isActive: true },
      { id: "r2", name: "General A", classTypeId: "sma", fixedRoomId: null, isActive: true },
      { id: "r3", name: "General Z", classTypeId: "sma", fixedRoomId: null, isActive: true },
    ],
    activeStudents: [],
    tutors: [],
    competencies: [],
    availability: [],
    settings: [{ key: "sessions_per_day", scopeType: "class_type", scopeId: "gy", dayOfWeek: null, value: 9 }],
    distribution: [],
    patterns: [
      { scopeType: "class_type", scopeId: "gy", slotNo: 1, kind: "SUBTEST" },
      { scopeType: "class_type", scopeId: "gy", slotNo: 2, kind: "DRILLING" },
      { scopeType: "class_type", scopeId: "gy", slotNo: 3, kind: "SUBTEST" },
      { scopeType: "class_type", scopeId: "sma", slotNo: 5, kind: "SUBTEST" }, // sesi 5 nonaktif -> diabaikan
      { scopeType: "rombel", scopeId: "r2", slotNo: 4, kind: "SUBTEST" },
    ],
  });
  const { snapshot, issues } = buildSnapshot(input());
  const byId = new Map(snapshot.rombels.map((r) => [r.id, r]));

  it("hari tryout keluar dari hari belajar tetapi tercatat", () => {
    expect(snapshot.days).toEqual([1, 2, 3, 4, 5]);
    expect(snapshot.tryoutDays).toEqual([6]);
  });
  it("pola Gap Year: dua sesi subtes, drilling dicatat; sesi per hari mengikuti pola, bukan konfigurasi lama", () => {
    expect(byId.get("r1")!.pattern).toEqual({ subtestSlots: [1, 3], drillingSlots: [2] });
    expect(byId.get("r1")!.sessionsPerDay).toBe(2);
  });
  it("pola rombel mengalahkan pola tipe kelas; pola tanpa sesi aktif diabaikan dengan catatan", () => {
    expect(byId.get("r2")!.pattern).toEqual({ subtestSlots: [4], drillingSlots: [] });
    expect(byId.get("r3")!.pattern).toBeNull();
    expect(issues.some((i) => i.rombelId === "r3" && i.code === "CONFIG_INVALID")).toBe(true);
  });
});

describe("resolvePattern", () => {
  const items = [
    { scopeType: "class_type" as const, scopeId: "c", slotNo: 3, kind: "SUBTEST" as const },
    { scopeType: "class_type" as const, scopeId: "c", slotNo: 1, kind: "SUBTEST" as const },
    { scopeType: "class_type" as const, scopeId: "c", slotNo: 2, kind: "DRILLING" as const },
    { scopeType: "rombel" as const, scopeId: "r", slotNo: 5, kind: "SUBTEST" as const },
  ];
  it("terdekat menang sebagai satu kesatuan; urut sesi", () => {
    const r = resolvePattern(items, { rombelId: "r", classTypeId: "c" });
    expect(r.status === "found" && r.subtestSlots).toEqual([5]);
    const c = resolvePattern(items, { rombelId: "x", classTypeId: "c" });
    expect(c.status === "found" && c.subtestSlots).toEqual([1, 3]);
    expect(c.status === "found" && c.drillingSlots).toEqual([2]);
    expect(resolvePattern(items, { rombelId: "x", classTypeId: "z" }).status).toBe("missing");
  });
  it("describePattern", () => {
    expect(describePattern([{ slotNo: 3, kind: "SUBTEST" }, { slotNo: 2, kind: "DRILLING" }])).toBe("2 Drilling · 3 Subtes");
  });
});

describe("perbaikan dan optimasi (mutasi yang harus tertangkap)", () => {
  it("tiga rombel di sel yang sama dengan mentor saling tumpang tindih: semua terjadwal (ganti mentor penghalang)", () => {
    const ra = rombel("a", [1], [item("PU")], { sessionsPerDay: 1 });
    const rb = rombel("b", [1], [item("PM")], { sessionsPerDay: 1 });
    const rc = rombel("c", [1], [item("PK")], { sessionsPerDay: 1 });
    const av = cells([1], [1]);
    const ts = [tutor("t1", ["pu", "pk"], av), tutor("t2", ["pu", "pm"], av), tutor("t3", ["pm", "pk"], av)];
    for (let seed = 1; seed <= 40; seed++) {
      const { result, report } = go(snap([ra, rb, rc], ts, { days: [1] }), seed);
      expect(report.violations).toEqual([]);
      expect(result.unscheduled).toEqual([]);
    }
  });

  it("optimasi berurutan bekerja sendiri walau pemilihan awal mengabaikan jeda (bobot gap = 0)", () => {
    const rs = [1, 2, 3, 4].map((n) => rombel(`r${n}`, [n], [item(SUBS[n]!)], { sessionsPerDay: 1 }));
    const ts = [tutor("t1", allComp, cells([1], [1, 2, 3, 4])), tutor("t2", allComp, cells([1], [1, 2, 3, 4]))];
    const s = snap(rs, ts, { days: [1] });
    const { requirements } = expandRequirements(s.rombels, s.days);
    let gapsSeen = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const result = createScheduler({ weights: { gap: 0 } })({ snapshot: s, requirements, seed });
      expect(result.unscheduled).toEqual([]);
      const byTutor = new Map<string, number[]>();
      for (const x of result.scheduled) byTutor.set(x.tutorId, [...(byTutor.get(x.tutorId) ?? []), x.slotNo]);
      for (const slots of byTutor.values()) {
        slots.sort();
        gapsSeen += slots[slots.length - 1]! - slots[0]! + 1 - slots.length;
      }
    }
    expect(gapsSeen).toBe(0);
  });

  it("distribusi lebih kecil dari sel: sesi tersebar ke semua hari, bukan menumpuk di awal minggu", () => {
    const r = rombel("gy", [1, 3], [item("PK"), item("PU"), item("PM"), item("PPU"), item("KMM")], { sessionsPerDay: 2 });
    for (let seed = 1; seed <= 5; seed++) {
      const { result } = go(snap([r], [tutor("t1", allComp), tutor("t2", allComp), tutor("t3", allComp)]), seed);
      expect(new Set(result.scheduled.map((x) => x.day)).size).toBe(5);
    }
  });

  it("pencarian kandidat tidak pernah keluar dari sel pola rombel", () => {
    const r = rombel("sma", [4], [item("PK", 5)], { sessionsPerDay: 1 });
    const s = snap([r], [tutor("t1", allComp)]);
    const { requirements } = expandRequirements(s.rombels, s.days);
    const ctx = buildContext(s, requirements);
    const state = new ScheduleState(s.slotNos);
    const free = searchPlacement(ctx, state, requirements[0]!, { weights: DEFAULT_WEIGHTS, rng: null });
    expect(free.best!.slotNo).toBe(4);
    const outside = searchPlacement(ctx, state, requirements[0]!, { weights: DEFAULT_WEIGHTS, rng: null, onlyCell: "1-2" });
    expect(outside.best).toBeNull();
  });
});

describe("hari khusus rombel (kelas 2: Selasa, Rabu, Jumat)", () => {
  it("rombel berpola dengan hari khusus hanya memakai harinya; distribusi muat persis", () => {
    const r = rombel("k2", [4], [item("PK"), item("PU"), item("PM")], { sessionsPerDay: 1, days: [2, 3, 5] });
    for (let seed = 1; seed <= 5; seed++) {
      const { result, issues } = go(snap([r], [tutor("t", allComp)]), seed);
      expect(issues).toEqual([]);
      expect(result.unscheduled).toEqual([]);
      expect(result.scheduled.map((x) => x.day).sort()).toEqual([2, 3, 5]);
      expect(new Set(result.scheduled.map((x) => x.slotNo))).toEqual(new Set([4]));
    }
  });
  it("rombel tanpa pola tetapi dengan hari khusus: hanya hari itu, sesi bebas", () => {
    const old: SchedRombel = { id: "o", name: "o", classTypeId: "c", studentCount: 10, fixedRoomId: null, sessionsPerDay: 1, weeklySessions: null, days: [2, 4], distribution: [item("PK", 2)] };
    const { result } = go(snap([old], [tutor("t", allComp)]), 1);
    expect(result.scheduled).toHaveLength(2);
    expect(result.scheduled.every((x) => x.day === 2 || x.day === 4)).toBe(true);
  });
  it("distribusi lebih besar dari kapasitas hari khusus dilaporkan PATTERN_MISMATCH + NO_ROMBEL_SLOT", () => {
    const r = rombel("k2", [4], [item("PK"), item("PU"), item("PM"), item("PPU")], { sessionsPerDay: 1, days: [2, 3, 5] });
    const { result, issues } = go(snap([r], [tutor("t", allComp)]));
    expect(issues.some((i) => i.code === "PATTERN_MISMATCH")).toBe(true);
    expect(result.scheduled).toHaveLength(3);
    expect(result.unscheduled[0]!.reason).toBe("NO_ROMBEL_SLOT");
  });
});

describe("regresi: mentor penghalang dengan beberapa alternatif (sesi N tidak ada)", () => {
  it("banyak rombel satu sesi dengan mentor terbatas: tidak melempar galat di semua seed", () => {
    const dist = [item("PK", 2), item("PU", 2), item("PM", 1)];
    const rombels = Array.from({ length: 8 }, (_, i) => rombel(`r${i}`, [4], dist));
    for (let seed = 1; seed <= 60; seed++) {
      const tutors = Array.from({ length: 9 }, (_, i) => {
        const av = cells(DAYS, [4]).filter((_, k) => (k + i + seed) % 3 !== 0);
        return tutor(`t${i}`, i % 2 ? ["pk", "pu"] : allComp, av);
      });
      expect(() => go(snap(rombels, tutors), seed)).not.toThrow();
    }
  });
});

describe("aturan lunak: tidak sehari, tidak kelas yang sama dua kali", () => {
  const ex = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()] as const;
  const EXCL = [ex("PPU", "KMM"), ex("PK", "PM"), ex("LBI", "PU")];
  const dist = [item("PK"), item("PM"), item("PPU"), item("KMM"), item("LBI"), item("PU")];
  const gy = (id: string) => rombel(id, [1, 3], dist, { pattern: { subtestSlots: [1, 3], drillingSlots: [2] }, sessionsPerDay: 2 });
  const tutors = Array.from({ length: 12 }, (_, i) => tutor(`t${i}`, allComp));
  const clashes = (sessions: readonly { rombelId: string; day: number; subtestId: string }[]) => {
    const key = new Set(EXCL.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    let n = 0;
    for (const x of sessions) for (const y of sessions) if (x !== y && x.rombelId === y.rombelId && x.day === y.day && key.has(`${x.subtestId}|${y.subtestId}`)) n += 1;
    return n / 2;
  };

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: pasangan terlarang tidak sehari dalam satu rombel bila bisa dihindari`, () => {
      const s = snap([gy("a"), gy("b")], tutors, { sameDayExclusions: EXCL });
      const { result, report } = go(s, seed);
      expect(report.violations).toEqual([]);
      expect(result.unscheduled).toEqual([]);
      expect(clashes(result.scheduled)).toBe(0);
    });
  }

  it("tanpa aturan terdapat pasangan sehari pada sebagian seed (aturan benar-benar bekerja)", () => {
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5]) total += clashes(go(snap([gy("a"), gy("b")], tutors), seed).result.scheduled);
    expect(total).toBeGreaterThan(0);
  });

  it("mentor tidak mengajar rombel yang sama dua kali sehari bila ada mentor lain yang bisa", () => {
    for (const seed of [1, 2, 3]) {
      const { result } = go(snap([gy("a"), gy("b")], tutors), seed);
      const seen = new Map<string, number>();
      for (const x of result.scheduled) seen.set(`${x.tutorId}|${x.rombelId}|${x.day}`, (seen.get(`${x.tutorId}|${x.rombelId}|${x.day}`) ?? 0) + 1);
      expect([...seen.values()].filter((n) => n > 1)).toEqual([]);
    }
  });

  it("aturan lunak: bila hanya satu mentor yang bisa, rombel tetap terjadwal penuh", () => {
    const solo = [tutor("only", allComp)];
    const { result } = go(snap([gy("a")], solo), 1);
    expect(result.unscheduled).toEqual([]);
    expect(result.scheduled).toHaveLength(6);
  });
});

describe("mentor tidak mengajar rombel yang sama dua kali sehari (mutasi yang harus tertangkap)", () => {
  const subs = ["pk", "pu", "pm", "ppu"];
  const build = () => {
    const rombels = ["a", "b"].map((id) =>
      rombel(id, [1, 2], subs.map((c) => ({ subtestId: c, flexibleSubtestIds: [], label: null, sessionsPerWeek: 2 })), { sessionsPerDay: 2 }),
    );
    return (n: number) => snap(rombels, Array.from({ length: n }, (_, i) => ({ ...tutor(`t${i}`, subs), level: 99 - i * 10 })));
  };
  const dups = (weights: { sameClassDay: number }) => {
    const make = build();
    let total = 0;
    for (const n of [2, 3, 4]) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = make(n);
        const { requirements } = expandRequirements(s.rombels, s.days);
        const res = createScheduler({ weights })({ snapshot: s, requirements, seed });
        const m = new Map<string, number>();
        for (const x of res.scheduled) m.set(`${x.tutorId}|${x.rombelId}|${x.day}`, (m.get(`${x.tutorId}|${x.rombelId}|${x.day}`) ?? 0) + 1);
        total += [...m.values()].filter((c) => c > 1).length;
      }
    }
    return total;
  };
  it("dengan aturan: tidak ada mentor yang dobel di rombel yang sama pada hari yang sama", () => {
    expect(dups({ sameClassDay: 30 })).toBe(0);
  });
  it("tanpa aturan: dobel terjadi (aturan benar-benar bekerja)", () => {
    expect(dups({ sameClassDay: 0 })).toBeGreaterThan(0);
  });
});

describe("mentor disebar ke banyak rombel (aturan lunak, mutasi yang harus tertangkap)", () => {
  const six = [1, 2, 3, 4, 5, 6];
  const subs = ["pk", "pu", "pm", "ppu", "kmm", "lbi", "lbe"];
  const rnd = (seed: number) => {
    let x = (seed * 2654435761) >>> 0;
    return () => {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  };
  const repeats = (rombelSpread: number) => {
    let total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = rnd(seed + 100);
      const rombels = Array.from({ length: 10 }, (_, i) =>
        rombel(`g${i}`, [1, 3], subs.map((c) => ({ subtestId: c, flexibleSubtestIds: [], label: null, sessionsPerWeek: 1 + (r() < 0.5 ? 1 : 0) })), { sessionsPerDay: 2, pattern: { subtestSlots: [1, 3], drillingSlots: [2] } }),
      );
      const levels = [20, 40, 60, 80, 99];
      const tutors = Array.from({ length: 21 }, (_, i) => ({
        id: `t${i}`, name: `t${i}`, level: levels[i % 5]!,
        competencies: subs.filter(() => r() < 0.45),
        availability: six.flatMap((day) => [1, 2, 3, 4, 5].filter(() => r() < 0.7).map((slotNo) => ({ day, slotNo }))),
      }));
      const s = snap(rombels, tutors, { days: six, subtests: subs.map((c) => ({ id: c, code: c.toUpperCase() })) });
      const { requirements } = expandRequirements(s.rombels, s.days);
      const res = createScheduler({ weights: { rombelSpread } })({ snapshot: s, requirements, seed });
      const m = new Map<string, number>();
      for (const x of res.scheduled) m.set(`${x.tutorId}|${x.rombelId}`, (m.get(`${x.tutorId}|${x.rombelId}`) ?? 0) + 1);
      for (const n of m.values()) if (n > 1) total += n - 1;
    }
    return total;
  };
  it("dengan aturan: pengulangan mentor di rombel yang sama jauh lebih sedikit daripada tanpa aturan", () => {
    const off = repeats(0);
    const on = repeats(25);
    expect(off).toBeGreaterThan(8);
    expect(on).toBeLessThanOrEqual(off / 2);
  });
});
