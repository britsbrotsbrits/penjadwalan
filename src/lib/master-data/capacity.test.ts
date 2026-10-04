import { describe, expect, it } from "vitest";
import { countRoomsFitting, summarizeCapacity } from "./capacity";

// Daftar ruangan awal dari master prompt (15 ruangan, belum final).
const seeded = [
  20, 7, 20, 3, 20, 13, 13, 20, 20, 3, 6, 13, 13, 20, 14,
].map((capacity) => ({ capacity, isActive: true }));

describe("summarizeCapacity", () => {
  it("mengelompokkan ruangan aktif dari kapasitas terbesar", () => {
    expect(summarizeCapacity(seeded)).toEqual([
      { capacity: 20, count: 6 },
      { capacity: 14, count: 1 },
      { capacity: 13, count: 4 },
      { capacity: 7, count: 1 },
      { capacity: 6, count: 1 },
      { capacity: 3, count: 2 },
    ]);
  });

  it("mengabaikan ruangan nonaktif", () => {
    const rooms = [
      { capacity: 20, isActive: true },
      { capacity: 20, isActive: false },
    ];
    expect(summarizeCapacity(rooms)).toEqual([{ capacity: 20, count: 1 }]);
  });

  it("daftar kosong menghasilkan daftar kosong", () => {
    expect(summarizeCapacity([])).toEqual([]);
  });
});

describe("countRoomsFitting", () => {
  it("menghitung ruangan aktif yang muat jumlah siswa (kapasitas >= siswa)", () => {
    expect(countRoomsFitting(seeded, 20)).toBe(6);
    expect(countRoomsFitting(seeded, 14)).toBe(7);
    expect(countRoomsFitting(seeded, 7)).toBe(12);
    expect(countRoomsFitting(seeded, 1)).toBe(15);
  });

  it("0 bila tidak ada ruangan yang cukup besar, dan ruangan nonaktif tidak dihitung", () => {
    expect(countRoomsFitting(seeded, 21)).toBe(0);
    expect(countRoomsFitting([{ capacity: 20, isActive: false }], 5)).toBe(0);
  });
});
