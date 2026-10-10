import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { GridExport } from "@/components/grid-export";
import { buttonClass, selectClass } from "@/components/form-styles";
import { Card, PageHeader } from "@/components/ui";
import { buildWeekGrid, cellKey, patternNotes, type GridEntry } from "@/lib/schedule/grid";
import { gridSvgSize, renderGridSvg } from "@/lib/schedule/grid-svg";
import { addDays } from "@/lib/validation/dates";
import { neighbourWeeks, resolveWeek, weekRangeLabel } from "@/lib/schedule/week";
import { resolvePattern } from "@/lib/config/pattern";
import { listSessionPatterns } from "@/server/config/queries";
import { listClassTypes } from "@/server/academic/queries";
import { listCalendarDays } from "@/server/master-data/queries";
import { getPeriod, listPeriodSessions, loadScheduleLookups } from "@/server/schedule/queries";
import { listAvailability } from "@/server/tutors/queries";

type SearchParams = { tutor?: string; rombel?: string; week?: string };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function ScheduleTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const period = await getPeriod(id);
  if (!period) notFound();

  const [sessions, lookups, days, patterns, classTypes] = await Promise.all([
    listPeriodSessions(id),
    loadScheduleLookups(),
    listCalendarDays(),
    listSessionPatterns(),
    listClassTypes(),
  ]);
  const tutorId = one(sp.tutor);
  const rombelId = one(sp.rombel);
  const week = resolveWeek(one(sp.week), period.startDate, period.endDate);
  const nav = neighbourWeeks(week, period.startDate, period.endDate);

  const tutorName = new Map(lookups.tutors.map((t) => [t.id, t.name]));
  const rombelName = new Map(lookups.rombels.map((r) => [r.id, r.name]));
  const roomName = new Map(lookups.rooms.map((r) => [r.id, r.name]));
  const subtestCode = new Map(lookups.subtests.map((s) => [s.id, s.code]));
  const slots = lookups.slots.filter((s) => s.isActive).map((s) => ({ slotNo: s.slotNo, label: `${s.startTime}-${s.endTime}` }));
  const activeDays = days.filter((d) => d.isActive && !d.isTryout).map((d) => d.dayOfWeek);
  const tryoutDay = days.find((d) => d.isTryout)?.dayOfWeek ?? null;

  const mode: "mentor" | "kelas" | null = tutorId && tutorName.has(tutorId) ? "mentor" : rombelId && rombelName.has(rombelId) ? "kelas" : null;

  let svg = "";
  let size = { width: 0, height: 0 };
  let fileName = "jadwal";
  let sessionCount = 0;
  if (mode) {
    const mine = sessions.filter((s) => (mode === "mentor" ? s.tutorId === tutorId : s.rombelId === rombelId));
    const entries: GridEntry[] = mine.map((s) => ({
      date: s.sessionDate,
      slotNo: s.slotNo,
      lines:
        mode === "mentor"
          ? [s.displayLabel ?? subtestCode.get(s.subtestId) ?? "?", rombelName.get(s.rombelId) ?? "?", roomName.get(s.roomId) ?? "?"]
          : [s.displayLabel ?? subtestCode.get(s.subtestId) ?? "?", tutorName.get(s.tutorId) ?? "?", roomName.get(s.roomId) ?? "?"],
    }));
    sessionCount = entries.filter((e) => e.date >= week && e.date <= addDays(week, 6)).length;

    let availableCells: Set<string> | undefined;
    if (mode === "mentor") {
      const av = await listAvailability(tutorId);
      availableCells = new Set(av.filter((a) => a.available).map((a) => cellKey(a.day, a.slotNo)));
    }
    // Tampilan kelas: DRILLING pada sesi drilling dan TRYOUT pada hari tryout (hanya bila rombel punya pola/sesi default).
    let notes: Map<string, string> | undefined;
    let gridDays = activeDays;
    if (mode === "kelas") {
      const rb = lookups.rombels.find((r) => r.id === rombelId);
      const ct = classTypes.find((c) => c.id === rb?.classTypeId);
      const pat = rb
        ? rb.defaultSlotNo != null
          ? { status: "found" as const, subtestSlots: [rb.defaultSlotNo], drillingSlots: [] as number[] }
          : resolvePattern(patterns, { rombelId: rb.id, classTypeId: rb.classTypeId, programId: ct?.programId })
        : { status: "missing" as const };
      if (pat.status === "found") {
        const own = rb?.defaultDays && rb.defaultDays.length > 0 ? activeDays.filter((d) => rb.defaultDays!.includes(d)) : activeDays;
        notes = patternNotes({ regularDays: own, tryoutDay, subtestSlots: pat.subtestSlots, drillingSlots: pat.drillingSlots });
        if (tryoutDay !== null) gridDays = [...activeDays, tryoutDay].sort((a, b) => a - b);
      }
    }
    const name = mode === "mentor" ? tutorName.get(tutorId)! : rombelName.get(rombelId)!;
    const grid = buildWeekGrid({
      title: `${mode === "mentor" ? "Nama Mentor" : "Kelas"} : ${name}`,
      subtitle: `Minggu ${weekRangeLabel(week)} · ${period.name}`,
      weekStart: week,
      days: gridDays,
      slots,
      entries,
      availableCells,
      notes,
      periodStart: period.startDate,
      periodEnd: period.endDate,
    });
    svg = renderGridSvg(grid);
    size = gridSvgSize(grid);
    fileName = `jadwal-${name}-${week}`.replace(/[^A-Za-z0-9._-]+/g, "_");
  }

  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (mode === "mentor") p.set("tutor", tutorId);
    if (mode === "kelas") p.set("rombel", rombelId);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/jadwal/${id}`} className="text-sm text-primary hover:underline">
          &larr; {period.name}
        </Link>
      </div>
      <PageHeader
        title="Tabel jadwal"
        description="Tampilan per mentor atau per kelas, satu minggu. Tanda √ = mentor tersedia tetapi belum ada kelas."
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-56 flex-col gap-1 text-sm">
            Mentor
            <select name="tutor" defaultValue={mode === "mentor" ? tutorId : ""} className={selectClass}>
              <option value="">(pilih mentor)</option>
              {lookups.tutors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-56 flex-col gap-1 text-sm">
            atau Kelas (rombel)
            <select name="rombel" defaultValue={mode === "kelas" ? rombelId : ""} className={selectClass}>
              <option value="">(pilih kelas)</option>
              {lookups.rombels.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass}>
            Tampilkan
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">Bila keduanya dipilih, tampilan mentor yang dipakai.</p>
      </Card>

      {mode ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            {nav.prev ? (
              <Link href={q({ week: nav.prev })} className="text-primary hover:underline">
                &larr; Minggu sebelumnya
              </Link>
            ) : (
              <span className="text-muted">&larr; Minggu sebelumnya</span>
            )}
            <strong>{weekRangeLabel(week)}</strong>
            {nav.next ? (
              <Link href={q({ week: nav.next })} className="text-primary hover:underline">
                Minggu berikutnya &rarr;
              </Link>
            ) : (
              <span className="text-muted">Minggu berikutnya &rarr;</span>
            )}
            <span className="text-muted">({sessionCount} pertemuan minggu ini)</span>
          </div>
          <GridExport svg={svg} fileName={fileName} width={size.width} height={size.height} />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">Pilih mentor atau kelas lalu klik Tampilkan.</p>
        </Card>
      )}
    </div>
  );
}
