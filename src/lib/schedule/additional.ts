import { expandRequirements } from "../scheduler/requirements";
import { scheduler as defaultScheduler } from "../scheduler/solve";
import type { Requirement, ScheduledSession, SchedulerFn, SchedulingSnapshot } from "../scheduler/types";
import { isoDow } from "../validation/dates";
import { expandWeeklyPattern, type DatedSession, type RombelWindow } from "../validation/expand";
import { matchFlex, type Slot } from "../validation/weekly-distribution";
import type { PlanSummary, SchedulePlan, UnscheduledRow } from "./plan";

/**
 * Generate Additional (Phase 11). Murni.
 * Sesi yang SUDAH ADA dijadikan pola mingguan (hari x sesi) dan dibekukan sebagai hunian;
 * kebutuhan dikurangi sesi yang sudah ada; scheduler hanya mengisi sisanya. Sesi lama tidak pernah
 * disentuh: hasilnya hanya sesi tambahan. Pola dipakai konservatif: sel (hari, sesi) yang dipakai
 * sesi lama pada tanggal mana pun dianggap terisi untuk tutor, ruangan, dan rombel itu.
 */

/** Pola mingguan unik dari sesi bertanggal (satu entri per rombel/hari/sesi/subtes/tutor/ruangan). */
export function patternFromSessions(sessions: readonly DatedSession[]): ScheduledSession[] {
  const seen = new Map<string, ScheduledSession>();
  for (const s of sessions) {
    const day = isoDow(s.sessionDate);
    const key = [s.rombelId, day, s.slotNo, s.subtestId, s.tutorId, s.roomId].join("|");
    if (!seen.has(key)) {
      seen.set(key, { requirementId: "", rombelId: s.rombelId, subtestId: s.subtestId, tutorId: s.tutorId, roomId: s.roomId, day, slotNo: s.slotNo });
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.day - b.day || a.slotNo - b.slotNo || a.rombelId.localeCompare(b.rombelId) || a.subtestId.localeCompare(b.subtestId),
  );
}

/**
 * Kebutuhan per minggu yang MASIH kurang setelah memperhitungkan pola yang ada.
 * Item biasa dikurangi sesi subtes itu; sisa sesi (kelebihan) dicocokkan ke item fleksibel.
 * Kebutuhan yang sudah terpenuhi dibuang.
 */
export function remainingRequirements(requirements: readonly Requirement[], pattern: readonly ScheduledSession[]): Requirement[] {
  const have = new Map<string, Map<string, number>>(); // rombel -> subtes -> jumlah per minggu
  for (const p of pattern) {
    const m = have.get(p.rombelId) ?? new Map<string, number>();
    m.set(p.subtestId, (m.get(p.subtestId) ?? 0) + 1);
    have.set(p.rombelId, m);
  }
  const byRombel = new Map<string, Requirement[]>();
  for (const r of requirements) byRombel.set(r.rombelId, [...(byRombel.get(r.rombelId) ?? []), r]);

  const out: Requirement[] = [];
  for (const [rombelId, reqs] of byRombel) {
    const left = new Map(have.get(rombelId) ?? []);
    const remaining = new Map<string, number>();
    // 1. item biasa memakai sesi subtesnya sendiri
    for (const r of reqs) {
      if (r.allowedSubtestIds.length !== 1) continue;
      const sub = r.allowedSubtestIds[0]!;
      const use = Math.min(r.sessions, left.get(sub) ?? 0);
      left.set(sub, (left.get(sub) ?? 0) - use);
      remaining.set(r.id, r.sessions - use);
    }
    // 2. sisa sesi mengisi item fleksibel (pencocokan maksimum)
    const slots: Slot[] = [];
    const slotReq: string[] = [];
    for (const r of reqs) {
      if (r.allowedSubtestIds.length === 1) continue;
      for (let i = 0; i < r.sessions; i++) {
        slots.push({ label: r.label, allowed: new Set(r.allowedSubtestIds) });
        slotReq.push(r.id);
      }
    }
    const units: string[] = [];
    for (const [sub, n] of left) for (let i = 0; i < n; i++) units.push(sub);
    const { matchedSlot } = matchFlex(units, slots);
    for (const r of reqs) {
      if (r.allowedSubtestIds.length === 1) continue;
      let filled = 0;
      slotReq.forEach((id, i) => {
        if (id === r.id && matchedSlot[i]) filled += 1;
      });
      remaining.set(r.id, r.sessions - filled);
    }
    for (const r of reqs) {
      const n = remaining.get(r.id) ?? 0;
      if (n > 0) out.push({ ...r, sessions: n });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export type AdditionalPlan = SchedulePlan & { summary: PlanSummary & { weeklyAlreadyScheduled: number } };

export function planAdditional(input: {
  snapshot: SchedulingSnapshot;
  existing: readonly DatedSession[];
  seed: number;
  periodStart: string;
  periodEnd: string;
  windows?: ReadonlyMap<string, RombelWindow>;
  scheduler?: SchedulerFn;
}): AdditionalPlan {
  const { snapshot, seed } = input;
  const { requirements, issues } = expandRequirements(snapshot.rombels);
  const frozen = patternFromSessions(input.existing);
  const needed = remainingRequirements(requirements, frozen);
  const run = input.scheduler ?? defaultScheduler;
  const result = needed.length > 0 ? run({ snapshot, requirements: needed, seed, frozen }) : { scheduled: [], unscheduled: [] };

  const reqById = new Map(needed.map((r) => [r.id, r]));
  const unscheduled: UnscheduledRow[] = [];
  for (const u of result.unscheduled) {
    const req = reqById.get(u.requirementId);
    if (!req || u.missing <= 0) continue;
    unscheduled.push({
      rombel_id: req.rombelId,
      label: req.label,
      subtest_ids: [...req.allowedSubtestIds],
      missing_per_week: u.missing,
      reason_code: u.reason,
      detail: u.detail ?? null,
    });
  }
  const sessions = expandWeeklyPattern(result.scheduled, input.periodStart, input.periodEnd, input.windows);
  const weeklyRequired = requirements.reduce((n, r) => n + r.sessions, 0);
  const weeklyNeeded = needed.reduce((n, r) => n + r.sessions, 0);
  return {
    sessions,
    unscheduled,
    summary: {
      seed,
      weeklyRequired,
      weeklyAlreadyScheduled: weeklyRequired - weeklyNeeded,
      weeklyScheduled: result.scheduled.length,
      weeklyUnscheduled: unscheduled.reduce((n, u) => n + u.missing_per_week, 0),
      datedSessions: sessions.length,
      issues,
    },
  };
}
