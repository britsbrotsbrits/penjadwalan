import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { AvailabilityGrid } from "@/components/availability-grid";
import { isUuid } from "@/lib/academic/search";
import { toAvailabilityMap } from "@/lib/tutors/availability";
import { tutorDisplayName } from "@/lib/tutors/labels";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";
import { saveTutorAvailabilityAction } from "@/server/tutors/actions";
import {
  getAccountEmails,
  listAvailability,
  listTutorAccounts,
  listTutorProfiles,
} from "@/server/tutors/queries";

type Props = { params: Promise<{ id: string }> };

export default async function AdminTutorAvailabilityPage({ params }: Props) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [accounts, profiles] = await Promise.all([listTutorAccounts(), listTutorProfiles()]);
  const profile = profiles.find((p) => p.id === id);
  const account = profile ? accounts.find((a) => a.id === profile.profileId) : undefined;
  if (!profile || !account) notFound();

  const [cells, days, slots, emails] = await Promise.all([
    listAvailability(id),
    listCalendarDays(),
    listSessionSlots(),
    getAccountEmails([account.id]),
  ]);
  const activeDays = days.filter((d) => d.isActive).map((d) => d.dayOfWeek).sort((a, b) => a - b);
  const activeSlots = slots.filter((s) => s.isActive).sort((a, b) => a.slotNo - b.slotNo);
  const name = tutorDisplayName(account.fullName, emails.get(account.id) ?? null);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/admin/availability" className="text-sm underline">
          &larr; Availability mentor
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Availability: {name}</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Centang waktu ketika mentor tersedia mengajar. Menyimpan mengganti seluruh availability mentor ini.
          Kotak bergaris putus-putus belum pernah diisi dan dianggap tidak tersedia.
        </p>
      </div>

      {activeDays.length === 0 || activeSlots.length === 0 ? (
        <p className="text-sm text-red-600">
          Belum ada hari aktif atau slot sesi aktif. Atur di menu Kalender terlebih dulu.
        </p>
      ) : (
        <ActionForm
          action={saveTutorAvailabilityAction}
          submitLabel="Simpan availability"
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="tutorId" value={id} />
          <AvailabilityGrid days={activeDays} slots={activeSlots} values={toAvailabilityMap(cells)} />
        </ActionForm>
      )}
    </main>
  );
}
