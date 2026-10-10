import { sessionValue } from "./priority";
import type { Rng } from "./rng";
import type { SchedContext, ScheduleState } from "./state";
import type { Requirement } from "./types";

/**
 * Pencarian kandidat penempatan satu sesi: hard constraint sebagai filter, soft constraint sebagai skor.
 * Hard (tidak pernah dilanggar): rombel tidak bentrok dan tidak melebihi sesi/hari, ruangan bebas dan
 * muat (ruangan tetap bila ada), tutor kompeten, tersedia, dan tidak bentrok.
 * Murni: tanpa Supabase/React/Next.
 */

export type SchedulerWeights = {
  /** Penalti per sesi yang sudah dipegang tutor (pemerataan beban). */
  load: number;
  /** Bobot prioritas jatah/kuota mentor menurut level (0 = abaikan level). */
  priority: number;
  /** Penalti per sesi rombel yang sama pada hari itu (sebar sesi antar hari). */
  spread: number;
  /** Penalti per kursi kosong ruangan (hemat ruangan besar untuk kelas besar). */
  roomWaste: number;
  /** Penalti per kompetensi tutor (pakai spesialis lebih dulu, simpan generalis untuk kasus sulit). */
  generalist: number;
  /** Penalti per indeks sesi (sedikit condong ke sesi awal). */
  compact: number;
  /** Penalti per sesi subtes yang sama pada rombel (seimbangkan item fleksibel). */
  subtestBalance: number;
  /** Penalti per jeda kosong yang bertambah pada jadwal harian mentor (jadwal berurutan). */
  gap: number;
  /** Penalti bila mentor yang sama mengajar rombel yang sama lebih dari sekali pada hari itu (aturan lunak). */
  sameClassDay: number;
  /** Penalti per sesi rombel pada hari itu yang subtesnya berpasangan terlarang dengan subtes ini (aturan lunak). */
  dayExclusion: number;
  /** Selisih skor yang masih dianggap setara; pemenang dipilih acak berseed di antaranya. */
  tieEpsilon: number;
};

export const DEFAULT_WEIGHTS: SchedulerWeights = {
  load: 1,
  priority: 1,
  spread: 3,
  roomWaste: 0.05,
  generalist: 0.3,
  compact: 0.02,
  subtestBalance: 1,
  gap: 2.5,
  sameClassDay: 5,
  dayExclusion: 6,
  tieEpsilon: 0.5,
};

export type Candidate = {
  day: number;
  slotNo: number;
  tutorId: string;
  subtestId: string;
  roomId: string;
  score: number;
};

/** Alasan sel gagal; setiap sel bisa gagal karena beberapa hal sekaligus (dihitung terpisah). */
export type Tally = {
  cells: number;
  rombelBusy: number;
  dayLimit: number;
  /** Tidak ada ruangan yang muat sama sekali (struktural). */
  noRoomFits: boolean;
  fixedRoomMissing: boolean;
  fixedBusy: number;
  roomBusy: number;
  /** Tidak ada tutor kompeten sama sekali (struktural). */
  poolEmpty: boolean;
  tutorUnavailable: number;
  tutorBusy: number;
};

export type SearchResult = { best: Candidate | null; tally: Tally };

export type SearchOptions = {
  weights: SchedulerWeights;
  /** Bila ada, pemenang dipilih acak di antara skor setara; bila tidak, yang pertama. */
  rng: Rng | null;
  /** Sel yang tidak boleh dipakai (untuk memindahkan sesi). */
  excludeCell?: string;
  /** Batasi pencarian ke satu sel. */
  onlyCell?: string;
};

/** Skor tutor menurut jatah/kuota; tanpa data kuota kembali ke pemerataan beban biasa. Dikembalikan sebagai PENALTI (dikurangkan). */
export function priorityTerm(ctx: SchedContext, w: SchedulerWeights, tutorId: string, n: number): number {
  const q = ctx.tutorQuota.get(tutorId);
  if (!q || w.priority === 0) return w.load * n;
  return -w.priority * sessionValue(q, n, w.load);
}

/** Jumlah sesi rombel pada hari itu yang subtesnya berpasangan terlarang dengan `subtestId`. */
export function exclusionClashes(ctx: SchedContext, state: ScheduleState, rombelId: string, day: number, subtestId: string): number {
  if (ctx.exclusions.size === 0) return 0;
  let n = 0;
  for (const other of ctx.snapshot.subtests) {
    if (ctx.exclusions.has(`${subtestId}|${other.id}`)) n += state.count(state.rombelDaySubtest, `${rombelId}|${day}|${other.id}`);
  }
  return n;
}

