import { DEFAULT_WEIGHTS, searchPlacement, type Candidate, type SchedulerWeights } from "./candidates";
import { planRombelCells, type PlannedUnit } from "./classplan";
import { explainFailure } from "./explain";
import { Rng } from "./rng";
import { buildContext, cellKey, gapsOf, ScheduleState, type SchedContext } from "./state";
import type { Requirement, ScheduledSession, SchedulerFn, SchedulerInput, SchedulerResult, UnscheduledItem } from "./types";

/**
 * Scheduler constraint-based (pipeline di docs/phase-0/02 bagian 5). Murni dan deterministik:
 * input dan seed yang sama = hasil yang sama.
 *   1. urutkan kebutuhan most-constrained-first
 *   2. tiap sesi: filter kandidat (hard) -> skor (soft) -> pilih terbaik, acak berseed di antara skor setara
 *   3. buntu -> repair terbatas (pindahkan satu sesi penghalang ke sel lain), tidak pernah melanggar hard constraint
 *   4. sisa dilaporkan sebagai unscheduled dengan alasan terstruktur
 * Tidak pernah menjadwalkan sesi yang melanggar hard constraint; lebih baik tidak terjadwal dan dijelaskan.

 * Phase 14 (class-first): rombel berpola (SMA: satu sesi tetap; Gap Year: SUBTEST/DRILLING/SUBTEST) disusun
 * dulu sebagai jadwal kelas (classplan.ts) sehingga distribusi subtes tidak dikorbankan; baru kemudian mentor
 * dicocokkan per sel (kompeten -> tersedia -> tidak bentrok -> paling pas). Bila mentor tidak ada, urutan
 * perbaikan: ganti mentor sesi penghalang, lalu tukar sel di dalam rombel itu sendiri. Rombel tanpa pola tetap
 * memakai cara lama. Terakhir, optimasi jadwal mentor agar berurutan (jeda kosong minimal) tanpa melanggar aturan wajib.
 * Sesi beku (`frozen`) dipakai Generate Additional (Phase 11). Yang belum ada (fase berikutnya): combined session (TBD-01), preferensi/permintaan tutor, bobot seniority (arti level belum didefinisikan).
 */

export type SchedulerOptions = {
  weights?: Partial<SchedulerWeights>;
  /** Total percobaan memindahkan sesi penghalang selama satu run (batas waktu). 0 = tanpa repair. */
  repairBudget?: number;
};

export const DEFAULT_REPAIR_BUDGET = 10000;

/** Penanda sesi beku: tidak ada di daftar kebutuhan, sehingga repair tidak pernah memindahkannya. */
export const FROZEN_REQUIREMENT_ID = "__frozen__";

function toSession(req: Requirement, c: Candidate): ScheduledSession {
  return {
    requirementId: req.id,
    rombelId: req.rombelId,
    subtestId: c.subtestId,
    tutorId: c.tutorId,
    roomId: c.roomId,
    day: c.day,
    slotNo: c.slotNo,
  };
}

/** Urutan most-constrained-first: kebutuhan/pasokan tertinggi dulu, lalu rombel besar, lalu sesi banyak. */
export function orderRequirements(ctx: SchedContext, requirements: readonly Requirement[]): Requirement[] {
  const tightness = new Map<string, number>();
  for (const req of requirements) {
    const pool = new Set<string>();
    for (const sub of req.allowedSubtestIds) for (const t of ctx.tutorsBySubtest.get(sub) ?? []) pool.add(t.id);
    let supply = 0;
    for (const id of pool) supply += ctx.tutorCells.get(id)?.size ?? 0;
    tightness.set(req.id, req.sessions / Math.max(1, supply));
  }
  const size = (r: Requirement) => ctx.rombelById.get(r.rombelId)?.studentCount ?? 0;
  return [...requirements].sort(
    (a, b) =>
      tightness.get(b.id)! - tightness.get(a.id)! ||
      size(b) - size(a) ||
      b.sessions - a.sessions ||
      a.id.localeCompare(b.id),
  );
}

