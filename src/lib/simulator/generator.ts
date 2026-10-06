import type { SchedDistributionItem, SchedRombel, SchedRoom, SchedTutor, SchedulingSnapshot } from "../scheduler/types";
import { Rng } from "./rng";

/**
 * Generator data SINTETIS untuk simulator. Tidak membaca database dan tidak menulis apa pun.
 * Struktur program/tipe kelas, ukuran standar, sesi per hari, dan baseline Gap Year meniru seed
 * (sumber: master prompt). Hal yang TIDAK tertulis di sumber (jumlah rombel, tutor, kepadatan
 * availability, distribusi program selain Gap Year) dikarang di sini HANYA untuk pengujian dan
 * ditandai sintetis. Distribusi program lain memakai skala baseline sebagai heuristik awal.
 */

export const SIMULATION_MODES = ["small", "realistic", "stress"] as const;
export type SimulationMode = (typeof SIMULATION_MODES)[number];

export const MODE_LABELS: Record<SimulationMode, string> = {
  small: "Small Simulation",
  realistic: "Realistic Simulation",
  stress: "Stress Test",
};

const SUBTEST_CODES = ["LBI", "LBE", "PU", "PPU", "KMM", "PM", "PK"] as const;

// [program, tipe kelas, ukuran standar, sesi per hari]
const CLASS_TYPES: ReadonlyArray<readonly [string, string, number, number]> = [
  ["Kelas 3 SMA", "General", 20, 1],
  ["Kelas 3 SMA", "VVIP", 13, 1],
  ["Kelas 3 SMA", "Fast Track", 7, 2],
  ["Super Camp", "VVIP", 7, 6],
  ["Super Camp", "Gold", 3, 6],
  ["Super Camp", "Platinum", 1, 6],
  ["Super Intensif", "Regular", 20, 2],
  ["Super Intensif", "Junior", 14, 3],
  ["Super Intensif", "VIP", 14, 4],
  ["Super Intensif", "Eksekutif", 7, 4],
  ["Gap Year", "Junior", 20, 2],
  ["Gap Year", "Eksekutif", 14, 2],
  ["Gap Year", "Gold", 6, 2],
  ["Gap Year", "Platinum", 3, 2],
];

// Baseline Gap Year (tentatif). null = item fleksibel KMM/PPU.
const BASELINE: ReadonlyArray<readonly [string | null, number]> = [
  ["KMM", 1], ["PPU", 1], [null, 1], ["PM", 2], ["PK", 3], ["PU", 2], ["LBI", 1], ["LBE", 1],
];

// Meniru daftar ruangan awal (nama dan kapasitas).
const REAL_ROOMS: ReadonlyArray<readonly [string, number]> = [
  ["Amsterdam", 20], ["Bolivia", 7], ["Kamerun", 20], ["Dominika", 3], ["Egypt", 20], ["Jordan", 13],
  ["Kanada", 13], ["Latvia", 20], ["France", 20], ["Grenada", 3], ["Hungaria", 6], ["Maroko", 13],
  ["Norwegia", 13], ["Oman", 20], ["Polandia", 14],
];

type Profile = {
  days: number[];
  slotCount: number;
  classTypeIndexes: number[] | "all";
  rombelsPerClassType: [number, number];
  tutorCount: number;
  extraRooms: number;
  roomSource: "real" | "synthetic";
  /** Tutor minimum per subtes agar tiap subtes punya pengajar. */
  minTutorsPerSubtest: number;
  availabilityDensity: [number, number];
  competencyCount: [number, number];
  /** Peluang rombel sengaja diberi total sesi/minggu yang berbeda dari distribusi (uji discrepancy). */
  mismatchRate: number;
  fixedRoomRate: number;
  /** Batas atas kelebihan siswa dari ukuran standar (pecahan). 0 = tidak pernah melebihi. */
  overfill: number;
};

const PROFILES: Record<SimulationMode, Profile> = {
  small: {
    days: [1, 2, 3, 4, 5],
    slotCount: 4,
    classTypeIndexes: [0, 2, 10],
    rombelsPerClassType: [1, 1],
    tutorCount: 14,
    extraRooms: 0,
    roomSource: "synthetic",
    minTutorsPerSubtest: 2,
    availabilityDensity: [0.6, 0.9],
    competencyCount: [2, 4],
    mismatchRate: 0,
    fixedRoomRate: 0,
    overfill: 0,
  },
  realistic: {
    days: [1, 2, 3, 4, 5, 6],
    slotCount: 8,
    classTypeIndexes: "all",
    rombelsPerClassType: [1, 3],
    tutorCount: 60,
    extraRooms: 0,
    roomSource: "real",
    minTutorsPerSubtest: 5,
    availabilityDensity: [0.45, 0.85],
    competencyCount: [2, 4],
    mismatchRate: 0.04,
    fixedRoomRate: 0.3,
    overfill: 0,
  },
  stress: {
    days: [1, 2, 3, 4, 5, 6],
    slotCount: 8,
    classTypeIndexes: "all",
    rombelsPerClassType: [6, 10],
    tutorCount: 220,
    extraRooms: 15,
    roomSource: "real",
    minTutorsPerSubtest: 20,
    availabilityDensity: [0.4, 0.85],
    competencyCount: [2, 4],
    mismatchRate: 0.04,
    fixedRoomRate: 0.3,
    overfill: 0.2,
  },
};

