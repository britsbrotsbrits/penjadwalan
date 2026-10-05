import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { AvailabilityGrid } from "@/components/availability-grid";
import { toAvailabilityMap } from "@/lib/tutors/availability";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";
import { saveMyAvailabilityAction } from "@/server/tutors/actions";
import { getMyTutorProfile, listAvailability } from "@/server/tutors/queries";

export default async function TutorAvailabilityPage() {
  await requireRole(["tutor"]);
  const mine = await getMyTutorProfile();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <div>
        <Link href="/tutor" className="text-sm underline">
          &larr; Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Availability Saya</h1>
        <p className="mt-1 text-sm opacity-70">
          Centang waktu ketika Anda tersedia mengajar setiap minggu. Anda tidak akan dijadwalkan pada waktu
          yang tidak dicentang. Kotak bergaris putus-putus belum pernah Anda isi dan dianggap tidak tersedia.
          Menyimpan mengganti seluruh availability Anda.
        </p>
      </div>
      {mine ? <Form tutorId={mine.id} /> : (
        <p className="text-sm text-red-600">Akun Anda belum terdaftar sebagai mentor. Hubungi admin.</p>
      )}
    </main>
  );
}

async function Form({ tutorId }: { tutorId: string }) {
  const [cells, days, slots] = await Promise.all([
    listAvailability(tutorId),
    listCalendarDays(),
    listSessionSlots(),
  ]);
  const activeDays = days.filter((d) => d.isActive).map((d) => d.dayOfWeek).sort((a, b) => a - b);
  const activeSlots = slots.filter((s) => s.isActive).sort((a, b) => a.slotNo - b.slotNo);

  if (activeDays.length === 0 || activeSlots.length === 0) {
    return <p className="text-sm opacity-70">Admin belum mengatur hari dan sesi aktif. Coba lagi nanti.</p>;
  }

  return (
    <ActionForm action={saveMyAvailabilityAction} submitLabel="Simpan availability" className="flex flex-col gap-4">
      <AvailabilityGrid days={activeDays} slots={activeSlots} values={toAvailabilityMap(cells)} />
    </ActionForm>
  );
}
