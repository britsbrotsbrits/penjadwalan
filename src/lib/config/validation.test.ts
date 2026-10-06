import { describe, expect, it } from "vitest";
import type { ResolvedDistribution } from "./distribution";
import type { Resolved } from "./resolver";
import { validateAcademicConfig, worstConfigSeverity, type SubtestInfo } from "./validation";

const found = (value: number): Resolved => ({
  status: "found",
  value,
  source: { scopeType: "class_type", scopeId: "c1", dayOfWeek: null },
});
const missing: Resolved = { status: "missing" };
const dist = (total: number, ids: string[] = ["a"]): ResolvedDistribution => ({
  status: "found",
  scopeType: "program",
  scopeId: "p1",
  total,
  items: ids.map((id) => ({
    scopeType: "program",
    scopeId: "p1",
    subtestId: id,
    flexibleSubtestIds: [],
    label: null,
    sessionsPerWeek: 1,
    sortOrder: 0,
  })),
});
const subtests: SubtestInfo[] = [
  { id: "a", code: "PM", name: "Penalaran Matematika", isActive: true },
  { id: "b", code: "PK", name: "Penalaran Kuantitatif", isActive: false },
];
const base = {
  sessionsPerDay: found(2),
  weeklySessions: found(12),
  distribution: dist(12),
  subtests,
  activeDayCount: 6,
  activeSlotCount: 8,
};
const codes = (o: Partial<typeof base>) => validateAcademicConfig({ ...base, ...o }).map((i) => i.code);

describe("validateAcademicConfig", () => {
  it("konfigurasi lengkap dan konsisten = tanpa masalah", () => {
    const issues = validateAcademicConfig(base);
    expect(issues).toEqual([]);
    expect(worstConfigSeverity(issues)).toBe("ok");
  });

  it("distribusi belum ada = peringatan (TBD-03), bukan error", () => {
    const issues = validateAcademicConfig({ ...base, distribution: { status: "missing" } });
    expect(issues).toEqual([{ code: "DISTRIBUTION_MISSING", severity: "warning", message: "Distribusi subtes belum ada." }]);
    expect(worstConfigSeverity(issues)).toBe("warning");
  });

  it("total berbeda = error discrepancy, dengan kedua angka dan tanpa sesi karangan (TBD-05)", () => {
    const issues = validateAcademicConfig({ ...base, weeklySessions: found(6) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      code: "DISTRIBUTION_MISMATCH",
      severity: "error",
      message:
        "Total distribusi subtes (12) tidak sama dengan total sesi per minggu (6). Sistem tidak menambah atau mengurangi sesi secara otomatis.",
    });
    expect(worstConfigSeverity(issues)).toBe("error");
  });

  it("total sesi/minggu belum diatur = peringatan, bukan mismatch", () => {
    expect(codes({ weeklySessions: missing })).toEqual(["WEEKLY_SESSIONS_MISSING"]);
  });

  it("sesi per hari belum diatur = peringatan", () => {
    expect(codes({ sessionsPerDay: missing })).toEqual(["SESSIONS_PER_DAY_MISSING"]);
  });

  it("sesi per hari melebihi jumlah sesi aktif = error", () => {
    expect(codes({ sessionsPerDay: found(9), weeklySessions: found(12) })).toContain("SESSIONS_PER_DAY_EXCEEDS_SLOTS");
    expect(codes({ sessionsPerDay: found(8) })).not.toContain("SESSIONS_PER_DAY_EXCEEDS_SLOTS");
  });

  it("tanpa slot aktif, pemeriksaan slot dilewati", () => {
    expect(codes({ sessionsPerDay: found(9), activeSlotCount: 0 })).not.toContain("SESSIONS_PER_DAY_EXCEEDS_SLOTS");
  });

  it("total/minggu melebihi sesi/hari x hari aktif = peringatan kapasitas", () => {
    expect(codes({ sessionsPerDay: found(2), weeklySessions: found(13), distribution: dist(13), activeDayCount: 6 })).toEqual([
      "WEEKLY_EXCEEDS_CAPACITY",
    ]);
    expect(codes({ sessionsPerDay: found(2), weeklySessions: found(12), activeDayCount: 6 })).toEqual([]);
  });

  it("nilai tersimpan rusak = error", () => {
    const bad: Resolved = { status: "invalid", message: "x", source: { scopeType: "rombel", scopeId: "r", dayOfWeek: null } };
    expect(codes({ sessionsPerDay: bad })).toEqual(["SESSIONS_PER_DAY_INVALID"]);
    expect(codes({ weeklySessions: bad })).toEqual(["WEEKLY_SESSIONS_INVALID"]);
  });

  it("subtes nonaktif = peringatan; subtes tidak dikenal = error; tidak digandakan", () => {
    expect(codes({ distribution: dist(12, ["b", "b"]) })).toEqual(["DISTRIBUTION_SUBTEST_INACTIVE"]);
    const issues = validateAcademicConfig({ ...base, distribution: dist(12, ["hilang"]) });
    expect(issues.map((i) => [i.code, i.severity])).toEqual([["DISTRIBUTION_SUBTEST_UNKNOWN", "error"]]);
  });

  it("subtes di item fleksibel ikut diperiksa", () => {
    const d = dist(12);
    if (d.status === "found") {
      d.items.push({
        scopeType: "program", scopeId: "p1", subtestId: null, flexibleSubtestIds: ["a", "b"],
        label: "PM/PK Flexible", sessionsPerWeek: 1, sortOrder: 1,
      });
    }
    expect(codes({ distribution: d })).toEqual(["DISTRIBUTION_SUBTEST_INACTIVE"]);
  });
});
