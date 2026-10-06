import type {
  Requirement,
  SchedulerResult,
  SchedulingSnapshot,
  UnscheduledReason,
} from "../scheduler/types";

/**
 * Laporan metrik hasil penjadwalan untuk simulator. Murni.
 * Semua pelanggaran dihitung dari HASIL, bukan dari klaim scheduler. Pemeriksaan ini benih validation
 * engine (Phase 10); aturan yang sama kelak dipindah/dipakai bersama di sana.
 */

export type ViolationCode =
  | "TUTOR_CONFLICT"
  | "ROOM_CONFLICT"
  | "ROMBEL_CONFLICT"
  | "CAPACITY_VIOLATION"
  | "COMPETENCY_VIOLATION"
  | "AVAILABILITY_VIOLATION"
  | "DAILY_LIMIT_VIOLATION"
  | "FIXED_ROOM_VIOLATION"
  | "INVALID_REFERENCE"
  | "OVER_SCHEDULED"
  | "ACCOUNTING_MISMATCH";

export type Violation = { code: ViolationCode; message: string };

export type WorkloadSummary = {
  tutors: number;
  active: number;
  idle: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  /** Tutor tersibuk (maks 10). */
  busiest: Array<{ tutorId: string; name: string; sessions: number }>;
};

export type ScheduleReport = {
  required: number;
  scheduled: number;
  unscheduledSessions: number;
  /** 0..100, satu desimal; 100 bila tidak ada kebutuhan. */
  completionPercent: number;
  violations: Violation[];
  violationCounts: Record<ViolationCode, number>;
  unscheduledByReason: Partial<Record<UnscheduledReason, number>>;
  workload: WorkloadSummary;
  /** Permintaan tutor belum dimodelkan (tabel tutor_requests belum ada), jadi selalu 0. */
  unmetRequests: { modeled: false; count: 0 };
};

const ALL_CODES: ViolationCode[] = [
  "TUTOR_CONFLICT", "ROOM_CONFLICT", "ROMBEL_CONFLICT", "CAPACITY_VIOLATION", "COMPETENCY_VIOLATION",
  "AVAILABILITY_VIOLATION", "DAILY_LIMIT_VIOLATION", "FIXED_ROOM_VIOLATION", "INVALID_REFERENCE",
  "OVER_SCHEDULED", "ACCOUNTING_MISMATCH",
];

