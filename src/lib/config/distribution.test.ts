import { describe, expect, it } from "vitest";
import { resolveDistribution, totalSessions, type DistributionItem } from "./distribution";

const item = (
  scopeType: DistributionItem["scopeType"],
  scopeId: string,
  subtestId: string | null,
  n: number,
  sortOrder = 0,
): DistributionItem => ({
  scopeType,
  scopeId,
  subtestId,
  flexibleSubtestIds: subtestId ? [] : ["a", "b"],
  label: subtestId ? null : "Flex",
  sessionsPerWeek: n,
  sortOrder,
});

describe("resolveDistribution", () => {
  const items = [
    item("program", "p1", "a", 1, 2),
    item("program", "p1", "b", 3, 1),
    item("class_type", "c1", "a", 5),
    item("rombel", "r1", "b", 7),
  ];

  it("tanpa item = missing", () => {
    expect(resolveDistribution([], { programId: "p1" })).toEqual({ status: "missing" });
    expect(resolveDistribution(items, { programId: "lain" })).toEqual({ status: "missing" });
    expect(resolveDistribution(items, {})).toEqual({ status: "missing" });
  });

  it("scope terdekat yang punya item menang, sebagai satu kesatuan (tidak digabung)", () => {
    const r = resolveDistribution(items, { programId: "p1", classTypeId: "c1", rombelId: "r1" });
    expect(r.status === "found" && [r.scopeType, r.total, r.items.length]).toEqual(["rombel", 7, 1]);
    const c = resolveDistribution(items, { programId: "p1", classTypeId: "c1", rombelId: "r2" });
    expect(c.status === "found" && [c.scopeType, c.total]).toEqual(["class_type", 5]);
    const p = resolveDistribution(items, { programId: "p1", classTypeId: "c2" });
    expect(p.status === "found" && [p.scopeType, p.total, p.items.length]).toEqual(["program", 4, 2]);
  });

  it("item diurutkan menurut sortOrder", () => {
    const r = resolveDistribution(items, { programId: "p1" });
    expect(r.status === "found" && r.items.map((i) => i.subtestId)).toEqual(["b", "a"]);
  });

  it("baseline Gap Year: total 12 dihitung dari item, bukan angka tetap", () => {
    const gy = [
      ["kmm", 1], ["ppu", 1], [null, 1], ["pm", 2], ["pk", 3], ["pu", 2], ["lbi", 1], ["lbe", 1],
    ].map(([s, n], i) => item("program", "gy", s as string | null, n as number, i));
    expect(totalSessions(gy)).toBe(12);
    expect(gy.filter((i) => i.subtestId === null)).toHaveLength(1);
    const edited = gy.map((i) => (i.subtestId === "pm" ? { ...i, sessionsPerWeek: 4 } : i));
    expect(totalSessions(edited)).toBe(14);
  });
});