export function createScheduler(options: SchedulerOptions = {}): SchedulerFn {
  const weights: SchedulerWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const repairBudget = options.repairBudget ?? DEFAULT_REPAIR_BUDGET;

  return ({ snapshot, requirements, seed, frozen }: SchedulerInput): SchedulerResult => {
    const ctx = buildContext(snapshot, requirements);
    const state = new ScheduleState(snapshot.slotNos);
    const rng = new Rng(seed);
    for (const f of frozen ?? []) state.add({ ...f, requirementId: FROZEN_REQUIREMENT_ID });
    let budget = repairBudget;

    const patterned = (rombelId: string) => ctx.patternCells.has(rombelId);

    const place = (req: Requirement, excludeCell?: string) => {
      const found = searchPlacement(ctx, state, req, { weights, rng, excludeCell });
      if (found.best) state.add(toSession(req, found.best));
      return found;
    };

    /**
     * Repair depth-1: untuk sel di mana rombel bebas tetapi tutor/ruangan terpakai, pindahkan SATU
     * sesi penghalang ke sel lain, lalu tempatkan sesi baru di sel itu. Semua langkah diperiksa dengan
     * pencarian hard-constraint yang sama; bila gagal di tengah jalan, semuanya dikembalikan.
     */
    const repair = (req: Requirement): boolean => {
      for (const cell of ctx.cells) {
        if (budget <= 0) return false;
        const target = cell.key;
        const blockers = [...(state.byCell.get(target) ?? [])];
        for (const id of blockers) {
          if (budget <= 0) return false;
          budget -= 1;
          const moved = state.remove(id);
          const movedReq = ctx.reqById.get(moved.requirementId);
          const fit = searchPlacement(ctx, state, req, { weights, rng: null, onlyCell: target });
          if (!movedReq || patterned(movedReq.rombelId) || !fit.best) {
            state.add(moved);
            continue;
          }
          const newId = state.add(toSession(req, fit.best));
          const relocation = searchPlacement(ctx, state, movedReq, { weights, rng: null, excludeCell: target });
          if (relocation.best) {
            state.add(toSession(movedReq, relocation.best));
            return true;
          }
          state.remove(newId);
          state.add(moved);
        }
      }
      return false;
    };

    // ---- Tahap 1: jadwal kelas untuk rombel berpola (tanpa melihat mentor) ----
    const patternedReqs = requirements.filter((r) => patterned(r.rombelId));
    const legacyReqs = requirements.filter((r) => !patterned(r.rombelId));
    const overflow = new Map<string, number>();
    const units: PlannedUnit[] = [];
    for (const rombel of snapshot.rombels) {
      if (!patterned(rombel.id)) continue;
      const reqs = patternedReqs.filter((r) => r.rombelId === rombel.id);
      if (reqs.length === 0) continue;
      const plan = planRombelCells(ctx, state, rombel.id, reqs, rng);
      units.push(...plan.units);
      for (const o of plan.overflow) overflow.set(o.req.id, o.missing);
    }

    // ---- Tahap 2: cocokkan mentor per sel (paling sedikit pilihan dulu) ----
    const optionCount = (u: PlannedUnit): number => {
      const key = cellKey(u.day, u.slotNo);
      const pool = new Set<string>();
      for (const sub of u.req.allowedSubtestIds) for (const t of ctx.tutorsBySubtest.get(sub) ?? []) pool.add(t.id);
      let n = 0;
      for (const id of pool) if (ctx.tutorCells.get(id)?.has(key)) n += 1;
      return n;
    };
    const rombelSize = (u: PlannedUnit) => ctx.rombelById.get(u.req.rombelId)?.studentCount ?? 0;
    const orderedUnits = units
      .map((u) => ({ u, n: optionCount(u) }))
      .sort((a, b) => a.n - b.n || rombelSize(b.u) - rombelSize(a.u) || cellKey(a.u.day, a.u.slotNo).localeCompare(cellKey(b.u.day, b.u.slotNo)) || a.u.req.id.localeCompare(b.u.req.id))
      .map((x) => x.u);

    const placeAt = (req: Requirement, key: string, withRng: boolean): boolean => {
      const found = searchPlacement(ctx, state, req, { weights, rng: withRng ? rng : null, onlyCell: key });
      if (!found.best) return false;
      state.add(toSession(req, found.best));
      return true;
    };

    /** Ganti mentor sesi penghalang di sel itu dengan mentor lain, supaya mentor yang dibutuhkan bebas. */
    const reassignBlocker = (u: PlannedUnit): boolean => {
      const key = cellKey(u.day, u.slotNo);
      const pool = new Set<string>();
      for (const sub of u.req.allowedSubtestIds) for (const t of ctx.tutorsBySubtest.get(sub) ?? []) pool.add(t.id);
      for (const tutorId of [...pool].sort()) {
        if (budget <= 0) return false;
        if (!ctx.tutorCells.get(tutorId)?.has(key)) continue;
        const blockerId = state.tutorAt.get(`${tutorId}|${key}`);
        if (blockerId === undefined) continue;
        const blocker = state.sessions.get(blockerId)!;
        if (blocker.requirementId === FROZEN_REQUIREMENT_ID) continue;
        budget -= 1;
        const alternatives = (ctx.tutorsBySubtest.get(blocker.subtestId) ?? [])
          .filter((t) => t.id !== tutorId && ctx.tutorCells.get(t.id)?.has(key) && !state.tutorAt.has(`${t.id}|${key}`))
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const alt of alternatives) {
          state.remove(blockerId);
          const reassigned = state.add({ ...blocker, tutorId: alt.id });
          if (placeAt(u.req, key, false)) return true;
          state.remove(reassigned);
          state.add(blocker);
        }
      }
      return false;
    };

    /** Tukar sel di dalam rombel yang sama (distribusi tetap utuh) supaya mentor cocok. */
    const swapWithinRombel = (u: PlannedUnit): boolean => {
      const own = [...(ctx.patternCells.get(u.req.rombelId) ?? [])].sort();
      const here = cellKey(u.day, u.slotNo);
      for (const target of own) {
        if (target === here) continue;
        if (budget <= 0) return false;
        budget -= 1;
        const occupantId = state.rombelAt.get(`${u.req.rombelId}|${target}`);
        if (occupantId === undefined) {
          if (placeAt(u.req, target, false)) return true;
          continue;
        }
        const occupant = state.sessions.get(occupantId)!;
        const occupantReq = ctx.reqById.get(occupant.requirementId);
        if (!occupantReq || occupant.requirementId === FROZEN_REQUIREMENT_ID) continue;
        state.remove(occupantId);
        const found = searchPlacement(ctx, state, u.req, { weights, rng: null, onlyCell: target });
        if (found.best) {
          const newId = state.add(toSession(u.req, found.best));
          if (placeAt(occupantReq, here, false)) return true;
          state.remove(newId);
        }
        state.add(occupant);
      }
      return false;
    };

    const failed: PlannedUnit[] = [];
    for (const u of orderedUnits) {
      if (!placeAt(u.req, cellKey(u.day, u.slotNo), true)) failed.push(u);
    }
    for (const u of failed) {
      if (reassignBlocker(u)) continue;
      swapWithinRombel(u);
    }

    // ---- Rombel tanpa pola: cara lama (sesi bebas, most-constrained-first) ----
    for (const req of orderRequirements(ctx, legacyReqs)) {
      for (let n = 0; n < req.sessions; n++) {
        const result = place(req);
        if (result.best) continue;
        const t = result.tally;
        const structural = t.poolEmpty || t.noRoomFits || t.fixedRoomMissing;
        if (structural || budget <= 0 || !repair(req)) break;
      }
    }

    // ---- Tahap 3: optimasi jadwal mentor agar berurutan (hanya mengganti mentor, kelas tidak berubah) ----
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (const id of [...state.sessions.keys()].sort((a, b) => a - b)) {
        const s0 = state.sessions.get(id);
        if (!s0 || s0.requirementId === FROZEN_REQUIREMENT_ID) continue;
        const key = cellKey(s0.day, s0.slotNo);
        const pos = ctx.slotIndex.get(s0.slotNo) ?? s0.slotNo;
        const listOld = state.tutorDay.get(`${s0.tutorId}|${s0.day}`) ?? [];
        const removeGain = gapsOf(listOld) - gapsOf(listOld.filter((_, i) => i !== listOld.indexOf(pos)));
        let best: { tutorId: string; delta: number } | null = null;
        for (const t of ctx.tutorsBySubtest.get(s0.subtestId) ?? []) {
          if (t.id === s0.tutorId || !ctx.tutorCells.get(t.id)?.has(key) || state.tutorAt.has(`${t.id}|${key}`)) continue;
          const delta = state.gapDeltaIfAdd(t.id, s0.day, s0.slotNo) - removeGain;
          if (delta < 0 && (best === null || delta < best.delta || (delta === best.delta && t.id < best.tutorId))) {
            best = { tutorId: t.id, delta };
          }
        }
        if (best) {
          state.remove(id);
          state.add({ ...s0, tutorId: best.tutorId });
          improved = true;
        }
      }
      if (!improved) break;
    }

    const unscheduled: UnscheduledItem[] = [];
    for (const req of requirements) {
      const missing = req.sessions - state.count(state.perRequirement, req.id);
      if (missing <= 0) continue;
      const over = Math.min(missing, overflow.get(req.id) ?? 0);
      const rest = missing - over;
      if (rest > 0) {
        const diag = searchPlacement(ctx, state, req, { weights, rng: null });
        const why = explainFailure(diag.tally);
        unscheduled.push({ requirementId: req.id, missing: rest, reason: why.reason, detail: why.detail });
      }
      if (over > 0) {
        unscheduled.push({
          requirementId: req.id,
          missing: over,
          reason: "NO_ROMBEL_SLOT",
          detail: "Pola sesi rombel tidak menyediakan sesi subtes yang cukup untuk distribusi ini.",
        });
      }
    }

    const scheduled = [...state.sessions.values()].filter((x) => x.requirementId !== FROZEN_REQUIREMENT_ID).sort(
      (a, b) => a.day - b.day || a.slotNo - b.slotNo || a.rombelId.localeCompare(b.rombelId) || a.requirementId.localeCompare(b.requirementId),
    );
    return { scheduled, unscheduled };
  };
}

export const scheduler: SchedulerFn = createScheduler();

