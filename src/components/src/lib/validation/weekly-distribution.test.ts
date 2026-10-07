import { describe, expect, it } from "vitest";
import type { Requirement } from "../scheduler/types";
import type { DatedSession } from "./expand";
import { checkWeeklyDistribution } from "./weekly-distribution";

const req = (id: string, allowed: string[], sessions: number, label = allowed.join("/")): Requirement => ({
  id, rombelId: "r1", allowedSubtestIds: allowed, label, sessions,
});
const sess = (date: string, subtestId: string, slotNo = 1): DatedSession => ({
  sessionDate: date, slotNo, rombelId: "r1", subtestId, tutorId: "t", roomId: "k",
});
// Minggu penuh 2-8 Nov 2026 (Senin-Minggu), periode 2 minggu: 2-15 Nov.
const base = { periodStart: "2026-11-02", periodEnd: "2026-11-15", rombelIds: ["r1"] };

describe("checkWeeklyDistribution", () => {
  it("jadwal sesuai kebutuhan di setiap minggu = tanpa isu", () => {
    const requirements = [req("a", ["pm"], 2), req("b", ["pk"], 1)];
    const sessions = [
      sess("2026-11-02", "pm", 1), sess("2026-11-03", "pm", 1), sess("2026-11-04", "pk", 1),
      sess("2026-11-09", "pm", 1), sess("2026-11-10", "pm", 1), sess("2026-11-11", "pk", 1),
    ];
    expect(checkWeeklyDistribution({ ...base, sessions, requirements })).toEqual([]);
  });

  it("minggu lengkap kurang sesi = SHORTFALL; kelebihan = EXCESS", () => {
    const requirements = [req("a", ["pm"], 2)];
    const sessions = [
      sess("2026-11-02", "pm"), // minggu 1: kurang 1
      sess("2026-11-09", "pm"), sess("2026-11-10", "pm"), sess("2026-11-11", "pm"), // minggu 2: lebih 1
    ];
    const issues = checkWeeklyDistribution({ ...base, sessions, requirements });
    expect(issues).toEqual([
      { rombelId: "r1", weekStart: "2026-11-02", kind: "SHORTFALL", label: "pm", count: 1, complete: true },
      { rombelId: "r1", weekStart: "2026-11-09", kind: "EXCESS", label: "pm", count: 1, complete: true },
    ]);
  });

  it("subtes di luar distribusi dilaporkan sebagai EXCESS", () => {
    const issues = checkWeeklyDistribution({
      ...base, requirements: [req("a", ["pm"], 1)],
      sessions: [sess("2026-11-02", "pm"), sess("2026-11-03", "lbi"), sess("2026-11-09", "pm")],
    });
    expect(issues).toEqual([{ rombelId: "r1", weekStart: "2026-11-02", kind: "EXCESS", label: "lbi", count: 1, complete: true }]);
  });

  it("minggu parsial: kekurangan tidak dilaporkan, kelebihan tetap", () => {
    // Periode 4 Nov (Rabu) - 10 Nov (Selasa): kedua minggu parsial.
    const parsial = { periodStart: "2026-11-04", periodEnd: "2026-11-10", rombelIds: ["r1"] };
    const requirements = [req("a", ["pm"], 2)];
    expect(checkWeeklyDistribution({ ...parsial, requirements, sessions: [sess("2026-11-04", "pm")] })).toEqual([]);
    const lebih = checkWeeklyDistribution({
      ...parsial, requirements,
      sessions: [sess("2026-11-04", "pm"), sess("2026-11-05", "pm"), sess("2026-11-06", "pm")],
    });
    expect(lebih).toEqual([{ rombelId: "r1", weekStart: "2026-11-02", kind: "EXCESS", label: "pm", count: 1, complete: false }]);
  });

  it("item fleksibel diisi sisa sesi subtes yang diizinkan", () => {
    const requirements = [req("a", ["pm"], 1), req("f", ["kmm", "ppu"], 1, "KMM/PPU Flexible")];
    const weekOf = (d: string[]) => d.map((x, i) => sess(x, i === 0 ? "pm" : "ppu"));
    const ok = [...weekOf(["2026-11-02", "2026-11-03"]), ...weekOf(["2026-11-09", "2026-11-10"])];
    expect(checkWeeklyDistribution({ ...base, requirements, sessions: ok })).toEqual([]);
    // Minggu 1 tanpa sesi fleksibel: SHORTFALL pada label fleksibel.
    const kurang = checkWeeklyDistribution({
      ...base, requirements, sessions: [sess("2026-11-02", "pm"), ...weekOf(["2026-11-09", "2026-11-10"])],
    });
    expect(kurang).toEqual([{ rombelId: "r1", weekStart: "2026-11-02", kind: "SHORTFALL", label: "KMM/PPU Flexible", count: 1, complete: true }]);
    // Sesi subtes yang TIDAK diizinkan fleksibel bukan pengisi: kekurangan + kelebihan.
    const salah = checkWeeklyDistribution({
      ...base, requirements, sessions: [sess("2026-11-02", "pm"), sess("2026-11-03", "lbi"), ...weekOf(["2026-11-09", "2026-11-10"])],
    });
    expect(salah.map((i) => `${i.kind}:${i.label}`).sort()).toEqual(["EXCESS:lbi", "SHORTFALL:KMM/PPU Flexible"]);
  });

  it("himpunan fleksibel tumpang tindih dicocokkan optimal (bukan greedy)", () => {
    // f1 boleh {a,b}; f2 boleh {a}. Sisa sesi: a dan b. Greedy bisa memberi a ke f1 lalu f2 kosong.
    const requirements = [req("f1", ["a", "b"], 1, "F1"), req("f2", ["a"], 1, "F2")];
    // f2 hanya 1 subtes -> dianggap item biasa (a: butuh 1). Gunakan dua fleksibel nyata:
    const reqs2 = [req("f1", ["a", "b"], 1, "F1"), req("f2", ["a", "c"], 1, "F2")];
    const sessions = [sess("2026-11-02", "a"), sess("2026-11-03", "b"), sess("2026-11-09", "a"), sess("2026-11-10", "b")];
    // Minggu 1: sisa a,b ; f1 butuh {a,b}, f2 butuh {a,c}: cocok optimal f1<-b, f2<-a.
    expect(checkWeeklyDistribution({ ...base, requirements: reqs2, sessions })).toEqual([]);
    void requirements;
  });

  it("jendela rombel: minggu di luar jendela dilewati dan minggu parsial tidak dihitung lengkap", () => {
    const requirements = [req("a", ["pm"], 2)];
    const windows = new Map([["r1", { start: "2026-11-09", end: null }]]);
    // Minggu 1 di luar jendela: tidak ada isu walau kosong. Minggu 2 lengkap dan kurang 1.
    const issues = checkWeeklyDistribution({ ...base, requirements, windows, sessions: [sess("2026-11-09", "pm")] });
    expect(issues).toEqual([{ rombelId: "r1", weekStart: "2026-11-09", kind: "SHORTFALL", label: "pm", count: 1, complete: true }]);
  });

  it("rombel tanpa kebutuhan dilewati; periode terbalik menghasilkan kosong", () => {
    expect(checkWeeklyDistribution({ ...base, requirements: [], sessions: [sess("2026-11-02", "pm")] })).toEqual([]);
    const windows = new Map([["r1", { start: "2027-01-01", end: null }]]);
    expect(checkWeeklyDistribution({ ...base, windows, requirements: [req("a", ["pm"], 1)], sessions: [] })).toEqual([]);
  });
});
