/**
 * Analisis ruangan tetap (fixed room) per rombel. Murni: tanpa Supabase/React/Next.
 *
 * Database hanya menjaga bahwa ruangan tetap ADA dan AKTIF saat dipilih. Kecocokan kapasitas
 * dan ruangan yang kemudian dinonaktifkan dinilai di sini, karena jumlah siswa dan status ruangan
 * berubah-ubah. Ini juga dasar validator penjadwalan kelak (hard constraint: kapasitas >= jumlah siswa).
 *
 * DEC-02: kapasitas dibandingkan dengan jumlah siswa AKTIF aktual; bila 0 siswa, jatuh ke ukuran
 * standar tipe kelas dengan peringatan.
 */

export type RoomInfo = { id: string; name: string; capacity: number; isActive: boolean };
export type RombelInfo = {
  id: string;
  name: string;
  classTypeId: string;
  fixedRoomId: string | null;
  isActive: boolean;
};
export type ClassTypeInfo = { id: string; defaultSize: number };
export type CountInfo = { rombelId: string; activeStudents: number };

export type FixedRoomIssueCode = "ROOM_MISSING" | "ROOM_INACTIVE" | "ROOM_TOO_SMALL" | "SIZE_ESTIMATED";

export type FixedRoomIssue = {
  code: FixedRoomIssueCode;
  /** error = melanggar hard constraint bila dijadwalkan; warning = perlu perhatian. */
  severity: "error" | "warning";
  message: string;
};

export type SizeBasis = "actual" | "class_type";

export type FixedRoomEvaluation = {
  /** Jumlah siswa yang dipakai untuk membandingkan kapasitas. */
  required: number;
  basis: SizeBasis;
  issues: FixedRoomIssue[];
};

/** Jumlah kursi yang dibutuhkan: siswa aktif aktual, atau ukuran standar bila belum ada siswa aktif. */
export function requiredSeats(
  activeStudents: number,
  defaultSize: number,
): { required: number; basis: SizeBasis } {
  return activeStudents > 0
    ? { required: activeStudents, basis: "actual" }
    : { required: defaultSize, basis: "class_type" };
}

export function evaluateFixedRoom(input: {
  room: RoomInfo | null;
  activeStudents: number;
  defaultSize: number;
}): FixedRoomEvaluation {
  const { required, basis } = requiredSeats(input.activeStudents, input.defaultSize);
  const issues: FixedRoomIssue[] = [];
  const { room } = input;

  if (room === null) {
    issues.push({ code: "ROOM_MISSING", severity: "error", message: "Ruangan tetap tidak ditemukan." });
    return { required, basis, issues };
  }

  if (!room.isActive) {
    issues.push({
      code: "ROOM_INACTIVE",
      severity: "error",
      message: `Ruangan ${room.name} nonaktif. Pilih ruangan lain atau aktifkan kembali.`,
    });
  }

  if (room.capacity < required) {
    issues.push({
      code: "ROOM_TOO_SMALL",
      // Dengan jumlah siswa aktual ini pelanggaran nyata; dengan perkiraan ukuran standar hanya peringatan.
      severity: basis === "actual" ? "error" : "warning",
      message:
        basis === "actual"
          ? `Kapasitas ${room.name} (${room.capacity}) kurang dari ${required} siswa aktif.`
          : `Kapasitas ${room.name} (${room.capacity}) kurang dari ukuran standar tipe kelas (${required}).`,
    });
  }

  if (basis === "class_type") {
    issues.push({
      code: "SIZE_ESTIMATED",
      severity: "warning",
      message: "Belum ada siswa aktif; kapasitas dibandingkan dengan ukuran standar tipe kelas.",
    });
  }

  return { required, basis, issues };
}

export type FixedRoomAnalysis = {
  /** Hanya rombel AKTIF yang punya ruangan tetap. */
  byRombel: Map<string, FixedRoomEvaluation>;
  /** Ruangan -> id rombel aktif yang memakainya sebagai ruangan tetap. */
  byRoom: Map<string, string[]>;
  /** Ruangan yang dipakai >= 2 rombel aktif (DEC-03: boleh, bentrok waktu tetap hard constraint). */
  sharedRoomIds: string[];
};

export function analyzeFixedRooms(input: {
  rombels: readonly RombelInfo[];
  rooms: readonly RoomInfo[];
  classTypes: readonly ClassTypeInfo[];
  counts: readonly CountInfo[];
}): FixedRoomAnalysis {
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const sizeByClassType = new Map(input.classTypes.map((c) => [c.id, c.defaultSize]));
  const activeByRombel = new Map(input.counts.map((c) => [c.rombelId, c.activeStudents]));

  const byRombel = new Map<string, FixedRoomEvaluation>();
  const byRoom = new Map<string, string[]>();

  for (const rombel of input.rombels) {
    if (!rombel.isActive || rombel.fixedRoomId === null) continue;
    byRombel.set(
      rombel.id,
      evaluateFixedRoom({
        room: roomById.get(rombel.fixedRoomId) ?? null,
        activeStudents: activeByRombel.get(rombel.id) ?? 0,
        // Tipe kelas tidak dikenal: 0 membuat perbandingan kapasitas tidak pernah menyalahkan ruangan.
        defaultSize: sizeByClassType.get(rombel.classTypeId) ?? 0,
      }),
    );
    const list = byRoom.get(rombel.fixedRoomId) ?? [];
    list.push(rombel.id);
    byRoom.set(rombel.fixedRoomId, list);
  }

  const sharedRoomIds = [...byRoom.entries()].filter(([, ids]) => ids.length >= 2).map(([id]) => id);
  return { byRombel, byRoom, sharedRoomIds };
}

/** Level terparah dari sebuah evaluasi: untuk pewarnaan ringkas di UI. */
export function worstSeverity(evaluation: FixedRoomEvaluation): "error" | "warning" | "ok" {
  if (evaluation.issues.some((i) => i.severity === "error")) return "error";
  if (evaluation.issues.some((i) => i.severity === "warning")) return "warning";
  return "ok";
}
