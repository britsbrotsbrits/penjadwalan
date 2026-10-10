import { computeQuota, type TutorQuota } from "./priority";
import type { Requirement, SchedRombel, SchedRoom, SchedTutor, ScheduledSession, SchedulingSnapshot } from "./types";

/**
 * Konteks (data tetap) dan state (hunian yang berubah) untuk scheduler. Murni.
 * Semua indeks bentrok disimpan sebagai Map agar pemeriksaan hard constraint O(1).
 */

export const cellKey = (day: number, slotNo: number) => `${day}-${slotNo}`;

export type SchedContext = {
  snapshot: SchedulingSnapshot;
  reqById: Map<string, Requirement>;
  rombelById: Map<string, SchedRombel>;
  tutorById: Map<string, SchedTutor>;
  /** Sel tersedia tutor, hanya yang ada di grid. */
  tutorCells: Map<string, Set<string>>;
  tutorsBySubtest: Map<string, SchedTutor[]>;
  /** Ruangan terurut kapasitas naik (lalu id) agar pemilihan "paling pas" deterministik. */
  roomsByCapacity: SchedRoom[];
  roomById: Map<string, SchedRoom>;
  cells: Array<{ day: number; slotNo: number; key: string }>;
  /** Sel yang boleh dipakai rombel berpola (hari reguler x sesi SUBTEST pola). Rombel tanpa pola tidak ada di sini. */
  patternCells: Map<string, Set<string>>;
  /** Pembatas sel per rombel: rombel berpola (hari x sesi pola) atau rombel dengan hari khusus (hari x semua sesi). */
  allowedCells: Map<string, Set<string>>;
  /** Posisi (indeks) tiap nomor sesi pada grid, untuk menghitung jeda mentor. */
  slotIndex: Map<number, number>;
  /** Jatah dasar dan kuota sesi per minggu tiap mentor (dari level dan jumlah centang). */
  tutorQuota: Map<string, TutorQuota>;
};

export function buildContext(snapshot: SchedulingSnapshot, requirements: readonly Requirement[]): SchedContext {
  const gridDays = new Set(snapshot.days);
  const gridSlots = new Set(snapshot.slotNos);
  const tutorCells = new Map<string, Set<string>>();
  const tutorsBySubtest = new Map<string, SchedTutor[]>();
  for (const t of snapshot.tutors) {
    tutorCells.set(
      t.id,
      new Set(t.availability.filter((c) => gridDays.has(c.day) && gridSlots.has(c.slotNo)).map((c) => cellKey(c.day, c.slotNo))),
    );
    for (const sub of new Set(t.competencies)) {
      const list = tutorsBySubtest.get(sub) ?? [];
      list.push(t);
      tutorsBySubtest.set(sub, list);
    }
  }
  const tutorQuota = new Map<string, TutorQuota>();
  for (const t of snapshot.tutors) tutorQuota.set(t.id, computeQuota(tutorCells.get(t.id)?.size ?? 0, t.level));
  const cells = snapshot.days.flatMap((day) => snapshot.slotNos.map((slotNo) => ({ day, slotNo, key: cellKey(day, slotNo) })));
  const roomsByCapacity = [...snapshot.rooms].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  const slotIndex = new Map(snapshot.slotNos.map((n, i) => [n, i] as const));
  const patternCells = new Map<string, Set<string>>();
  const allowedCells = new Map<string, Set<string>>();
  for (const r of snapshot.rombels) {
    const days = r.days && r.days.length > 0 ? snapshot.days.filter((d) => r.days!.includes(d)) : snapshot.days;
    if (r.pattern) {
      const set = new Set<string>();
      for (const day of days) for (const n of r.pattern.subtestSlots) if (gridSlots.has(n)) set.add(cellKey(day, n));
      patternCells.set(r.id, set);
      allowedCells.set(r.id, set);
    } else if (r.days && r.days.length > 0) {
      const set = new Set<string>();
      for (const day of days) for (const n of snapshot.slotNos) set.add(cellKey(day, n));
      allowedCells.set(r.id, set);
    }
  }
  return {
    snapshot,
    patternCells,
    allowedCells,
    slotIndex,
    tutorQuota,
    reqById: new Map(requirements.map((r) => [r.id, r])),
    rombelById: new Map(snapshot.rombels.map((r) => [r.id, r])),
    tutorById: new Map(snapshot.tutors.map((t) => [t.id, t])),
    tutorCells,
    tutorsBySubtest,
    roomsByCapacity,
    roomById: new Map(snapshot.rooms.map((r) => [r.id, r])),
    cells,
  };
}

