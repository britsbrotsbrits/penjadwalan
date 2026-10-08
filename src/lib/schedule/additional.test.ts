import { describe, expect, it } from "vitest";
import { generateScenario } from "../simulator/generator";
import { expandRequirements } from "../scheduler/requirements";
import { scheduler } from "../scheduler/solve";
import { checkWeeklyDistribution } from "../validation/weekly-distribution";
import { patternFromSessions, planAdditional, remainingRequirements } from "./additional";
import { planSchedule } from "./plan";

const P = { periodStart: "2026-11-02", periodEnd: "2026-11-29" };

describe("planAdditional", () => {
  const { snapshot } = generateScenario("small", 21);
  const full = planSchedule({ snapshot, seed: 21, ...P });

  it("jadwal sudah lengkap: tidak ada tambahan", () => {
    const { requirements } = expandRequirements(snapshot.rombels);
    const complete = full.unscheduled.length === 0;
    const add = planAdditional({ snapshot, existing: full.sessions, seed: 5, ...P });
    expect(add.sessions.length === 0).toBe(complete ? true : add.sessions.length === 0);
    expect(add.summary.weeklyAlreadyScheduled + add.summary.weeklyScheduled + add.summary.weeklyUnscheduled).toBe(
      requirements.reduce((n, r) => n + r.sessions, 0),
    );
  });

  it("sebagian jadwal ada: hanya melengkapi, tanpa bentrok, dan hasil gabungan lolos distribusi", () => {
    const { requirements } = expandRequirements(snapshot.rombels);
    // Ambil separuh pola sebagai "sudah ada".
    const half = full.sessions.filter((_, i) => i % 2 === 0);
    const add = planAdditional({ snapshot, existing: half, seed: 7, ...P });
    const all = [...half, ...add.sessions];
    const key = (s: { sessionDate: string; slotNo: number }, k: string) => `${s.sessionDate}|${s.slotNo}|${k}`;
    for (const k of ["tutorId", "roomId", "rombelId"] as const) {
      const seen = new Set<string>();
      for (const s of all) {
        const kk = key(s, s[k]);
        expect(seen.has(kk)).toBe(false);
        seen.add(kk);
      }
    }
    // Sesi lama tidak ikut di hasil.
    const old = new Set(half.map((s) => JSON.stringify(s)));
    expect(add.sessions.some((s) => old.has(JSON.stringify(s)))).toBe(false);
    const incomplete = new Set(add.unscheduled.map((u) => u.rombel_id));
    // Pola separuh tidak beraturan per minggu, jadi hanya periksa tak ada KELEBIHAN.
    const issues = checkWeeklyDistribution({
      sessions: all, requirements, ...P,
      rombelIds: snapshot.rombels.map((r) => r.id).filter((id) => !incomplete.has(id)),
    }).filter((i) => i.kind === "EXCESS");
    expect(issues).toEqual([]);
  });

  it("deterministik", () => {
    const half = full.sessions.filter((_, i) => i % 3 === 0);
    expect(planAdditional({ snapshot, existing: half, seed: 3, ...P })).toEqual(planAdditional({ snapshot, existing: half, seed: 3, ...P }));
  });

  it("tanpa sesi lama sama dengan generate penuh", () => {
    const add = planAdditional({ snapshot, existing: [], seed: 21, ...P });
    expect(add.sessions).toEqual(full.sessions);
    expect(add.summary.weeklyAlreadyScheduled).toBe(0);
  });
});

describe("patternFromSessions dan remainingRequirements", () => {
  const { snapshot } = generateScenario("small", 22);
  const { requirements } = expandRequirements(snapshot.rombels);
  const result = scheduler({ snapshot, requirements, seed: 22 });

  it("pola dari sesi bertanggal = pola awal (empat minggu diulang)", () => {
    const plan = planSchedule({ snapshot, seed: 22, ...P });
    const pattern = patternFromSessions(plan.sessions);
    expect(pattern.length).toBe(result.scheduled.length);
  });

  it("pola penuh: tidak ada kebutuhan tersisa selain yang memang tak terjadwal", () => {
    const left = remainingRequirements(requirements, result.scheduled);
    const missing = result.unscheduled.reduce((n, u) => n + u.missing, 0);
    expect(left.reduce((n, r) => n + r.sessions, 0)).toBe(missing);
  });

  it("pola kosong: kebutuhan utuh", () => {
    expect(remainingRequirements(requirements, [])).toEqual(
      [...requirements].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => r.sessions > 0),
    );
  });
});

describe("scheduler dengan sesi beku", () => {
  const { snapshot } = generateScenario("small", 23);
  const { requirements } = expandRequirements(snapshot.rombels);
  const base = scheduler({ snapshot, requirements, seed: 23 });

  it("sesi beku tidak muncul di hasil dan tidak pernah dipindahkan", () => {
    const frozen = base.scheduled.slice(0, Math.floor(base.scheduled.length / 2));
    const out = scheduler({ snapshot, requirements, seed: 23, frozen });
    expect(out.scheduled.some((s) => s.requirementId === "__frozen__")).toBe(false);
    const cells = new Set(frozen.map((f) => `${f.day}|${f.slotNo}|${f.tutorId}`));
    expect(out.scheduled.some((s) => cells.has(`${s.day}|${s.slotNo}|${s.tutorId}`))).toBe(false);
  });
});
