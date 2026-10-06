import { describe, expect, it } from "vitest";
import { buildConfigOverview } from "./overview";
import type { DistributionItem } from "./distribution";
import type { SettingRow } from "./resolver";

const set = (key: string, scopeType: SettingRow["scopeType"], scopeId: string | null, value: number): SettingRow => ({
  key, scopeType, scopeId, dayOfWeek: null, value,
});
const di = (scopeType: DistributionItem["scopeType"], scopeId: string, subtestId: string, n: number): DistributionItem => ({
  scopeType, scopeId, subtestId, flexibleSubtestIds: [], label: null, sessionsPerWeek: n, sortOrder: 0,
});

const input = {
  programs: [{ id: "p1", name: "P" }],
  classTypes: [
    { id: "c1", programId: "p1", name: "C1", isActive: true },
    { id: "c2", programId: "p1", name: "C2", isActive: false },
  ],
  rombels: [
    { id: "r1", classTypeId: "c1", name: "R1", isActive: true },
    { id: "r2", classTypeId: "c1", name: "R2", isActive: true },
    { id: "r3", classTypeId: "c1", name: "R3", isActive: false },
  ],
  settings: [set("sessions_per_day", "class_type", "c1", 2), set("sessions_per_day", "rombel", "r1", 3), set("weekly_sessions", "program", "p1", 4)],
  distributionItems: [di("program", "p1", "a", 4)],
  subtests: [{ id: "a", code: "PM", name: "PM", isActive: true }],
  activeDayCount: 6,
  activeSlotCount: 8,
};

describe("buildConfigOverview", () => {
  const o = buildConfigOverview(input);

  it("hanya tipe kelas dan rombel aktif", () => {
    expect([...o.classTypes.keys()]).toEqual(["c1"]);
    expect([...o.rombels.keys()].sort()).toEqual(["r1", "r2"]);
  });

  it("override rombel menang; rombel lain mewarisi tipe kelas", () => {
    const r1 = o.rombels.get("r1")!.sessionsPerDay;
    const r2 = o.rombels.get("r2")!.sessionsPerDay;
    expect(r1.status === "found" && [r1.value, r1.source.scopeType]).toEqual([3, "rombel"]);
    expect(r2.status === "found" && [r2.value, r2.source.scopeType]).toEqual([2, "class_type"]);
  });

  it("distribusi dan total mingguan diwarisi dari program; konsisten = tanpa masalah", () => {
    const e = o.classTypes.get("c1")!;
    expect(e.distribution.status === "found" && e.distribution.scopeType).toBe("program");
    expect(e.issues).toEqual([]);
  });

  it("discrepancy terdeteksi setelah distribusi diubah", () => {
    const o2 = buildConfigOverview({ ...input, distributionItems: [di("program", "p1", "a", 5)] });
    expect(o2.classTypes.get("c1")!.issues.map((i) => i.code)).toEqual(["DISTRIBUTION_MISMATCH"]);
  });
});
