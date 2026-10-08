import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getMyTutorProfile } from "@/server/tutors/queries";
import { formatRupiah } from "@/lib/tutors/labels";

export default async function TutorHomePage() {
  await requireRole(["tutor"]);
  const mine = await getMyTutorProfile();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard Mentor</h1>
        <p className="mt-2 text-sm opacity-70">
          Lihat jadwal mengajar Anda dan isi availability. Isi presensi hari ini di menu Presensi.
        </p>
      </div>

      {mine === null ? (
        <p className="text-sm text-red-600">Akun Anda belum terdaftar sebagai mentor. Hubungi admin.</p>
      ) : (
        <>
          {mine.availabilityUpdatedAt === null ? (
            <p role="status" className="rounded border border-amber-600/50 p-3 text-sm">
              Anda belum mengisi availability. Admin tidak dapat menjadwalkan Anda sebelum itu.
            </p>
          ) : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            <li>
              <Link href="/tutor/absensi" className="block rounded border border-current/20 p-4 hover:border-current/50">
                <span className="font-medium">Presensi</span>
                <span className="mt-1 block text-sm opacity-70">Isi presensi sesi hari ini: hadir, tukar, atau menggantikan.</span>
              </Link>
            </li>
            <li>
              <Link href="/tutor/jadwal" className="block rounded border border-current/20 p-4 hover:border-current/50">
                <span className="font-medium">Jadwal saya</span>
                <span className="mt-1 block text-sm opacity-70">Lihat jadwal mingguan, unduh PNG atau simpan PDF.</span>
              </Link>
            </li>
            <li>
              <Link href="/tutor/availability" className="block rounded border border-current/20 p-4 hover:border-current/50">
                <span className="font-medium">Availability saya</span>
                <span className="mt-1 block text-sm opacity-70">Isi atau ubah waktu Anda tersedia mengajar.</span>
              </Link>
            </li>
            <li className="rounded border border-current/20 p-4 text-sm">
              <span className="font-medium">Rate saya</span>
              <span className="mt-1 block opacity-70">
                {formatRupiah(mine.ratePerSession)} per sesi
                {mine.ratePerSession === null ? " (belum diisi admin)" : ""}
              </span>
            </li>
          </ul>
        </>
      )}
    </main>
  );
}
