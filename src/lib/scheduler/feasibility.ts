import type { Requirement, SchedulingSnapshot } from "./types";

/**
 * Analisis kelayakan: syarat NECESSARY (perlu, belum tentu cukup) sebelum menjadwalkan.
 * Bila salah satu gagal, jadwal lengkap PASTI tidak mungkin, dan alasannya disebut.
 * Lulus semua syarat TIDAK menjamin ada jadwal; itu tugas scheduler. Murni.
 */

export type FeasibilityCode =
  | "NO_COMPETENT_TUTOR"
  | "INSUFFICIENT_TUTOR_CAPACITY"
  | "TUTOR_CAPACITY_TOTAL"
  | "NO_ROOM_CAPACITY"
  | "FIXED_ROOM_TOO_SMALL"
  | "ROOM_CAPACITY_BOTTLENECK"
  | "SESSIONS_PER_DAY_EXCEEDS_SLOTS"
  | "ROMBEL_SLOT_CAPACITY"
  | "SESSIONS_PER_DAY_MISSING";

export type FeasibilityIssue = {
  code: FeasibilityCode;
  severity: "error" | "warning";
  message: string;
  rombelId?: string;
  subtestId?: string;
};

export type SubtestSupply = {
  subtestId: string;
  code: string;
  /** Sesi yang HANYA bisa diisi subtes ini (item biasa). */
  required: number;
  competentTutors: number;
  /** Total sel (hari x sesi) tersedia milik tutor kompeten. */
  supplyCells: number;
};

export type RoomBottleneck = {
  /** Rombel berukuran >= minSize hanya boleh memakai ruangan berkapasitas >= minSize. */
  minSize: number;
  requiredSessions: number;
  roomCount: number;
  roomSlots: number;
};

export type FeasibilityReport = {
  feasible: boolean;
  issues: FeasibilityIssue[];
  subtestSupply: SubtestSupply[];
  roomBottlenecks: RoomBottleneck[];
};