export class ScheduleState {
  sessions = new Map<number, ScheduledSession>();
  private nextId = 1;
  tutorAt = new Map<string, number>();
  roomAt = new Map<string, number>();
  rombelAt = new Map<string, number>();
  rombelDay = new Map<string, number>();
  tutorLoad = new Map<string, number>();
  rombelSubtest = new Map<string, number>();
  perRequirement = new Map<string, number>();
  byCell = new Map<string, Set<number>>();
  /** Posisi sesi (indeks grid) yang dipegang tiap mentor pada tiap hari, terurut. Kunci: tutorId|day. */
  tutorDay = new Map<string, number[]>();
  private slotIndex = new Map<number, number>();

  constructor(slotNos: readonly number[] = []) {
    slotNos.forEach((n, i) => this.slotIndex.set(n, i));
  }

  add(s: ScheduledSession): number {
    const id = this.nextId++;
    const cell = cellKey(s.day, s.slotNo);
    this.sessions.set(id, s);
    this.tutorAt.set(`${s.tutorId}|${cell}`, id);
    this.roomAt.set(`${s.roomId}|${cell}`, id);
    this.rombelAt.set(`${s.rombelId}|${cell}`, id);
    bump(this.rombelDay, `${s.rombelId}|${s.day}`, 1);
    bump(this.tutorLoad, s.tutorId, 1);
    bump(this.rombelSubtest, `${s.rombelId}|${s.subtestId}`, 1);
    bump(this.perRequirement, s.requirementId, 1);
    this.addTutorDay(s);
    const set = this.byCell.get(cell) ?? new Set<number>();
    set.add(id);
    this.byCell.set(cell, set);
    return id;
  }

  remove(id: number): ScheduledSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`sesi ${id} tidak ada`);
    const cell = cellKey(s.day, s.slotNo);
    this.sessions.delete(id);
    this.tutorAt.delete(`${s.tutorId}|${cell}`);
    this.roomAt.delete(`${s.roomId}|${cell}`);
    this.rombelAt.delete(`${s.rombelId}|${cell}`);
    bump(this.rombelDay, `${s.rombelId}|${s.day}`, -1);
    bump(this.tutorLoad, s.tutorId, -1);
    bump(this.rombelSubtest, `${s.rombelId}|${s.subtestId}`, -1);
    bump(this.perRequirement, s.requirementId, -1);
    this.removeTutorDay(s);
    this.byCell.get(cell)?.delete(id);
    return s;
  }

  private pos(slotNo: number): number {
    return this.slotIndex.get(slotNo) ?? slotNo;
  }

  private addTutorDay(s: ScheduledSession): void {
    const key = `${s.tutorId}|${s.day}`;
    const list = this.tutorDay.get(key) ?? [];
    list.push(this.pos(s.slotNo));
    list.sort((a, b) => a - b);
    this.tutorDay.set(key, list);
  }

  private removeTutorDay(s: ScheduledSession): void {
    const key = `${s.tutorId}|${s.day}`;
    const list = this.tutorDay.get(key);
    if (!list) return;
    const i = list.indexOf(this.pos(s.slotNo));
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.tutorDay.delete(key);
  }

  /** Jumlah jeda kosong mentor pada hari itu = rentang pertama..terakhir dikurangi jumlah sesi. */
  tutorGaps(tutorId: string, day: number): number {
    return gapsOf(this.tutorDay.get(`${tutorId}|${day}`) ?? []);
  }

  /** Perubahan jumlah jeda bila mentor menambah satu sesi di posisi ini (negatif = menutup jeda). */
  gapDeltaIfAdd(tutorId: string, day: number, slotNo: number): number {
    const list = this.tutorDay.get(`${tutorId}|${day}`) ?? [];
    if (list.length === 0) return 0;
    const next = [...list, this.pos(slotNo)].sort((a, b) => a - b);
    return gapsOf(next) - gapsOf(list);
  }

  count(map: Map<string, number>, key: string): number {
    return map.get(key) ?? 0;
  }
}

/** Jeda kosong pada daftar posisi terurut. */
export function gapsOf(sorted: readonly number[]): number {
  if (sorted.length < 2) return 0;
  return sorted[sorted.length - 1]! - sorted[0]! + 1 - sorted.length;
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  const next = (map.get(key) ?? 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
