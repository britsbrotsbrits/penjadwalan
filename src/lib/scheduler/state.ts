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
  const cells = snapshot.days.flatMap((day) => snapshot.slotNos.map((slotNo) => ({ day, slotNo, key: cellKey(day, slotNo) })));
  const roomsByCapacity = [...snapshot.rooms].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  return {
    snapshot,
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
    this.byCell.get(cell)?.delete(id);
    return s;
  }

  count(map: Map<string, number>, key: string): number {
    return map.get(key) ?? 0;
  }
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  const next = (map.get(key) ?? 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