export function analyzeFeasibility(
  snapshot: SchedulingSnapshot,
  requirements: readonly Requirement[],
): FeasibilityReport {
  const issues: FeasibilityIssue[] = [];
  const add = (issue: FeasibilityIssue) => issues.push(issue);

  const subtestCode = new Map(snapshot.subtests.map((s) => [s.id, s.code]));
  const rombelById = new Map(snapshot.rombels.map((r) => [r.id, r]));
  const roomById = new Map(snapshot.rooms.map((r) => [r.id, r]));
  const dayCount = snapshot.days.length;
  const slotCount = snapshot.slotNos.length;
  const gridDays = new Set(snapshot.days);
  const gridSlots = new Set(snapshot.slotNos);

  // Sel tutor yang benar-benar ada di grid (sel di luar grid tidak bisa dipakai).
  const tutorCells = new Map(
    snapshot.tutors.map((t) => [
      t.id,
      new Set(t.availability.filter((c) => gridDays.has(c.day) && gridSlots.has(c.slotNo)).map((c) => `${c.day}-${c.slotNo}`)).size,
    ]),
  );

  // ---- kompetensi dan kapasitas tutor
  const tutorsBySubtest = new Map<string, string[]>();
  for (const t of snapshot.tutors) {
    for (const s of t.competencies) {
      const list = tutorsBySubtest.get(s) ?? [];
      list.push(t.id);
      tutorsBySubtest.set(s, list);
    }
  }
  const cellsOf = (tutorIds: readonly string[]) => tutorIds.reduce((n, id) => n + (tutorCells.get(id) ?? 0), 0);

  const fixedRequired = new Map<string, number>();
  for (const req of requirements) {
    const pool = new Set(req.allowedSubtestIds.flatMap((s) => tutorsBySubtest.get(s) ?? []));
    const rombel = rombelById.get(req.rombelId);
    const who = rombel?.name ?? req.rombelId;
    if (pool.size === 0) {
      add({
        code: "NO_COMPETENT_TUTOR",
        severity: "error",
        message: `${who} / ${req.label}: tidak ada tutor yang kompeten untuk ${req.allowedSubtestIds.map((s) => subtestCode.get(s) ?? "?").join(" atau ")}.`,
        rombelId: req.rombelId,
        subtestId: req.allowedSubtestIds[0],
      });
    }
    if (req.allowedSubtestIds.length === 1) {
      const id = req.allowedSubtestIds[0]!;
      fixedRequired.set(id, (fixedRequired.get(id) ?? 0) + req.sessions);
    } else if (pool.size > 0) {
      // Item fleksibel: butuh kapasitas gabungan tutor dari semua subtes yang diperbolehkan.
      const supply = cellsOf([...pool]);
      if (req.sessions > supply) {
        add({
          code: "INSUFFICIENT_TUTOR_CAPACITY",
          severity: "error",
          message: `${who} / ${req.label}: butuh ${req.sessions} sesi, kapasitas tutor kompeten hanya ${supply} sel.`,
          rombelId: req.rombelId,
        });
      }
    }
  }

  const subtestSupply: SubtestSupply[] = snapshot.subtests.map((s) => {
    const tutors = tutorsBySubtest.get(s.id) ?? [];
    return {
      subtestId: s.id,
      code: s.code,
      required: fixedRequired.get(s.id) ?? 0,
      competentTutors: tutors.length,
      supplyCells: cellsOf(tutors),
    };
  });
  for (const row of subtestSupply) {
    if (row.required > 0 && row.competentTutors > 0 && row.required > row.supplyCells) {
      add({
        code: "INSUFFICIENT_TUTOR_CAPACITY",
        severity: "error",
        message: `${row.code}: butuh ${row.required} sesi per minggu, tetapi tutor kompeten hanya menyediakan ${row.supplyCells} sel (hari x sesi).`,
        subtestId: row.subtestId,
      });
    }
  }

  const totalRequired = requirements.reduce((n, r) => n + r.sessions, 0);
  const totalTutorCells = [...tutorCells.values()].reduce((a, b) => a + b, 0);
  if (totalRequired > totalTutorCells) {
    add({
      code: "TUTOR_CAPACITY_TOTAL",
      severity: "error",
      message: `Total kebutuhan ${totalRequired} sesi melebihi total sel tutor tersedia (${totalTutorCells}).`,
    });
  }

  // ---- ruangan
  const maxRoom = snapshot.rooms.reduce((m, r) => Math.max(m, r.capacity), 0);
  const sessionsByRombel = new Map<string, number>();
  for (const req of requirements) sessionsByRombel.set(req.rombelId, (sessionsByRombel.get(req.rombelId) ?? 0) + req.sessions);

  for (const rombel of snapshot.rombels) {
    if (!sessionsByRombel.has(rombel.id)) continue;
    if (rombel.studentCount > maxRoom) {
      add({
        code: "NO_ROOM_CAPACITY",
        severity: "error",
        message: `${rombel.name}: ${rombel.studentCount} siswa melebihi kapasitas ruangan terbesar (${maxRoom}).`,
        rombelId: rombel.id,
      });
    }
    if (rombel.fixedRoomId) {
      const room = roomById.get(rombel.fixedRoomId);
      if (!room) {
        add({ code: "FIXED_ROOM_TOO_SMALL", severity: "error", message: `${rombel.name}: ruangan tetap tidak ditemukan.`, rombelId: rombel.id });
      } else if (room.capacity < rombel.studentCount) {
        add({
          code: "FIXED_ROOM_TOO_SMALL",
          severity: "error",
          message: `${rombel.name}: ruangan tetap ${room.name} (${room.capacity}) kurang dari ${rombel.studentCount} siswa.`,
          rombelId: rombel.id,
        });
      }
    }
  }

  // Batas bawah ala Hall: sesi rombel berukuran >= S hanya muat di ruangan berkapasitas >= S.
  const sizes = [...new Set(snapshot.rombels.filter((r) => sessionsByRombel.has(r.id)).map((r) => r.studentCount))].sort((a, b) => a - b);
  const roomBottlenecks: RoomBottleneck[] = sizes.map((minSize) => {
    const requiredSessions = snapshot.rombels
      .filter((r) => r.studentCount >= minSize)
      .reduce((n, r) => n + (sessionsByRombel.get(r.id) ?? 0), 0);
    const roomCount = snapshot.rooms.filter((r) => r.capacity >= minSize).length;
    return { minSize, requiredSessions, roomCount, roomSlots: roomCount * dayCount * slotCount };
  });
  for (const b of roomBottlenecks) {
    if (b.requiredSessions > b.roomSlots && b.roomCount > 0) {
      add({
        code: "ROOM_CAPACITY_BOTTLENECK",
        severity: "error",
        message: `Kelas berukuran ${b.minSize}+ butuh ${b.requiredSessions} sesi per minggu, tetapi hanya ${b.roomCount} ruangan muat (${b.roomSlots} slot ruangan).`,
      });
    }
  }

  // ---- kapasitas rombel sendiri
  for (const rombel of snapshot.rombels) {
    const required = sessionsByRombel.get(rombel.id);
    if (required === undefined) continue;
    if (rombel.sessionsPerDay === null) {
      add({
        code: "SESSIONS_PER_DAY_MISSING",
        severity: "warning",
        message: `${rombel.name}: sesi per hari belum diatur; batas harian tidak diperiksa.`,
        rombelId: rombel.id,
      });
      if (required > dayCount * slotCount) {
        add({ code: "ROMBEL_SLOT_CAPACITY", severity: "error", message: `${rombel.name}: ${required} sesi tidak muat dalam ${dayCount} hari x ${slotCount} sesi.`, rombelId: rombel.id });
      }
      continue;
    }
    if (rombel.sessionsPerDay > slotCount) {
      add({
        code: "SESSIONS_PER_DAY_EXCEEDS_SLOTS",
        severity: "error",
        message: `${rombel.name}: sesi per hari (${rombel.sessionsPerDay}) melebihi jumlah sesi aktif (${slotCount}).`,
        rombelId: rombel.id,
      });
    }
    const perWeek = dayCount * Math.min(rombel.sessionsPerDay, slotCount);
    if (required > perWeek) {
      add({
        code: "ROMBEL_SLOT_CAPACITY",
        severity: "error",
        message: `${rombel.name}: butuh ${required} sesi per minggu, tetapi batas ${rombel.sessionsPerDay}/hari x ${dayCount} hari hanya ${perWeek}.`,
        rombelId: rombel.id,
      });
    }
  }

  return {
    feasible: !issues.some((i) => i.severity === "error"),
    issues,
    subtestSupply,
    roomBottlenecks,
  };
}
