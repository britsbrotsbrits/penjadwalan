import { describe, expect, it } from "vitest";
import { parsePatternForm, patternFormDefaults } from "./pattern-form";

const slots = [1, 2, 3, 4, 5];

describe("parsePatternForm", () => {
  it("pola Gap Year: Subtes / Drilling / Subtes", () => {
    const r = parsePatternForm(slots, new Map([[1, "SUBTEST"], [2, "DRILLING"], [3, "SUBTEST"]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toEqual([{ slot_no: 1, kind: "SUBTEST" }, { slot_no: 2, kind: "DRILLING" }, { slot_no: 3, kind: "SUBTEST" }]);
  });
  it("semua kosong = hapus pola (items kosong)", () => {
    const r = parsePatternForm(slots, new Map([[1, ""], [2, " "]]));
    expect(r.ok && r.items).toEqual([]);
  });
  it("hanya Drilling ditolak; jenis asing ditolak", () => {
    const a = parsePatternForm(slots, new Map([[2, "DRILLING"]]));
    expect(!a.ok && a.message).toBe("Pola harus punya minimal satu sesi bertipe Subtes.");
    const b = parsePatternForm(slots, new Map([[1, "TRYOUT"]]));
    expect(!b.ok && b.message).toBe("Pilihan untuk sesi 1 tidak valid.");
  });
  it("mengabaikan nilai untuk sesi yang tidak aktif", () => {
    const r = parsePatternForm([1, 2], new Map([[1, "SUBTEST"], [9, "SUBTEST"]]));
    expect(r.ok && r.items.map((i) => i.slot_no)).toEqual([1]);
  });
});

describe("patternFormDefaults", () => {
  it("memetakan pola tersimpan", () => {
    expect(patternFormDefaults([{ slotNo: 1, kind: "SUBTEST" }, { slotNo: 2, kind: "DRILLING" }]).get(2)).toBe("DRILLING");
  });
});