export function evaluateSchedule(
  snapshot: SchedulingSnapshot,
  requirements: readonly Requirement[],
  result: SchedulerResult,
): ScheduleReport {
  const violations: Violation[] = [];
  const add = (code: ViolationCode, message: string) => violations.push({ code, message });

  const tutorById = new Map(snapshot.tutors.map((t) => [t.id, t]));
  const roomById = new Map(snapshot.rooms.map((r) => [r.id, r]));
  const rombelById = new Map(snapshot.rombels.map((r) => [r.id, r]));
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const days = new Set(snapshot.days);
  const slots = new Set(snapshot.slotNos);
  const availability = new Map(snapshot.tutors.map((t) => [t.id, new Set(t.availability.map((c) => `${c.day}-${c.slotNo}`))]));

  const tutorSlot = new Map<string, number>();
  const roomSlot = new Map<string, number>();
  const rombelSlot = new Map<string, number>();
  const rombelDay = new Map<string, number>();
  const scheduledPerReq = new Map<string, number>();
  const sessionsPerTutor = new Map<string, number>();

  for (const s of result.scheduled) {
    const where = `hari ${s.day} sesi ${s.slotNo}`;
    const req = reqById.get(s.requirementId);
    const tutor = tutorById.get(s.tutorId);
    const room = roomById.get(s.roomId);
    const rombel = rombelById.get(s.rombelId);
    const slotKey = `${s.day}-${s.slotNo}`;

    if (!req || !tutor || !room || !rombel || !days.has(s.day) || !slots.has(s.slotNo) || req.rombelId !== s.rombelId) {
      add("INVALID_REFERENCE", `Sesi ${s.requirementId} (${where}) merujuk data yang tidak ada atau di luar grid.`);
      continue;
    }

    scheduledPerReq.set(req.id, (scheduledPerReq.get(req.id) ?? 0) + 1);
    sessionsPerTutor.set(tutor.id, (sessionsPerTutor.get(tutor.id) ?? 0) + 1);

    const tKey = `${tutor.id}|${slotKey}`;
    tutorSlot.set(tKey, (tutorSlot.get(tKey) ?? 0) + 1);
    const rKey = `${room.id}|${slotKey}`;
    roomSlot.set(rKey, (roomSlot.get(rKey) ?? 0) + 1);
    const bKey = `${rombel.id}|${slotKey}`;
    rombelSlot.set(bKey, (rombelSlot.get(bKey) ?? 0) + 1);
    const dKey = `${rombel.id}|${s.day}`;
    rombelDay.set(dKey, (rombelDay.get(dKey) ?? 0) + 1);

    if (room.capacity < rombel.studentCount) {
      add("CAPACITY_VIOLATION", `${rombel.name} (${rombel.studentCount} siswa) di ${room.name} (${room.capacity}), ${where}.`);
    }
    if (!tutor.competencies.includes(s.subtestId) || !req.allowedSubtestIds.includes(s.subtestId)) {
      add("COMPETENCY_VIOLATION", `${tutor.name} mengajar subtes yang tidak diizinkan/tidak dikuasai untuk ${rombel.name}, ${where}.`);
    }
    if (!availability.get(tutor.id)?.has(slotKey)) {
      add("AVAILABILITY_VIOLATION", `${tutor.name} tidak tersedia pada ${where}.`);
    }
    if (rombel.fixedRoomId && rombel.fixedRoomId !== room.id) {
      add("FIXED_ROOM_VIOLATION", `${rombel.name} punya ruangan tetap tetapi dijadwalkan di ${room.name}, ${where}.`);
    }
  }

  for (const [key, n] of tutorSlot) if (n > 1) add("TUTOR_CONFLICT", `Tutor ${tutorById.get(key.split("|")[0]!)?.name ?? "?"} punya ${n} sesi pada ${slotLabel(key)}.`);
  for (const [key, n] of roomSlot) if (n > 1) add("ROOM_CONFLICT", `Ruangan ${roomById.get(key.split("|")[0]!)?.name ?? "?"} dipakai ${n} sesi pada ${slotLabel(key)}.`);
  for (const [key, n] of rombelSlot) if (n > 1) add("ROMBEL_CONFLICT", `Rombel ${rombelById.get(key.split("|")[0]!)?.name ?? "?"} punya ${n} sesi pada ${slotLabel(key)}.`);
  for (const [key, n] of rombelDay) {
    const [rombelId, day] = key.split("|");
    const limit = rombelById.get(rombelId!)?.sessionsPerDay;
    if (limit != null && n > limit) add("DAILY_LIMIT_VIOLATION", `Rombel ${rombelById.get(rombelId!)?.name} punya ${n} sesi pada hari ${day} (batas ${limit}).`);
  }

  // Pembukuan: tiap kebutuhan harus = terjadwal + tak terjadwal, tanpa kelebihan.
  const missingPerReq = new Map<string, number>();
  for (const u of result.unscheduled) missingPerReq.set(u.requirementId, (missingPerReq.get(u.requirementId) ?? 0) + u.missing);
  for (const req of requirements) {
    const done = scheduledPerReq.get(req.id) ?? 0;
    const missing = missingPerReq.get(req.id) ?? 0;
    if (done > req.sessions) add("OVER_SCHEDULED", `${req.label} (${req.id}) dijadwalkan ${done}x padahal butuh ${req.sessions}.`);
    else if (done + missing !== req.sessions) add("ACCOUNTING_MISMATCH", `${req.label} (${req.id}): butuh ${req.sessions}, terjadwal ${done}, dilaporkan belum terjadwal ${missing}.`);
  }
  for (const id of missingPerReq.keys()) if (!reqById.has(id)) add("INVALID_REFERENCE", `Item belum terjadwal merujuk kebutuhan yang tidak ada: ${id}.`);

  const required = requirements.reduce((n, r) => n + r.sessions, 0);
  const scheduled = [...scheduledPerReq.values()].reduce((a, b) => a + b, 0);
  const unscheduledByReason: Partial<Record<UnscheduledReason, number>> = {};
  for (const u of result.unscheduled) unscheduledByReason[u.reason] = (unscheduledByReason[u.reason] ?? 0) + u.missing;

  const violationCounts = Object.fromEntries(ALL_CODES.map((c) => [c, 0])) as Record<ViolationCode, number>;
  for (const v of violations) violationCounts[v.code] += 1;

  return {
    required,
    scheduled,
    unscheduledSessions: required - scheduled,
    completionPercent: required === 0 ? 100 : Math.round((scheduled / required) * 1000) / 10,
    violations,
    violationCounts,
    unscheduledByReason,
    workload: summarizeWorkload(snapshot, sessionsPerTutor),
    unmetRequests: { modeled: false, count: 0 },
  };
}

function slotLabel(key: string): string {
  const [, cell] = key.split("|");
  const [day, slot] = cell!.split("-");
  return `hari ${day} sesi ${slot}`;
}

function summarizeWorkload(snapshot: SchedulingSnapshot, perTutor: ReadonlyMap<string, number>): WorkloadSummary {
  const counts = snapshot.tutors.map((t) => ({ tutorId: t.id, name: t.name, sessions: perTutor.get(t.id) ?? 0 }));
  const n = counts.length;
  if (n === 0) return { tutors: 0, active: 0, idle: 0, min: 0, max: 0, mean: 0, stdDev: 0, busiest: [] };
  const values = counts.map((c) => c.sessions);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    tutors: n,
    active: values.filter((v) => v > 0).length,
    idle: values.filter((v) => v === 0).length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    busiest: [...counts].sort((a, b) => b.sessions - a.sessions || a.tutorId.localeCompare(b.tutorId)).slice(0, 10),
  };
}
