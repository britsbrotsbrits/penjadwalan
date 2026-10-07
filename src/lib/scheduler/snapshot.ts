import { resolveDistribution, type DistributionItem } from "../config/distribution";
import { resolveSetting, type SettingRow } from "../config/resolver";
import type { SchedRombel, SchedulingSnapshot } from "./types";

/**
 * Membangun snapshot beku untuk scheduler dari baris data nyata (sudah divalidasi di lapisan server).
 * Murni: tanpa Supabase/React/Next. Aturan (sama dengan pemeriksaan di database):
 *  - hanya entitas AKTIF yang ikut dijadwalkan;
 *  - jumlah siswa = siswa aktif aktual, atau ukuran standar tipe kelas bila belum ada siswa (DEC-02);
 *  - konfigurasi dan distribusi diresolusi per rombel; yang tidak ada/rusak menjadi null (tidak dikarang);
 *  - availability hanya sel available = true.
 */

export type SnapshotInput = {
  days: ReadonlyArray<{ dayOfWeek: number; isActive: boolean }>;
  slots: ReadonlyArray<{ slotNo: number; isActive: boolean }>;
  subtests: ReadonlyArray<{ id: string; code: string; isActive: boolean }>;
  rooms: ReadonlyArray<{ id: string; name: string; capacity: number; isActive: boolean }>;
  programs: ReadonlyArray<{ id: string }>;
  classTypes: ReadonlyArray<{ id: string; programId: string; defaultSize: number }>;
  rombels: ReadonlyArray<{ id: string; name: string; classTypeId: string; fixedRoomId: string | null; isActive: boolean }>;
  /** Jumlah siswa aktif per rombel; rombel yang tidak tercantum dianggap 0. */
  activeStudents: ReadonlyArray<{ rombelId: string; activeStudents: number }>;
  tutors: ReadonlyArray<{ id: string; name: string; level: number; isSchedulable: boolean }>;
  competencies: ReadonlyArray<{ tutorId: string; subtestId: string }>;
  availability: ReadonlyArray<{ tutorId: string; day: number; slotNo: number; available: boolean }>;
  settings: readonly SettingRow[];
  distribution: readonly DistributionItem[];
};

export type SnapshotIssue = { code: "CONFIG_INVALID" | "CONFIG_MISSING"; rombelId: string; message: string };

export type BuiltSnapshot = { snapshot: SchedulingSnapshot; issues: SnapshotIssue[] };

export function buildSnapshot(input: SnapshotInput): BuiltSnapshot {
  const issues: SnapshotIssue[] = [];
  const classTypeById = new Map(input.classTypes.map((c) => [c.id, c]));
  const activeCount = new Map(input.activeStudents.map((s) => [s.rombelId, s.activeStudents]));

  const subtests = input.subtests.filter((s) => s.isActive).map((s) => ({ id: s.id, code: s.code }));
  const subtestIds = new Set(subtests.map((s) => s.id));
  const rooms = input.rooms.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity }));

  const rombels: SchedRombel[] = [];
  for (const r of input.rombels) {
    if (!r.isActive) continue;
    const classType = classTypeById.get(r.classTypeId);
    if (!classType) continue; // referensi rusak: tidak dikarang
    const ctx = { programId: classType.programId, classTypeId: classType.id, rombelId: r.id };

    const perDay = resolveSetting(input.settings, "sessions_per_day", ctx);
    const weekly = resolveSetting(input.settings, "weekly_sessions", ctx);
    if (perDay.status === "invalid") {
      issues.push({ code: "CONFIG_INVALID", rombelId: r.id, message: `${r.name}: sesi per hari tersimpan tidak valid (${perDay.message}).` });
    }
    if (weekly.status === "invalid") {
      issues.push({ code: "CONFIG_INVALID", rombelId: r.id, message: `${r.name}: total sesi per minggu tersimpan tidak valid (${weekly.message}).` });
    }

    const dist = resolveDistribution(input.distribution, ctx);
    const active = activeCount.get(r.id) ?? 0;
    rombels.push({
      id: r.id,
      name: r.name,
      classTypeId: r.classTypeId,
      studentCount: active > 0 ? active : classType.defaultSize,
      fixedRoomId: r.fixedRoomId,
      sessionsPerDay: perDay.status === "found" ? perDay.value : null,
      weeklySessions: weekly.status === "found" ? weekly.value : null,
      distribution:
        dist.status === "found"
          ? dist.items.map((i) => ({
              subtestId: i.subtestId,
              flexibleSubtestIds: i.flexibleSubtestIds.filter((id) => subtestIds.has(id)),
              label: i.label,
              sessionsPerWeek: i.sessionsPerWeek,
            }))
          : null,
    });
  }

  const competenciesByTutor = new Map<string, string[]>();
  for (const c of input.competencies) {
    if (!subtestIds.has(c.subtestId)) continue;
    const list = competenciesByTutor.get(c.tutorId) ?? [];
    list.push(c.subtestId);
    competenciesByTutor.set(c.tutorId, list);
  }
  const availabilityByTutor = new Map<string, Array<{ day: number; slotNo: number }>>();
  for (const a of input.availability) {
    if (!a.available) continue;
    const list = availabilityByTutor.get(a.tutorId) ?? [];
    list.push({ day: a.day, slotNo: a.slotNo });
    availabilityByTutor.set(a.tutorId, list);
  }

  const tutors = input.tutors
    .filter((t) => t.isSchedulable)
    .map((t) => ({
      id: t.id,
      name: t.name,
      level: t.level,
      competencies: competenciesByTutor.get(t.id) ?? [],
      availability: availabilityByTutor.get(t.id) ?? [],
    }));

  return {
    snapshot: {
      days: input.days.filter((d) => d.isActive).map((d) => d.dayOfWeek).sort((a, b) => a - b),
      slotNos: input.slots.filter((s) => s.isActive).map((s) => s.slotNo).sort((a, b) => a - b),
      subtests,
      rooms,
      rombels,
      tutors,
    },
    issues,
  };
}
