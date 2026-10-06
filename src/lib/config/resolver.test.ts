import { describe, expect, it } from "vitest";
import { parseConfigValue } from "./keys";
import { describeSource, resolveSetting, type SettingRow } from "./resolver";

const row = (
  scopeType: SettingRow["scopeType"],
  scopeId: string | null,
  value: unknown,
  dayOfWeek: number | null = null,
  key = "sessions_per_day",
): SettingRow => ({ key, scopeType, scopeId, dayOfWeek, value });

const ctx = { programId: "p1", classTypeId: "c1", rombelId: "r1" };

describe("parseConfigValue", () => {
  it("menerima bilangan bulat dalam rentang", () => {
    expect(parseConfigValue("sessions_per_day", 3)).toEqual({ ok: true, value: 3 });
    expect(parseConfigValue("weekly_sessions", 999)).toEqual({ ok: true, value: 999 });
  });
  it("menolak di luar rentang, pecahan, dan bukan angka", () => {
    expect(parseConfigValue("sessions_per_day", 0).ok).toBe(false);
    expect(parseConfigValue("sessions_per_day", 100).ok).toBe(false);
    expect(parseConfigValue("sessions_per_day", 2.5).ok).toBe(false);
    expect(parseConfigValue("sessions_per_day", "3").ok).toBe(false);
    expect(parseConfigValue("sessions_per_day", null).ok).toBe(false);
    expect(parseConfigValue("weekly_sessions", 1000).ok).toBe(false);
  });
});

describe("resolveSetting", () => {
  it("tanpa baris sama sekali = missing (tidak ada angka bawaan di kode)", () => {
    expect(resolveSetting([], "sessions_per_day", ctx)).toEqual({ status: "missing" });
  });

  it("global dipakai bila tidak ada yang lebih spesifik", () => {
    const r = resolveSetting([row("global", null, 2)], "sessions_per_day", ctx);
    expect(r).toEqual({ status: "found", value: 2, source: { scopeType: "global", scopeId: null, dayOfWeek: null } });
  });

  it("urutan: program < tipe kelas < rombel < rombel+hari", () => {
    const rows = [
      row("global", null, 1),
      row("program", "p1", 2),
      row("class_type", "c1", 3),
      row("rombel", "r1", 4),
      row("rombel_day", "r1", 5, 2),
    ];
    const v = (c: Parameters<typeof resolveSetting>[2]) => {
      const r = resolveSetting(rows, "sessions_per_day", c);
      return r.status === "found" ? [r.value, r.source.scopeType] : r.status;
    };
    expect(v({ ...ctx, dayOfWeek: 2 })).toEqual([5, "rombel_day"]);
    expect(v({ ...ctx, dayOfWeek: 3 })).toEqual([4, "rombel"]);
    expect(v(ctx)).toEqual([4, "rombel"]);
    expect(v({ programId: "p1", classTypeId: "c1" })).toEqual([3, "class_type"]);
    expect(v({ programId: "p1" })).toEqual([2, "program"]);
    expect(v({})).toEqual([1, "global"]);
  });

  it("contoh master prompt: Junior=2, Junior A=3, Junior B ikut default", () => {
    const rows = [row("class_type", "junior", 2), row("rombel", "junior-a", 3)];
    const a = resolveSetting(rows, "sessions_per_day", { classTypeId: "junior", rombelId: "junior-a" });
    const b = resolveSetting(rows, "sessions_per_day", { classTypeId: "junior", rombelId: "junior-b" });
    expect(a.status === "found" && a.value).toBe(3);
    expect(b.status === "found" && b.value).toBe(2);
    expect(b.status === "found" && b.source.scopeType).toBe("class_type");
  });

  it("scope lain, key lain, dan hari lain tidak bocor", () => {
    const rows = [
      row("rombel", "r2", 9),
      row("class_type", "c2", 9),
      row("rombel_day", "r1", 9, 4),
      row("rombel", "r1", 9, null, "weekly_sessions"),
    ];
    expect(resolveSetting(rows, "sessions_per_day", { ...ctx, dayOfWeek: 2 })).toEqual({ status: "missing" });
  });

  it("override hari diabaikan bila konteks tidak punya hari", () => {
    const rows = [row("rombel_day", "r1", 9, 2), row("class_type", "c1", 3)];
    const r = resolveSetting(rows, "sessions_per_day", ctx);
    expect(r.status === "found" && r.value).toBe(3);
  });

  it("nilai tersimpan rusak = invalid, TIDAK jatuh diam-diam ke parent", () => {
    const rows = [row("rombel", "r1", "bukan angka"), row("class_type", "c1", 3)];
    const r = resolveSetting(rows, "sessions_per_day", ctx);
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.source.scopeType).toBe("rombel");
  });
});

describe("describeSource", () => {
  it("menamai level", () => {
    expect(describeSource({ scopeType: "class_type", scopeId: "c", dayOfWeek: null })).toBe("tipe kelas");
    expect(describeSource({ scopeType: "rombel_day", scopeId: "r", dayOfWeek: 3 })).toBe("rombel per hari (hari 3)");
  });
});
