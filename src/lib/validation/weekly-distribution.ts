import type { Requirement } from "../scheduler/types";
import { addDays, diffDays, weekStart } from "./dates";
import type { DatedSession, RombelWindow } from "./expand";

/**
 * Pemeriksaan distribusi subtes per minggu pada jadwal bertanggal. Murni.
 *
 * Minggu LENGKAP (Senin-Minggu seluruhnya ada di dalam periode): jumlah sesi tiap subtes harus tepat
 * sama dengan kebutuhan (kurang = SHORTFALL, lebih atau subtes di luar distribusi = EXCESS).
 * Minggu PARSIAL (di tepi periode): hanya kelebihan yang dilaporkan, karena kekurangan di minggu
 * parsial wajar (sebagian harinya di luar periode).
 * Item fleksibel (mis. KMM/PPU) diisi oleh sisa sesi subtes yang diizinkan; pencocokan dilakukan
 * dengan augmenting path (bukan greedy) supaya himpunan fleksibel yang saling tumpang tindih benar.
 */

export type WeeklyIssue = {
  rombelId: string;
  weekStart: string;
  kind: "SHORTFALL" | "EXCESS";
  /** Label kebutuhan (item distribusi) atau id subtes untuk kelebihan. */
  label: string;
  count: number;
  complete: boolean;
};

type Slot = { label: string; allowed: Set<string> };

/** Pencocokan bipartit maksimum: unit sesi sisa (subtes) ke slot fleksibel. Mengembalikan jumlah cocok. */
function matchFlex(units: string[], slots: Slot[]): { matchedSlot: boolean[]; matchedUnit: boolean[] } {
  const slotOfUnit: number[] = new Array(slots.length).fill(-1); // slot -> unit
  const matchedUnit: boolean[] = new Array(units.length).fill(false);

  const tryUnit = (u: number, seen: boolean[]): boolean => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !slots[s]!.allowed.has(units[u]!)) continue;
      seen[s] = true;
      if (slotOfUnit[s] === -1 || tryUnit(slotOfUnit[s]!, seen)) {
        slotOfUnit[s] = u;
        return true;
      }
    }
    return false;
  };
  for (let u = 0; u < units.length; u++) tryUnit(u, new Array(slots.length).fill(false));
  const matchedSlot = slotOfUnit.map((u) => u !== -1);
  slotOfUnit.forEach((u) => {
    if (u !== -1) matchedUnit[u] = true;
  });
  return { matchedSlot, matchedUnit };
}

export function checkWeeklyDistribution(input: {
  sessions: readonly DatedSession[];
  requirements: readonly Requirement[];
  periodStart: string;
  periodEnd: string;
  /** Rombel yang diperiksa. Rombel tanpa kebutuhan sama sekali dilewati. */
  rombelIds: readonly string[];
  /** Jendela tanggal rombel; minggu dihitung "lengkap" hanya bila seluruhnya di dalam periode DAN jendela. */
  windows?: ReadonlyMap<string, RombelWindow>;
}): WeeklyIssue[] {
  const { sessions, requirements, periodStart, periodEnd } = input;
  const issues: WeeklyIssue[] = [];

  const reqByRombel = new Map<string, Requirement[]>();
  for (const r of requirements) {
    const list = reqByRombel.get(r.rombelId) ?? [];
    list.push(r);
    reqByRombel.set(r.rombelId, list);
  }

  // Kelompokkan sesi per rombel per minggu.
  const bucket = new Map<string, Map<string, DatedSession[]>>();
  for (const s of sessions) {
    const wk = weekStart(s.sessionDate);
    let byWeek = bucket.get(s.rombelId);
    if (!byWeek) bucket.set(s.rombelId, (byWeek = new Map()));
    const list = byWeek.get(wk) ?? [];
    list.push(s);
    byWeek.set(wk, list);
  }

  for (const rombelId of input.rombelIds) {
    const reqs = reqByRombel.get(rombelId);
    if (!reqs || reqs.length === 0) continue;

    // Rentang efektif = periode dipotong jendela rombel.
    const w = input.windows?.get(rombelId);
    const effStart = w?.start && w.start > periodStart ? w.start : periodStart;
    const effEnd = w?.end && w.end < periodEnd ? w.end : periodEnd;
    if (effStart > effEnd) continue;
    const weeks: string[] = [];
    for (let wk = weekStart(effStart); diffDays(wk, effEnd) >= 0; wk = addDays(wk, 7)) weeks.push(wk);

    const normal = new Map<string, { label: string; need: number }>();
    const flex: Slot[] = [];
    for (const r of reqs) {
      if (r.allowedSubtestIds.length === 1) {
        const id = r.allowedSubtestIds[0]!;
        const cur = normal.get(id);
        normal.set(id, { label: cur ? cur.label : r.label, need: (cur?.need ?? 0) + r.sessions });
      } else {
        for (let i = 0; i < r.sessions; i++) flex.push({ label: r.label, allowed: new Set(r.allowedSubtestIds) });
      }
    }

    for (const wk of weeks) {
      const complete = diffDays(effStart, wk) >= 0 && diffDays(addDays(wk, 6), effEnd) >= 0;
      const list = bucket.get(rombelId)?.get(wk) ?? [];
      const actual = new Map<string, number>();
      for (const s of list) actual.set(s.subtestId, (actual.get(s.subtestId) ?? 0) + 1);

      const surplusUnits: string[] = [];
      for (const [subtestId, n] of actual) {
        const need = normal.get(subtestId)?.need ?? 0;
        for (let i = 0; i < Math.max(0, n - need); i++) surplusUnits.push(subtestId);
      }
      for (const [subtestId, { label, need }] of normal) {
        const short = need - (actual.get(subtestId) ?? 0);
        if (short > 0 && complete) issues.push({ rombelId, weekStart: wk, kind: "SHORTFALL", label, count: short, complete });
      }

      const { matchedSlot, matchedUnit } = matchFlex(surplusUnits, flex);
      if (complete) {
        const missingByLabel = new Map<string, number>();
        flex.forEach((slot, i) => {
          if (!matchedSlot[i]) missingByLabel.set(slot.label, (missingByLabel.get(slot.label) ?? 0) + 1);
        });
        for (const [label, count] of missingByLabel) issues.push({ rombelId, weekStart: wk, kind: "SHORTFALL", label, count, complete });
      }
      const excessBySubtest = new Map<string, number>();
      surplusUnits.forEach((subtestId, i) => {
        if (!matchedUnit[i]) excessBySubtest.set(subtestId, (excessBySubtest.get(subtestId) ?? 0) + 1);
      });
      for (const [subtestId, count] of excessBySubtest) {
        issues.push({ rombelId, weekStart: wk, kind: "EXCESS", label: subtestId, count, complete });
      }
    }
    // Subtes di luar distribusi sama sekali sudah masuk surplus (need = 0) -> EXCESS di atas.
  }
  return issues;
}
