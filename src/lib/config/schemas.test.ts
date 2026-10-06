import { describe, expect, it } from "vitest";
import {
  FLEX_VALUE,
  distributionRowSchema,
  parseDistributionRows,
  parseOptionalValue,
  settingRowSchema,
  type DistributionFormRow,
} from "./schemas";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const row = (over: Partial<DistributionFormRow>): DistributionFormRow => ({
  subtest: "", label: "", flexible: [], sessions: "", ...over,
});

describe("parseOptionalValue", () => {
  it("kosong = null (ikut parent)", () => {
    expect(parseOptionalValue("sessions_per_day", "")).toEqual({ ok: true, value: null });
    expect(parseOptionalValue("sessions_per_day", "  ")).toEqual({ ok: true, value: null });
    expect(parseOptionalValue("sessions_per_day", undefined)).toEqual({ ok: true, value: null });
  });
  it("angka valid", () => {
    expect(parseOptionalValue("sessions_per_day", "3")).toEqual({ ok: true, value: 3 });
    expect(parseOptionalValue("weekly_sessions", " 36 ")).toEqual({ ok: true, value: 36 });
  });
  it("menolak nol, pecahan, teks, dan di luar rentang dengan pesan jelas", () => {
    expect(parseOptionalValue("sessions_per_day", "0")).toEqual({ ok: false, message: "Sesi per hari minimal 1." });
    expect(parseOptionalValue("sessions_per_day", "2.5")).toEqual({ ok: false, message: "Sesi per hari harus bilangan bulat." });
    expect(parseOptionalValue("sessions_per_day", "abc").ok).toBe(false);
    expect(parseOptionalValue("weekly_sessions", "1000")).toEqual({ ok: false, message: "Total sesi per minggu maksimal 999." });
  });
});

describe("parseDistributionRows", () => {
  it("baris kosong dilewati; item biasa dan fleksibel dibentuk benar", () => {
    const r = parseDistributionRows([
      row({ subtest: A, sessions: "2" }),
      row({}),
      row({ subtest: FLEX_VALUE, label: " KMM/PPU Flexible ", flexible: [B, C, B], sessions: "1" }),
    ]);
    expect(r).toEqual({
      ok: true,
      items: [
        { subtest_id: A, sessions_per_week: 2 },
        { label: "KMM/PPU Flexible", flexible_subtest_ids: [B, C], sessions_per_week: 1 },
      ],
    });
  });

  it("semua kosong ditolak (jangan hapus diam-diam)", () => {
    const r = parseDistributionRows([row({}), row({})]);
    expect(r.ok).toBe(false);
  });

  it("pesan error menyebut nomor baris", () => {
    expect(parseDistributionRows([row({ sessions: "2" })])).toEqual({ ok: false, message: "Baris 1: pilih subtes atau item fleksibel." });
    expect(parseDistributionRows([row({}), row({ subtest: A })])).toEqual({ ok: false, message: "Baris 2: sesi per minggu wajib diisi." });
    expect(parseDistributionRows([row({ subtest: A, sessions: "0" })]).ok).toBe(false);
    expect(parseDistributionRows([row({ subtest: A, sessions: "1.5" })]).ok).toBe(false);
    expect(parseDistributionRows([row({ subtest: A, sessions: "100" })]).ok).toBe(false);
  });

  it("subtes ganda, nama fleksibel ganda, dan fleksibel kurang dari 2 subtes ditolak", () => {
    expect(parseDistributionRows([row({ subtest: A, sessions: "1" }), row({ subtest: A, sessions: "1" })]).ok).toBe(false);
    expect(parseDistributionRows([row({ subtest: FLEX_VALUE, label: "F", flexible: [B], sessions: "1" })])).toEqual({
      ok: false, message: "Baris 1: pilih minimal 2 subtes yang boleh mengisi item fleksibel.",
    });
    expect(parseDistributionRows([row({ subtest: FLEX_VALUE, label: "", flexible: [B, C], sessions: "1" })]).ok).toBe(false);
    const dup = parseDistributionRows([
      row({ subtest: FLEX_VALUE, label: "F", flexible: [A, B], sessions: "1" }),
      row({ subtest: FLEX_VALUE, label: " f ", flexible: [B, C], sessions: "1" }),
    ]);
    expect(dup.ok).toBe(false);
  });

  it("id bukan UUID ditolak; terlalu banyak baris ditolak", () => {
    expect(parseDistributionRows([row({ subtest: "bukan-uuid", sessions: "1" })]).ok).toBe(false);
    expect(parseDistributionRows(Array.from({ length: 21 }, () => row({}))).ok).toBe(false);
  });
});

describe("row schemas", () => {
  it("settingRowSchema memetakan snake_case", () => {
    expect(settingRowSchema.parse({ key: "sessions_per_day", scope_type: "rombel", scope_id: A, day_of_week: null, value: 3 })).toEqual({
      key: "sessions_per_day", scopeType: "rombel", scopeId: A, dayOfWeek: null, value: 3,
    });
  });
  it("distributionRowSchema memetakan item fleksibel", () => {
    const r = distributionRowSchema.parse({
      scope_type: "program", scope_id: A, subtest_id: null, flexible_subtest_ids: [B, C],
      label: "Flex", sessions_per_week: 1, sort_order: 3,
    });
    expect(r.flexibleSubtestIds).toEqual([B, C]);
    expect(r.subtestId).toBeNull();
  });
});