/** Bagi `total` menurut bobot dengan metode sisa terbesar; jumlahnya selalu tepat `total`. */
export function scaleDistribution(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w * total) / sum);
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]! += 1;
    remaining -= 1;
  }
  return floors;
}

export type GeneratedScenario = {
  snapshot: SchedulingSnapshot;
  /** Catatan transparansi: apa yang sintetis. */
  notes: string[];
};

export function generateScenario(mode: SimulationMode, seed: number): GeneratedScenario {
  const profile = PROFILES[mode];
  const rng = new Rng(seed);
  const dayCount = profile.days.length;

  const subtests = SUBTEST_CODES.map((code) => ({ id: `sub-${code}`, code }));
  const subtestId = (code: string) => `sub-${code}`;
  const slotNos = Array.from({ length: profile.slotCount }, (_, i) => i + 1);

  // ---- ruangan
  const rooms: SchedRoom[] = [];
  if (profile.roomSource === "real") {
    REAL_ROOMS.forEach(([name, capacity], i) => rooms.push({ id: `room-${i + 1}`, name, capacity }));
  } else {
    [20, 20, 14, 7, 3].forEach((capacity, i) => rooms.push({ id: `room-${i + 1}`, name: `Ruang ${i + 1}`, capacity }));
  }
  for (let i = 0; i < profile.extraRooms; i++) {
    const capacity = REAL_ROOMS[i % REAL_ROOMS.length]![1];
    rooms.push({ id: `room-x${i + 1}`, name: `Ruang Tambahan ${i + 1}`, capacity });
  }

  // ---- rombel
  const indexes = profile.classTypeIndexes === "all" ? CLASS_TYPES.map((_, i) => i) : profile.classTypeIndexes;
  const rombels: SchedRombel[] = [];
  let mismatchCount = 0;
  for (const ci of indexes) {
    const [program, classType, defaultSize, perDay] = CLASS_TYPES[ci]!;
    const count = rng.int(profile.rombelsPerClassType[0], profile.rombelsPerClassType[1]);
    for (let n = 0; n < count; n++) {
      const weeklyTotal = perDay * dayCount;
      const scaled = scaleDistribution(BASELINE.map(([, w]) => w), weeklyTotal);
      const distribution: SchedDistributionItem[] = [];
      BASELINE.forEach(([code], i) => {
        if (scaled[i]! <= 0) return;
        distribution.push(
          code === null
            ? { subtestId: null, flexibleSubtestIds: [subtestId("KMM"), subtestId("PPU")], label: "KMM/PPU Flexible", sessionsPerWeek: scaled[i]! }
            : { subtestId: subtestId(code), flexibleSubtestIds: [], label: null, sessionsPerWeek: scaled[i]! },
        );
      });
      // Ukuran: sekitar ukuran standar (aktual boleh sedikit kurang atau lebih).
      const studentCount = Math.max(1, defaultSize + rng.int(-Math.floor(defaultSize / 4), Math.floor(defaultSize * profile.overfill)));
      const mismatch = rng.chance(profile.mismatchRate);
      if (mismatch) mismatchCount += 1;
      const fitting = rooms.filter((r) => r.capacity >= studentCount);
      const fixedRoomId = fitting.length > 0 && rng.chance(profile.fixedRoomRate) ? rng.pick(fitting).id : null;
      rombels.push({
        id: `rombel-${rombels.length + 1}`,
        name: `${program} ${classType} ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ""}`,
        classTypeId: `ct-${ci + 1}`,
        studentCount,
        fixedRoomId,
        sessionsPerDay: perDay,
        weeklySessions: mismatch ? weeklyTotal + rng.pick([-2, -1, 1, 2]) : weeklyTotal,
        distribution,
      });
    }
  }

  // ---- tutor
  const tutors: SchedTutor[] = [];
  for (let i = 0; i < profile.tutorCount; i++) {
    const primary = SUBTEST_CODES[i % SUBTEST_CODES.length]!;
    const guaranteed = i < SUBTEST_CODES.length * profile.minTutorsPerSubtest;
    const k = rng.int(profile.competencyCount[0], profile.competencyCount[1]);
    const others = rng.sample(SUBTEST_CODES.filter((c) => c !== primary), guaranteed ? k - 1 : k);
    const codes = guaranteed ? [primary, ...others] : others;
    const density = profile.availabilityDensity[0] + rng.next() * (profile.availabilityDensity[1] - profile.availabilityDensity[0]);
    const availability: Array<{ day: number; slotNo: number }> = [];
    for (const day of profile.days) for (const slotNo of slotNos) if (rng.chance(density)) availability.push({ day, slotNo });
    tutors.push({
      id: `tutor-${i + 1}`,
      name: `Tutor ${i + 1}`,
      level: rng.int(0, 99),
      competencies: codes.map(subtestId),
      availability,
    });
  }

  const notes = [
    "Seluruh data sintetis; tidak membaca atau menulis database.",
    `Sesi per minggu rombel = sesi per hari x ${dayCount} hari (cocok dengan contoh: General 6, VIP 24, Super Camp 36, Gap Year 12).`,
    "Distribusi subtes memakai skala baseline Gap Year (heuristik awal) untuk semua tipe kelas; hanya Gap Year yang bernilai 12.",
    `${mismatchCount} rombel sengaja diberi total sesi/minggu yang berbeda dari distribusi (uji discrepancy).`,
  ];

  return { snapshot: { days: profile.days, slotNos, subtests, rooms, rombels, tutors }, notes };
}
