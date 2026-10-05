import { describe, expect, it } from "vitest";
import { analyzeFixedRooms, evaluateFixedRoom, requiredSeats, worstSeverity } from "./fixed-room";

const room = (over: Partial<{ id: string; name: string; capacity: number; isActive: boolean }> = {}) => ({
  id: "room1",
  name: "Amsterdam",
  capacity: 20,
  isActive: true,
  ...over,
});

describe("requiredSeats (DEC-02)", () => {
  it("memakai siswa aktif aktual bila ada", () => {
    expect(requiredSeats(12, 20)).toEqual({ required: 12, basis: "actual" });
  });

  it("jatuh ke ukuran standar bila belum ada siswa aktif", () => {
    expect(requiredSeats(0, 20)).toEqual({ required: 20, basis: "class_type" });
  });
});

describe("evaluateFixedRoom", () => {
  it("cocok: tanpa masalah", () => {
    const e = evaluateFixedRoom({ room: room(), activeStudents: 20, defaultSize: 20 });
    expect(e.issues).toEqual([]);
    expect(worstSeverity(e)).toBe("ok");
  });

  it("kapasitas pas (sama dengan jumlah siswa) diterima", () => {
    expect(evaluateFixedRoom({ room: room({ capacity: 7 }), activeStudents: 7, defaultSize: 7 }).issues).toEqual([]);
  });

  it("siswa +1 dari kapasitas = error nyata (tanpa toleransi)", () => {
    const e = evaluateFixedRoom({ room: room({ capacity: 7 }), activeStudents: 8, defaultSize: 7 });
    expect(e.issues).toHaveLength(1);
    expect(e.issues[0]).toEqual({
      code: "ROOM_TOO_SMALL",
      severity: "error",
      message: "Kapasitas Amsterdam (7) kurang dari 8 siswa aktif.",
    });
    expect(worstSeverity(e)).toBe("error");
  });

  it("tanpa siswa aktif: kurang dari ukuran standar hanya peringatan, plus penanda perkiraan", () => {
    const e = evaluateFixedRoom({ room: room({ capacity: 6 }), activeStudents: 0, defaultSize: 20 });
    expect(e.basis).toBe("class_type");
    expect(e.issues.map((i) => [i.code, i.severity])).toEqual([
      ["ROOM_TOO_SMALL", "warning"],
      ["SIZE_ESTIMATED", "warning"],
    ]);
    expect(worstSeverity(e)).toBe("warning");
  });

  it("tanpa siswa aktif dan ruangan cukup: hanya penanda perkiraan", () => {
    const e = evaluateFixedRoom({ room: room(), activeStudents: 0, defaultSize: 14 });
    expect(e.issues.map((i) => i.code)).toEqual(["SIZE_ESTIMATED"]);
  });

  it("ruangan nonaktif = error, dan bisa digabung dengan kapasitas kurang", () => {
    const e = evaluateFixedRoom({ room: room({ isActive: false, capacity: 3 }), activeStudents: 5, defaultSize: 5 });
    expect(e.issues.map((i) => i.code)).toEqual(["ROOM_INACTIVE", "ROOM_TOO_SMALL"]);
  });

  it("ruangan tidak ditemukan = error", () => {
    const e = evaluateFixedRoom({ room: null, activeStudents: 5, defaultSize: 5 });
    expect(e.issues.map((i) => i.code)).toEqual(["ROOM_MISSING"]);
  });
});

describe("analyzeFixedRooms", () => {
  const rooms = [
    room({ id: "a", name: "A", capacity: 10 }),
    room({ id: "b", name: "B", capacity: 2 }),
    room({ id: "c", name: "C", capacity: 6, isActive: false }),
  ];
  const classTypes = [{ id: "ct1", defaultSize: 10 }];
  const base = { classTypeId: "ct1", isActive: true };
  const rombels = [
    { ...base, id: "r1", name: "R1", fixedRoomId: "a" },
    { ...base, id: "r2", name: "R2", fixedRoomId: "a" },
    { ...base, id: "r3", name: "R3", fixedRoomId: "b" },
    { ...base, id: "r4", name: "R4", fixedRoomId: "c" },
    { ...base, id: "r5", name: "R5", fixedRoomId: null },
    { ...base, id: "r6", name: "R6", fixedRoomId: "a", isActive: false },
    { ...base, id: "r7", name: "R7", fixedRoomId: "hilang" },
  ];
  const counts = [
    { rombelId: "r1", activeStudents: 10 },
    { rombelId: "r3", activeStudents: 3 },
  ];
  const result = analyzeFixedRooms({ rombels, rooms, classTypes, counts });

  it("hanya rombel aktif yang punya ruangan tetap yang dievaluasi", () => {
    expect([...result.byRombel.keys()].sort()).toEqual(["r1", "r2", "r3", "r4", "r7"]);
  });

  it("mendeteksi masalah per rombel", () => {
    expect(worstSeverity(result.byRombel.get("r1")!)).toBe("ok");
    expect(result.byRombel.get("r3")!.issues.map((i) => i.code)).toEqual(["ROOM_TOO_SMALL"]);
    expect(result.byRombel.get("r4")!.issues.map((i) => i.code)).toContain("ROOM_INACTIVE");
    expect(result.byRombel.get("r7")!.issues.map((i) => i.code)).toEqual(["ROOM_MISSING"]);
  });

  it("rombel tanpa siswa aktif memakai ukuran tipe kelas", () => {
    expect(result.byRombel.get("r2")!.basis).toBe("class_type");
  });

  it("memetakan ruangan ke rombel aktif dan mendeteksi ruangan bersama (DEC-03)", () => {
    expect(result.byRoom.get("a")).toEqual(["r1", "r2"]);
    expect(result.sharedRoomIds).toEqual(["a"]);
  });

  it("rombel nonaktif tidak dihitung memakai ruangan", () => {
    expect(result.byRoom.get("a")).not.toContain("r6");
  });

  it("tipe kelas tidak dikenal tidak menyalahkan ruangan", () => {
    const r = analyzeFixedRooms({
      rombels: [{ id: "x", name: "X", classTypeId: "?", fixedRoomId: "a", isActive: true }],
      rooms,
      classTypes: [],
      counts: [],
    });
    expect(r.byRombel.get("x")!.issues.map((i) => i.code)).not.toContain("ROOM_TOO_SMALL");
  });
});
