import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { GridExport } from "@/components/grid-export";
import { buildWeekGrid, cellKey } from "@/lib/schedule/grid";
import { gridSvgSize, renderGridSvg } from "@/lib/schedule/grid-svg";
import { weekRangeLabel } from "@/lib/schedule/week";
import { addDays, parseIsoDate, weekStart } from "@/lib/validation/dates";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";
import { listMySchedule } from "@/server/schedule/my-schedule";
import { getMyTutorProfile, listAvailability } from "@/server/tutors/queries";

const MAX_WEEKS_AWAY = 26;

/** Tanggal hari ini di Asia/Jakarta (UTC+7), "YYYY-MM-DD". */
function todayJakarta(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function TutorSchedulePage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const session = await requireRole(["tutor"]);
  const sp = await searchParams;
  const mine = await getMyTutorProfile();
  const thisWeek = weekStart(todayJakarta());

  const raw = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  let week = thisWeek;
  if (raw && parseIsoDate(raw) !== null) {
    const w = weekStart(raw);
    const away = Math.abs(Math.round((Date.parse(w) - Date.parse(thisWeek)) / (7 * 86400000)));
    if (away <= MAX_WEEKS_AWAY) week = w;
  }

  if (!mine) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-red-600">Akun Anda belum terdaftar sebagai mentor. Hubungi admin.</p>
      </main>
    );
  }

  const [sessions, availability, days, slotRows] = await Promise.all([
    listMySchedule(week, addDays(week, 6)),
    listAvailability(mine.id),
    listCalendarDays(),
    listSessionSlots(),
  ]);
  const slots = slotRows.filter((s) => s.isActive).map((s) => ({ slotNo: s.slotNo, label: `${s.startTime}-${s.endTime}` }));
  const name = session.profile.fullName || session.user.email || "Mentor";
  const grid = buildWeekGrid({
    title: `Nama Mentor : ${name}`,
    subtitle: `Minggu ${weekRangeLabel(week)}`,
    weekStart: week,
    days: days.filter((d) => d.isActive).map((d) => d.dayOfWeek),
    slots,
    entries: sessions.map((s) => ({ date: s.sessionDate, slotNo: s.slotNo, lines: [s.subtestCode, s.rombelName, s.roomName] })),
    availableCells: new Set(availability.filter((a) => a.available).map((a) => cellKey(a.day, a.slotNo))),
  });
  const size = gridSvgSize(grid);
  const prev = addDays(week, -7);
  const next = addDays(week, 7);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 p-4 pb-24 sm:p-8">
      <div>
        <Link href="/tutor" className="text-sm text-primary hover:underline">
          &larr; Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Jadwal Saya</h1>
        <p className="mt-1 text-sm text-muted">
          Hanya jadwal yang sudah disetujui admin yang tampil. Tanda √ = Anda tersedia tetapi belum ada kelas.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`?week=${prev}`} className="text-primary hover:underline">
          &larr; Minggu sebelumnya
        </Link>
        <strong>{weekRangeLabel(week)}</strong>
        <Link href={`?week=${next}`} className="text-primary hover:underline">
          Minggu berikutnya &rarr;
        </Link>
        {week !== thisWeek ? (
          <Link href="?" className="text-primary hover:underline">
            Minggu ini
          </Link>
        ) : null}
        <span className="text-muted">({sessions.length} pertemuan)</span>
      </div>
      <GridExport svg={renderGridSvg(grid)} fileName={`jadwal-${name}-${week}`.replace(/[^A-Za-z0-9._-]+/g, "_")} width={size.width} height={size.height} />
    </main>
  );
}