export function searchPlacement(
  ctx: SchedContext,
  state: ScheduleState,
  req: Requirement,
  opts: SearchOptions,
): SearchResult {
  const rombel = ctx.rombelById.get(req.rombelId);
  const tally: Tally = {
    cells: 0, rombelBusy: 0, dayLimit: 0, noRoomFits: false, fixedRoomMissing: false, fixedBusy: 0,
    roomBusy: 0, poolEmpty: false, tutorUnavailable: 0, tutorBusy: 0,
  };
  if (!rombel) return { best: null, tally: { ...tally, poolEmpty: true } };

  const w = opts.weights;
  const pool = new Map<string, { id: string; competencies: readonly string[] }>();
  for (const sub of req.allowedSubtestIds) for (const t of ctx.tutorsBySubtest.get(sub) ?? []) pool.set(t.id, t);
  tally.poolEmpty = pool.size === 0;

  const fixedRoom = rombel.fixedRoomId ? ctx.roomById.get(rombel.fixedRoomId) : undefined;
  let roomPool = ctx.roomsByCapacity.filter((r) => r.capacity >= rombel.studentCount);
  if (rombel.fixedRoomId) {
    tally.fixedRoomMissing = !fixedRoom;
    roomPool = fixedRoom && fixedRoom.capacity >= rombel.studentCount ? [fixedRoom] : [];
  }
  tally.noRoomFits = roomPool.length === 0;

  const allowedCells = ctx.allowedCells.get(rombel.id);
  const candidates: Candidate[] = [];
  for (const cell of ctx.cells) {
    // Rombel berpola hanya boleh di sesi SUBTEST polanya (sesi tetap); rombel dengan hari khusus hanya di harinya.
    if (allowedCells && !allowedCells.has(cell.key)) continue;
    if (opts.onlyCell !== undefined && cell.key !== opts.onlyCell) continue;
    if (opts.excludeCell !== undefined && cell.key === opts.excludeCell) continue;
    tally.cells += 1;

    let ok = true;
    if (state.rombelAt.has(`${rombel.id}|${cell.key}`)) { tally.rombelBusy += 1; ok = false; }
    else if (rombel.sessionsPerDay !== null && state.count(state.rombelDay, `${rombel.id}|${cell.day}`) >= rombel.sessionsPerDay) {
      tally.dayLimit += 1; ok = false;
    }

    const room = roomPool.find((r) => !state.roomAt.has(`${r.id}|${cell.key}`));
    if (!room && roomPool.length > 0) {
      if (rombel.fixedRoomId) tally.fixedBusy += 1; else tally.roomBusy += 1;
      ok = false;
    }
    if (roomPool.length === 0) ok = false;

    const tutorOptions: Array<{ tutorId: string; subtestId: string; competencies: number }> = [];
    let anyAvailable = false;
    for (const t of pool.values()) {
      if (!ctx.tutorCells.get(t.id)?.has(cell.key)) continue;
      anyAvailable = true;
      if (state.tutorAt.has(`${t.id}|${cell.key}`)) continue;
      for (const sub of req.allowedSubtestIds) {
        if (t.competencies.includes(sub)) tutorOptions.push({ tutorId: t.id, subtestId: sub, competencies: t.competencies.length });
      }
    }
    if (tutorOptions.length === 0) {
      if (pool.size > 0) { if (anyAvailable) tally.tutorBusy += 1; else tally.tutorUnavailable += 1; }
      ok = false;
    }
    if (!ok || !room) continue;

    const slotIndex = ctx.snapshot.slotNos.indexOf(cell.slotNo);
    const base =
      -w.spread * state.count(state.rombelDay, `${rombel.id}|${cell.day}`) -
      w.roomWaste * (room.capacity - rombel.studentCount) -
      w.compact * slotIndex;
    for (const o of tutorOptions) {
      const score =
        base -
        priorityTerm(ctx, w, o.tutorId, state.count(state.tutorLoad, o.tutorId)) -
        w.generalist * o.competencies -
        w.gap * state.gapDeltaIfAdd(o.tutorId, cell.day, cell.slotNo) -
        w.sameClassDay * state.count(state.tutorRombelDay, `${o.tutorId}|${rombel.id}|${cell.day}`) -
        w.dayExclusion * exclusionClashes(ctx, state, rombel.id, cell.day, o.subtestId) -
        w.subtestBalance * state.count(state.rombelSubtest, `${rombel.id}|${o.subtestId}`);
      candidates.push({ day: cell.day, slotNo: cell.slotNo, tutorId: o.tutorId, subtestId: o.subtestId, roomId: room.id, score });
    }
  }

  if (candidates.length === 0) return { best: null, tally };
  const top = candidates.reduce((m, c) => (c.score > m ? c.score : m), -Infinity);
  const near = candidates.filter((c) => c.score >= top - w.tieEpsilon);
  const best = opts.rng ? opts.rng.pick(near) : near[0]!;
  return { best, tally };
}

