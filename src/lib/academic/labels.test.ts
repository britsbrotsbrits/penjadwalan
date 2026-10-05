import { describe, expect, it } from "vitest";
import { buildClassTypeLabels, buildRombelLabels, rombelPath, sizeStatus } from "./labels";

describe("rombelPath", () => {
  it("menyusun program, tipe kelas, dan rombel", () => {
    expect(
      rombelPath({ programName: "Super Intensif", classTypeName: "Junior", rombelName: "Junior A" }),
    ).toBe("Super Intensif · Junior · Junior A");
  });
});

describe("sizeStatus", () => {
  it("ok: masih ada tempat", () => {
    expect(sizeStatus(0, 14)).toEqual({ level: "ok", over: 0, label: "14 tempat tersisa" });
    expect(sizeStatus(13, 14)).toEqual({ level: "ok", over: 0, label: "1 tempat tersisa" });
  });

  it("full: tepat sama dengan ukuran standar", () => {
    expect(sizeStatus(14, 14)).toEqual({ level: "full", over: 0, label: "Penuh" });
  });

  it("over: melebihi ukuran standar hanya sebagai peringatan", () => {
    expect(sizeStatus(15, 14)).toEqual({
      level: "over",
      over: 1,
      label: "Melebihi ukuran standar (1 siswa)",
    });
    expect(sizeStatus(20, 3).over).toBe(17);
  });
});

describe("buildRombelLabels / buildClassTypeLabels", () => {
  const programs = [{ id: "p1", name: "Super Intensif" }];
  const classTypes = [{ id: "c1", programId: "p1", name: "Junior" }];
  const rombels = [
    { id: "r1", classTypeId: "c1", name: "Junior A" },
    { id: "r2", classTypeId: "hilang", name: "Yatim" },
  ];

  it("menggabungkan nama program, tipe kelas, dan rombel", () => {
    const labels = buildRombelLabels(programs, classTypes, rombels);
    expect(labels.get("r1")).toBe("Super Intensif · Junior · Junior A");
  });

  it("memakai ? bila induk tidak ditemukan", () => {
    expect(buildRombelLabels(programs, classTypes, rombels).get("r2")).toBe("? · ? · Yatim");
  });

  it("label tipe kelas", () => {
    expect(buildClassTypeLabels(programs, classTypes).get("c1")).toBe("Super Intensif · Junior");
    expect(buildClassTypeLabels([], classTypes).get("c1")).toBe("? · Junior");
  });
});
