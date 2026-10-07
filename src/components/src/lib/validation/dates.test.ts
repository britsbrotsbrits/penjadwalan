import { describe, expect, it } from "vitest";
import { addDays, diffDays, eachDate, formatIsoDate, isoDow, parseIsoDate, weekStart } from "./dates";

describe("tanggal", () => {
  it("menolak format dan tanggal mustahil", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-1-1")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("2024-02-29")).not.toBeNull();
    expect(parseIsoDate("2026-02-29")).toBeNull();
  });
  it("hari ISO: Senin = 1, Minggu = 7", () => {
    expect(isoDow("2026-11-02")).toBe(1);
    expect(isoDow("2026-11-08")).toBe(7);
    expect(isoDow("2026-10-07")).toBe(3);
  });
  it("tambah hari melewati bulan/tahun", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDays("2026-11-02", "2026-11-16")).toBe(14);
    expect(diffDays("2026-11-16", "2026-11-02")).toBe(-14);
  });
  it("awal minggu = Senin", () => {
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });
  it("eachDate inklusif; kosong bila terbalik", () => {
    expect(eachDate("2026-11-02", "2026-11-04")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(eachDate("2026-11-04", "2026-11-02")).toEqual([]);
    expect(eachDate("2026-11-02", "2026-11-02")).toHaveLength(1);
  });
  it("format dan parse konsisten", () => {
    expect(formatIsoDate(parseIsoDate("2026-01-05")!)).toBe("2026-01-05");
  });
});
