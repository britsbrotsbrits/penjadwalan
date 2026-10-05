import { describe, expect, it } from "vitest";
import { compareIsoDates, formatDateRange, formatIsoDate, isValidIsoDate } from "./dates";

describe("isValidIsoDate", () => {
  it("menerima tanggal nyata, termasuk 29 Februari tahun kabisat", () => {
    expect(isValidIsoDate("2026-10-04")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("menolak tanggal yang tidak ada", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-01-00")).toBe(false);
  });

  it("menolak format salah dan tahun di luar rentang", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("4-10-2026")).toBe(false);
    expect(isValidIsoDate("2026-1-5")).toBe(false);
    expect(isValidIsoDate("2026-10-04T00:00")).toBe(false);
    expect(isValidIsoDate("1800-01-01")).toBe(false);
    expect(isValidIsoDate("9999-01-01")).toBe(false);
  });
});

describe("compareIsoDates", () => {
  it("membandingkan sebagai teks kalender", () => {
    expect(compareIsoDates("2026-01-01", "2026-12-31")).toBe(-1);
    expect(compareIsoDates("2026-12-31", "2026-01-01")).toBe(1);
    expect(compareIsoDates("2026-05-05", "2026-05-05")).toBe(0);
  });
});

describe("formatIsoDate / formatDateRange", () => {
  it("memformat tanggal Indonesia ringkas", () => {
    expect(formatIsoDate("2026-03-05")).toBe("5 Mar 2026");
    expect(formatIsoDate("2026-05-20")).toBe("20 Mei 2026");
  });

  it("mengembalikan teks apa adanya bila tidak valid", () => {
    expect(formatIsoDate("bukan tanggal")).toBe("bukan tanggal");
  });

  it("merangkum rentang rombel", () => {
    expect(formatDateRange(null, null)).toBe("-");
    expect(formatDateRange("2026-01-01", "2026-12-31")).toBe("1 Jan 2026 - 31 Des 2026");
    expect(formatDateRange("2026-01-01", null)).toBe("Mulai 1 Jan 2026");
    expect(formatDateRange(null, "2026-12-31")).toBe("Sampai 31 Des 2026");
  });
});
