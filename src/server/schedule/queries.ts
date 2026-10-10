import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/fetch-all";
import {
  periodRowSchema,
  runRowSchema,
  sessionRowSchema,
  unscheduledRowSchema,
  type SchedulePeriod,
  type SchedulingRun,
  type TeachingSession,
  type UnscheduledRequirement,
} from "@/lib/schedule/schemas";
import type { RombelWindow } from "@/lib/validation/expand";
import { buildSnapshot, type BuiltSnapshot } from "@/lib/scheduler/snapshot";
import type { ViolationCode } from "@/lib/validation/violations";
import { isViolationCode } from "@/lib/validation/violations";
import { listSettings, listDistributionItems, listSessionPatterns } from "@/server/config/queries";
import { listCalendarDays, listRooms, listSessionSlots, listSubtests } from "@/server/master-data/queries";
import { listClassTypes, listPrograms, listRombelCounts, listRombels } from "@/server/academic/queries";
import { listAvailability, listCompetencies, listTutorAccounts, listTutorProfiles } from "@/server/tutors/queries";

// Hanya untuk kode server; RLS membatasi pembacaan jadwal ke admin (hasil kosong = bukan admin).
// Halaman tetap memanggil requireRole() sendiri.

function loadFailed(what: string): Error {
  return new Error(`Gagal memuat ${what}.`);
}

const PERIOD_COLUMNS = "id, name, start_date, end_date, status";

export async function listPeriods(): Promise<SchedulePeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_periods")
    .select(PERIOD_COLUMNS)
    .order("start_date", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw loadFailed("periode jadwal");
  return z.array(periodRowSchema).parse(data ?? []);
}

export async function getPeriod(id: string): Promise<SchedulePeriod | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("schedule_periods").select(PERIOD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw loadFailed("periode jadwal");
  return data ? periodRowSchema.parse(data) : null;
}

/** Semua sesi SCHEDULED pada periode (dibaca per halaman supaya tidak terpotong batas 1000 baris). */
export async function listPeriodSessions(periodId: string): Promise<TeachingSession[]> {
  const supabase = await createClient();
  const rows = await fetchAll("sesi jadwal", (from, to) =>
    supabase
      .from("teaching_sessions")
      .select("id, period_id, session_date, slot_no, rombel_id, subtest_id, tutor_id, room_id, source, display_label")
      .eq("period_id", periodId)
      .eq("status", "SCHEDULED")
      .order("session_date", { ascending: true })
      .order("slot_no", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return z.array(sessionRowSchema).parse(rows);
}

export async function getLatestRun(periodId: string): Promise<SchedulingRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduling_runs")
    .select("id, seed, summary, created_at")
    .eq("period_id", periodId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw loadFailed("riwayat generate");
  return data ? runRowSchema.parse(data) : null;
}

export async function listUnscheduled(runId: string): Promise<UnscheduledRequirement[]> {
  const supabase = await createClient();
  const rows = await fetchAll("kebutuhan belum terpenuhi", (from, to) =>
    supabase
      .from("unscheduled_requirements")
      .select("id, rombel_id, label, subtest_ids, missing_per_week, reason_code, detail")
      .eq("run_id", runId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return z.array(unscheduledRowSchema).parse(rows);
}

export type SessionViolation = { sessionId: string; code: ViolationCode };

/** Pelanggaran aturan per sesi menurut database (validasi sisi database). */
export async function listViolations(periodId: string): Promise<{ rows: SessionViolation[]; truncated: boolean }> {
  const supabase = await createClient();
  const LIMIT = 2000;
  const { data, error } = await supabase.rpc("schedule_violations", { p_period_id: periodId }).range(0, LIMIT);
  if (error) throw loadFailed("validasi jadwal");
  const parsed = z.array(z.object({ session_id: z.string().uuid(), code: z.string() })).parse(data ?? []);
  const rows = parsed
    .filter((r): r is { session_id: string; code: ViolationCode } => isViolationCode(r.code))
    .map((r) => ({ sessionId: r.session_id, code: r.code }));
  return { rows: rows.slice(0, LIMIT), truncated: parsed.length > LIMIT };
}

/** Data referensi untuk menampilkan nama dan mengisi pilihan form. */
export async function loadScheduleLookups() {
  const [subtests, rooms, slots, rombels, tutorProfiles, tutorAccounts, competencies] = await Promise.all([
    listSubtests(),
    listRooms(),
    listSessionSlots(),
    listRombels(),
    listTutorProfiles(),
    listTutorAccounts(),
    listCompetencies(),
  ]);
  const accountName = new Map(tutorAccounts.map((a) => [a.id, a.fullName]));
  const tutors = tutorProfiles.map((t) => ({
    id: t.id,
    name: accountName.get(t.profileId) || "(tanpa nama)",
    isActive: t.isSchedulable,
  }));
  return { subtests, rooms, slots, rombels, tutors, competencies };
}

/** Snapshot nyata untuk scheduler (data aktif saat ini), beserta isu konfigurasi. */
export async function loadSchedulingSnapshot(): Promise<BuiltSnapshot & { rombelWindows: Map<string, RombelWindow> }> {
  const [days, slots, subtests, rooms, programs, classTypes, rombels, counts, tutorProfiles, tutorAccounts, competencies, availability, settings, distribution, patterns] =
    await Promise.all([
      listCalendarDays(),
      listSessionSlots(),
      listSubtests(),
      listRooms(),
      listPrograms(),
      listClassTypes(),
      listRombels(),
      listRombelCounts(),
      listTutorProfiles(),
      listTutorAccounts(),
      listCompetencies(),
      listAvailability(),
      listSettings(),
      listDistributionItems(),
      listSessionPatterns(),
    ]);
  const accountName = new Map(tutorAccounts.map((a) => [a.id, a.fullName]));

  const built = buildSnapshot({
    days,
    slots,
    subtests,
    rooms,
    programs,
    classTypes,
    rombels,
    activeStudents: counts,
    tutors: tutorProfiles.map((t) => ({
      id: t.id,
      name: accountName.get(t.profileId) || t.id,
      level: t.level,
      isSchedulable: t.isSchedulable,
    })),
    competencies,
    availability,
    settings,
    distribution,
    patterns,
  });
  const rombelWindows = new Map(rombels.map((r) => [r.id, { start: r.startDate, end: r.endDate, cycleWeeks: r.cycleWeeks, cycleAnchor: r.cycleAnchor }]));
  return { ...built, rombelWindows };
}
