import { describe, expect, it } from "vitest";
import {
  availabilityStatus,
  buildAvailabilityPayload,
  cellKey,
  parseCellKey,
  summarizeAvailability,
  toAvailabilityMap,
} from "./availability";

describe("cellKey / parseCellKey", () => {
  it("bolak-balik", () => {
    expect(cellKey(3, 5)).toBe("3-5");
    expect(parseCellKey("3-5")).toEqual({ day: 3, slotNo: 5 });
    expect(parseCellKey("7-99")).toEqual({ day: 7, slotNo: 99 });
    expect(parseCellKey("1-1")).toEqual({ day: 1, slotNo: 1 });
  });

  it("menolak kunci tidak valid", () => {
    for (const bad of ["", "0-1", "8-1", "1-0", "1-100", "1-01", "a-b", "1_2", "1-2-3", " 1-2", "1-2 ", "-1-2"]) {
      expect(parseCellKey(bad)).toBeNull();
    }
  });
});

describe("buildAvailabilityPayload", () => {
  const days = [1, 2, 3];
  const slots = [1, 2];

  it("mengirim SELURUH grid; yang tercentang true, sisanya false", () => {
    expect(buildAvailabilityPayload(["1-1", "3-2"], days, slots)).toEqual([
      { day: 1, slot_no: 1, available: true },
      { day: 1, slot_no: 2, available: false },
      { day: 2, slot_no: 1, available: false },
      { day: 2, slot_no: 2, available: false },
      { day: 3, slot_no: 1, available: false },
      { day: 3, slot_no: 2, available: true },
    ]);
  });

  it("tanpa centang: semua false (tutor menyatakan tidak tersedia sama sekali)", () => {
    const payload = buildAvailabilityPayload([], days, slots);
    expect(payload).toHaveLength(6);
    expect(payload?.every((c) => c.available === false)).toBe(true);
  });

  it("kunci ganda diperlakukan satu kali", () => {
    const payload = buildAvailabilityPayload(["1-1", "1-1"], days, slots);
    expect(payload?.filter((c) => c.available)).toHaveLength(1);
  });

  it("menolak kunci di luar grid atau berformat salah (bukan diabaikan diam-diam)", () => {
    expect(buildAvailabilityPayload(["4-1"], days, slots)).toBeNull();
    expect(buildAvailabilityPayload(["1-3"], days, slots)).toBeNull();
    expect(buildAvailabilityPayload(["xx"], days, slots)).toBeNull();
  });

  it("grid kosong menghasilkan payload kosong", () => {
    expect(buildAvailabilityPayload([], [], [])).toEqual([]);
  });
});

describe("summarizeAvailability / availabilityStatus", () => {
  const days = [1, 2];
  const slots = [1, 2, 3];

  it("menghitung tersedia dan belum terisi terhadap grid saat ini", () => {
    const cells = [
      { day: 1, slotNo: 1, available: true },
      { day: 1, slotNo: 2, available: false },
      { day: 2, slotNo: 3, available: true },
      { day: 7, slotNo: 9, available: true }, // di luar grid saat ini: diabaikan
    ];
    expect(summarizeAvailability(cells, days, slots)).toEqual({ total: 6, available: 2, unfilled: 3 });
  });

  it("toAvailabilityMap", () => {
    expect(toAvailabilityMap([{ day: 2, slotNo: 1, available: false }]).get("2-1")).toBe(false);
  });

  it("status: belum diisi, perlu dilengkapi, lengkap", () => {
    expect(availabilityStatus(null, { total: 6, available: 0, unfilled: 6 })).toBe("belum_diisi");
    expect(availabilityStatus("2026-10-05T01:00:00Z", { total: 6, available: 2, unfilled: 1 })).toBe("perlu_dilengkapi");
    expect(availabilityStatus("2026-10-05T01:00:00Z", { total: 6, available: 0, unfilled: 0 })).toBe("lengkap");
  });

  it("tutor yang menyatakan tidak tersedia sama sekali tetap dianggap sudah mengisi", () => {
    const cells = days.flatMap((day) => slots.map((slotNo) => ({ day, slotNo, available: false })));
    const summary = summarizeAvailability(cells, days, slots);
    expect(summary.available).toBe(0);
    expect(availabilityStatus("2026-10-05T01:00:00Z", summary)).toBe("lengkap");
  });
});
