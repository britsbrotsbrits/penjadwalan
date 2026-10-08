import { DEFAULT_WEIGHTS, searchPlacement, type Candidate, type SchedulerWeights } from "./candidates";
import { explainFailure } from "./explain";
import { Rng } from "./rng";
import { buildContext, ScheduleState, type SchedContext } from "./state";
import type { Requirement, ScheduledSession, SchedulerFn, SchedulerInput, SchedulerResult, UnscheduledItem } from "./types";

/**
 * Scheduler constraint-based (pipeline di docs/phase-0/02 bagian 5). Murni dan deterministik:
 * input dan seed yang sama = hasil yang sama.
 *   1. urutkan kebutuhan most-constrained-first
 *   2. tiap sesi: filter kandidat (hard) -> skor (soft) -> pilih terbaik, acak berseed di antara skor setara
 *   3. buntu -> repair terbatas (pindahkan satu sesi penghalang ke sel lain), tidak pernah melanggar hard constraint
 *   4. sisa dilaporkan sebagai unscheduled dengan alasan terstruktur
 * Tidak pernah menjadwalkan sesi yang melanggar hard constraint; lebih baik tidak terjadwal dan dijelaskan.
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
    const state = new ScheduleState();
    const rng = new Rng(seed);
    for (const f of frozen ?? []) state.add({ ...f, requirementId: FROZEN_REQUIREMENT_ID });
    let budget = repairBudget;

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
          if (!movedReq || !fit.best) {
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

    for (const req of orderRequirements(ctx, requirements)) {
      for (let n = 0; n < req.sessions; n++) {
        const result = place(req);
        if (result.best) continue;
        const t = result.tally;
        const structural = t.poolEmpty || t.noRoomFits || t.fixedRoomMissing;
        if (structural || budget <= 0 || !repair(req)) break;
      }
    }

    const unscheduled: UnscheduledItem[] = [];
    for (const req of requirements) {
      const missing = req.sessions - state.count(state.perRequirement, req.id);
      if (missing <= 0) continue;
      const diag = searchPlacement(ctx, state, req, { weights, rng: null });
      const why = explainFailure(diag.tally);
      unscheduled.push({ requirementId: req.id, missing, reason: why.reason, detail: why.detail });
    }

    const scheduled = [...state.sessions.values()].filter((x) => x.requirementId !== FROZEN_REQUIREMENT_ID).sort(
      (a, b) => a.day - b.day || a.slotNo - b.slotNo || a.rombelId.localeCompare(b.rombelId) || a.requirementId.localeCompare(b.requirementId),
    );
    return { scheduled, unscheduled };
  };
}

export const scheduler: SchedulerFn = createScheduler();

