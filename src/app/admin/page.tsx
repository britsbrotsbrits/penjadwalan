import Link from "next/link";
import { requireRole } from "@/lib/auth/session";

const SHORTCUTS = [
  { href: "/admin/subtes", title: "Subtes", description: "Kelola daftar subtes dan urutannya." },
  { href: "/admin/ruangan", title: "Ruangan", description: "Kelola ruangan dan kapasitasnya." },
  { href: "/admin/program", title: "Program", description: "Kelola program (Kelas 3 SMA, Gap Year, dst)." },
  { href: "/admin/tipe-kelas", title: "Tipe Kelas", description: "Kelola tipe kelas dan ukuran standarnya." },
  { href: "/admin/rombel", title: "Rombel", description: "Kelola rombel dan pantau jumlah siswanya." },
  { href: "/admin/siswa", title: "Siswa", description: "Kelola siswa dan pindah rombel." },
  { href: "/admin/mentor", title: "Daftar Mentor", description: "Kelola mentor, level, rate, dan status." },
  { href: "/admin/kompetensi", title: "Kompetensi", description: "Tetapkan subtes yang boleh diajar tiap mentor." },
  { href: "/admin/availability", title: "Availability", description: "Pantau dan isi availability mentor." },
  {
    href: "/admin/kalender",
    title: "Kalender",
    description: "Atur hari aktif dan slot sesi harian.",
  },
] as const;

export default async function AdminHomePage() {
  // Dipanggil lagi di page: layout tidak dijalankan ulang pada navigasi sisi client.
  await requireRole(["admin"]);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard Admin</h1>
        <p className="mt-1 text-sm opacity-70">
          Master data, program, rombel, siswa, dan mentor tersedia. Fitur lain dibangun bertahap sesuai roadmap.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SHORTCUTS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded border border-current/20 p-4 hover:border-current/50"
            >
              <span className="font-medium">{item.title}</span>
              <span className="mt-1 block text-sm opacity-70">{item.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
