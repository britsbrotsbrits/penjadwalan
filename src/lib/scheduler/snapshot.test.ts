import { describe, expect, it } from "vitest";
import { buildSnapshot, type SnapshotInput } from "./snapshot";

const base = (): SnapshotInput => ({
  days: [{ dayOfWeek: 1, isActive: true }, { dayOfWeek: 7, isActive: false }, { dayOfWeek: 2, isActive: true }],
  slots: [{ slotNo: 2, isActive: true }, { slotNo: 1, isActive: true }, { slotNo: 3, isActive: false }],
  subtests: [{ id: "s1", code: "PM", isActive: true }, { id: "s2", code: "PK", isActive: false }],
  rooms: [{ id: "k1", name: "A", capacity: 10, isActive: true }, { id: "k2", name: "B", capacity: 5, isActive: false }],
  programs: [{ id: "p1" }],
  classTypes: [{ id: "c1", programId: "p1", defaultSize: 12 }],
  rombels: [
    { id: "r1", name: "R1", classTypeId: "c1", fixedRoomId: null, isActive: true },
    { id: "r2", name: "R2", classTypeId: "c1", fixedRoomId: "k1", isActive: true },
    { id: "r3", name: "R3 mati", classTypeId: "c1", fixedRoomId: null, isActive: false },
    { id: "r4", name: "R4 rusak", classTypeId: "hilang", fixedRoomId: null, isActive: true },
  ],
  activeStudents: [{ rombelId: "r1", activeStudents: 7 }],
  tutors: [
    { id: "t1", name: "Tutor 1", level: 3, isSchedulable: true },
    { id: "t2", name: "Tutor 2", level: 1, isSchedulable: false },
  ],
  competencies: [{ tutorId: "t1", subtestId: "s1" }, { tutorId: "t1", subtestId: "s2" }],
  availability: [
    { tutorId: "t1", day: 1, slotNo: 1, available: true },
    { tutorId: "t1", day: 1, slotNo: 2, available: false },
  ],
  settings: [
    { key: "sessions_per_day", scopeType: "class_type", scopeId: "c1", dayOfWeek: null, value: 2 },
    { key: "weekly_sessions", scopeType: "rombel", scopeId: "r1", dayOfWeek: null, value: "bukan angka" },
  ],
  distribution: [
    { scopeType: "class_type", scopeId: "c1", subtestId: "s1", flexibleSubtestIds: [], label: null, sessionsPerWeek: 2, sortOrder: 0 },
  ],
});

describe("buildSnapshot", () => {
  const { snapshot, issues } = buildSnapshot(base());

  it("hanya hari, sesi, subtes, ruangan aktif; urut naik", () => {
    expect(snapshot.days).toEqual([1, 2]);
    expect(snapshot.slotNos).toEqual([1, 2]);
    expect(snapshot.subtests).toEqual([{ id: "s1", code: "PM" }]);
    expect(snapshot.rooms).toEqual([{ id: "k1", name: "A", capacity: 10 }]);
  });

  it("rombel nonaktif dan referensi tipe kelas rusak tidak ikut", () => {
    expect(snapshot.rombels.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("jumlah siswa: aktual bila ada, jika tidak ukuran standar (DEC-02)", () => {
    expect(snapshot.rombels.find((r) => r.id === "r1")!.studentCount).toBe(7);
    expect(snapshot.rombels.find((r) => r.id === "r2")!.studentCount).toBe(12);
  });

  it("konfigurasi diresolusi per scope; nilai rusak = null + isu (tidak dikarang, tidak diam-diam)", () => {
    const r1 = snapshot.rombels.find((r) => r.id === "r1")!;
    expect(r1.sessionsPerDay).toBe(2);
    expect(r1.weeklySessions).toBeNull();
    expect(issues.map((i) => i.code)).toEqual(["CONFIG_INVALID"]);
    expect(issues[0]!.rombelId).toBe("r1");
    expect(snapshot.rombels.find((r) => r.id === "r2")!.weeklySessions).toBeNull();
  });

  it("distribusi diwariskan dari tipe kelas; ruangan tetap terbawa", () => {
    const r2 = snapshot.rombels.find((r) => r.id === "r2")!;
    expect(r2.distribution).toEqual([{ subtestId: "s1", flexibleSubtestIds: [], label: null, sessionsPerWeek: 2 }]);
    expect(r2.fixedRoomId).toBe("k1");
  });

  it("tanpa distribusi = null (tidak dikarang)", () => {
    const input = base();
    input.distribution = [];
    expect(buildSnapshot(input).snapshot.rombels.every((r) => r.distribution === null)).toBe(true);
  });

  it("tutor nonaktif tidak ikut; kompetensi subtes nonaktif dibuang; hanya sel available", () => {
    expect(snapshot.tutors).toHaveLength(1);
    expect(snapshot.tutors[0]).toEqual({
      id: "t1", name: "Tutor 1", level: 3, competencies: ["s1"], availability: [{ day: 1, slotNo: 1 }],
    });
  });

  it("subtes fleksibel nonaktif dibuang dari daftar yang diizinkan", () => {
    const input = base();
    input.distribution = [
      { scopeType: "class_type", scopeId: "c1", subtestId: null, flexibleSubtestIds: ["s1", "s2"], label: "Fleks", sessionsPerWeek: 1, sortOrder: 0 },
    ];
    const r = buildSnapshot(input).snapshot.rombels[0]!;
    expect(r.distribution![0]!.flexibleSubtestIds).toEqual(["s1"]);
  });
});
