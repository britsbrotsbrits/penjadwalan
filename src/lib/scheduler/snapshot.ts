import { resolveDistribution, type DistributionItem } from "../config/distribution";
import { resolvePattern, type PatternItem } from "../config/pattern";
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
  days: ReadonlyArray<{ dayOfWeek: number; isActive: boolean; isTryout?: boolean }>;
  slots: ReadonlyArray<{ slotNo: number; isActive: boolean }>;
  subtests: ReadonlyArray<{ id: string; code: string; isActive: boolean }>;
  rooms: ReadonlyArray<{ id: string; name: string; capacity: number; isActive: boolean }>;
  programs: ReadonlyArray<{ id: string }>;
  classTypes: ReadonlyArray<{ id: string; programId: string; defaultSize: number }>;
  rombels: ReadonlyArray<{
    id: string;
    name: string;
    classTypeId: string;
    fixedRoomId: string | null;
    isActive: boolean;
    /** Sesi default rombel (Phase 14); mengalahkan pola tipe kelas/program. */
    defaultSlotNo?: number | null;
    /** Hari belajar default rombel (1..7); null = semua hari belajar. */
    defaultDays?: readonly number[] | null;
  }>;
  /** Jumlah siswa aktif per rombel; rombel yang tidak tercantum dianggap 0. */
  activeStudents: ReadonlyArray<{ rombelId: string; activeStudents: number }>;
  tutors: ReadonlyArray<{ id: string; name: string; level: number; isSchedulable: boolean }>;
  competencies: ReadonlyArray<{ tutorId: string; subtestId: string }>;
  availability: ReadonlyArray<{ tutorId: string; day: number; slotNo: number; available: boolean }>;
  settings: readonly SettingRow[];
  distribution: readonly DistributionItem[];
  /** Pola sesi harian (Phase 14); kosong = semua rombel dijadwalkan dengan cara lama. */
  patterns?: readonly PatternItem[];
  /** Pasangan subtes yang sebaiknya tidak sehari dalam satu rombel (aturan lunak). */
  exclusions?: ReadonlyArray<{ subtestA: string; subtestB: string }>;
};

export type SnapshotIssue = { code: "CONFIG_INVALID" | "CONFIG_MISSING"; rombelId: string; message: string };

export type BuiltSnapshot = { snapshot: SchedulingSnapshot; issues: SnapshotIssue[] };

export function buildSnapshot(input: SnapshotInput): BuiltSnapshot {
  const issues: SnapshotIssue[] = [];
  const classTypeById = new Map(input.classTypes.map((c) => [c.id, c]));
  const activeCount = new Map(input.activeStudents.map((s) => [s.rombelId, s.activeStudents]));

  const subtests = input.subtests.filter((s) => s.isActive).map((s) => ({ id: s.id, code: s.code }));
  const subtestIds = new Set(subtests.map((s) => s.id));
  const activeSlotNos = new Set(input.slots.filter((x) => x.isActive).map((x) => x.slotNo));
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
    // Sesi default rombel mengalahkan pola tipe kelas/program.
    let pattern: { subtestSlots: number[]; drillingSlots: number[] } | null = null;
    if (r.defaultSlotNo != null) {
      if (activeSlotNos.has(r.defaultSlotNo)) pattern = { subtestSlots: [r.defaultSlotNo], drillingSlots: [] };
      else {
        issues.push({ code: "CONFIG_INVALID", rombelId: r.id, message: `${r.name}: sesi default ${r.defaultSlotNo} tidak aktif di menu Kalender; sesi default diabaikan.` });
      }
    }
    if (!pattern) {
      const pat = resolvePattern(input.patterns ?? [], ctx);
      // Pola hanya dipakai bila punya sesi SUBTEST yang aktif di grid.
      const subtestSlots = pat.status === "found" ? pat.subtestSlots.filter((n) => activeSlotNos.has(n)) : [];
      if (pat.status === "found" && subtestSlots.length > 0) {
        pattern = { subtestSlots, drillingSlots: pat.drillingSlots.filter((n) => activeSlotNos.has(n)) };
      } else if (pat.status === "found") {
        issues.push({ code: "CONFIG_INVALID", rombelId: r.id, message: `${r.name}: pola sesi tidak punya sesi subtes yang aktif; pola diabaikan.` });
      }
    }
    const rombelDays = r.defaultDays && r.defaultDays.length > 0 ? [...new Set(r.defaultDays)].sort((a, b) => a - b) : null;
    const active = activeCount.get(r.id) ?? 0;
    rombels.push({
      id: r.id,
      name: r.name,
      classTypeId: r.classTypeId,
      studentCount: active > 0 ? active : classType.defaultSize,
      fixedRoomId: r.fixedRoomId,
      sessionsPerDay: pattern ? pattern.subtestSlots.length : perDay.status === "found" ? perDay.value : null,
      pattern,
      days: rombelDays,
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
      days: input.days.filter((d) => d.isActive && !d.isTryout).map((d) => d.dayOfWeek).sort((a, b) => a - b),
      tryoutDays: input.days.filter((d) => d.isTryout).map((d) => d.dayOfWeek),
      slotNos: input.slots.filter((s) => s.isActive).map((s) => s.slotNo).sort((a, b) => a - b),
      subtests,
      rooms,
      rombels,
      tutors,
      sameDayExclusions: (input.exclusions ?? [])
        .filter((e) => subtestIds.has(e.subtestA) && subtestIds.has(e.subtestB) && e.subtestA !== e.subtestB)
        .map((e) => [e.subtestA, e.subtestB] as const),
    },
    issues,
  };
}
