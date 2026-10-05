import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { headerCellClass, rowClass } from "@/components/form-styles";
import {
  AVAILABILITY_STATUS_LABEL,
  availabilityStatus,
  summarizeAvailability,
  type AvailabilityStatus,
} from "@/lib/tutors/availability";
import { tutorDisplayName } from "@/lib/tutors/labels";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";
import {
  getAccountEmails,
  listAvailability,
  listTutorAccounts,
  listTutorProfiles,
} from "@/server/tutors/queries";

const GRID = "grid-cols-[minmax(12rem,1fr)_9rem_9rem_12rem_auto]";

const statusClass: Record<AvailabilityStatus, string> = {
  belum_diisi: "text-red-600",
  perlu_dilengkapi: "text-amber-600",
  lengkap: "text-green-600",
};

const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

function formatUpdatedAt(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${dateTime.format(date)} WIB`;
}

export default async function AvailabilityListPage() {
  await requireRole(["admin"]);
  const [accounts, profiles, cells, days, slots] = await Promise.all([
    listTutorAccounts(),
    listTutorProfiles(),
    listAvailability(),
    listCalendarDays(),
    listSessionSlots(),
  ]);
  const emails = await getAccountEmails(accounts.map((a) => a.id));

  const activeDays = days.filter((d) => d.isActive).map((d) => d.dayOfWeek);
  const activeSlots = slots.filter((s) => s.isActive).map((s) => s.slotNo);

  const cellsByTutor = new Map<string, typeof cells>();
  for (const cell of cells) {
    const list = cellsByTutor.get(cell.tutorId) ?? [];
    list.push(cell);
    cellsByTutor.set(cell.tutorId, list);
  }

  const profileByAccount = new Map(profiles.map((p) => [p.profileId, p]));
  const rows = accounts.flatMap((account) => {
    const profile = profileByAccount.get(account.id);
    if (!profile) return [];
    const summary = summarizeAvailability(cellsByTutor.get(profile.id) ?? [], activeDays, activeSlots);
    return [
      {
        account,
        profile,
        summary,
        status: availabilityStatus(profile.availabilityUpdatedAt, summary),
        name: tutorDisplayName(account.fullName, emails.get(account.id) ?? null),
      },
    ];
  });
  // Yang belum mengisi tampil paling atas supaya langsung terlihat.
  const order: Record<AvailabilityStatus, number> = { belum_diisi: 0, perlu_dilengkapi: 1, lengkap: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const notFilled = rows.filter((r) => r.status === "belum_diisi").length;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Availability Mentor</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Availability adalah batas keras penjadwalan: mentor tidak akan dijadwalkan pada waktu yang tidak
          dicentang. Sel yang belum pernah diisi dianggap tidak tersedia. Mentor mengisi sendiri dari
          halaman mereka; admin juga dapat mengisikan atas nama mentor.
        </p>
      </div>

      <p className="text-sm" role="status">
        <strong>{notFilled}</strong> dari {rows.length} mentor belum mengisi availability.
        {activeDays.length === 0 || activeSlots.length === 0 ? (
          <span className="ml-2 text-red-600">
            Belum ada hari aktif atau slot sesi aktif; atur di menu Kalender.
          </span>
        ) : null}
      </p>

      <section aria-label="Status availability mentor" className="overflow-x-auto">
        <div className="min-w-[56rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Mentor</span>
            <span className={headerCellClass}>Status</span>
            <span className={headerCellClass}>Sel tersedia</span>
            <span className={headerCellClass}>Terakhir diubah</span>
            <span />
          </div>
          {rows.length === 0 ? <p className="py-4 text-sm opacity-70">Belum ada mentor.</p> : null}
          {rows.map((row) => (
            <div key={row.profile.id} className={`${rowClass} ${GRID} text-sm`}>
              <span>
                {row.name}
                {row.profile.isSchedulable ? "" : <span className="block text-xs opacity-60">Belum dapat dijadwalkan</span>}
              </span>
              <span className={statusClass[row.status]}>{AVAILABILITY_STATUS_LABEL[row.status]}</span>
              <span>
                {row.summary.available} / {row.summary.total}
                {row.summary.unfilled > 0 && row.status !== "belum_diisi" ? (
                  <span className="block text-xs opacity-60">{row.summary.unfilled} sel belum diisi</span>
                ) : null}
              </span>
              <span>{formatUpdatedAt(row.profile.availabilityUpdatedAt)}</span>
              <Link href={`/admin/availability/${row.profile.id}`} className="underline">
                {row.status === "belum_diisi" ? "Isi" : "Ubah"}
              </Link>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
