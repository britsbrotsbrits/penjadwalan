import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Icon, type IconName } from "@/components/icons";

type Accent = "sky" | "emerald" | "violet" | "orange" | "rose" | "teal" | "amber" | "indigo";

// Kelas ditulis utuh (bukan disusun dari string) supaya Tailwind mengenalinya.
const ACCENTS: Record<Accent, { chip: string; arrow: string; blob: string }> = {
  sky: { chip: "bg-sky-100 text-sky-600", arrow: "bg-sky-100 text-sky-600", blob: "bg-sky-100" },
  emerald: { chip: "bg-emerald-100 text-emerald-600", arrow: "bg-emerald-100 text-emerald-600", blob: "bg-emerald-100" },
  violet: { chip: "bg-violet-100 text-violet-600", arrow: "bg-violet-100 text-violet-600", blob: "bg-violet-100" },
  orange: { chip: "bg-orange-100 text-orange-600", arrow: "bg-orange-100 text-orange-600", blob: "bg-orange-100" },
  rose: { chip: "bg-rose-100 text-rose-600", arrow: "bg-rose-100 text-rose-600", blob: "bg-rose-100" },
  teal: { chip: "bg-teal-100 text-teal-600", arrow: "bg-teal-100 text-teal-600", blob: "bg-teal-100" },
  amber: { chip: "bg-amber-100 text-amber-600", arrow: "bg-amber-100 text-amber-600", blob: "bg-amber-100" },
  indigo: { chip: "bg-indigo-100 text-indigo-600", arrow: "bg-indigo-100 text-indigo-600", blob: "bg-indigo-100" },
};

type Shortcut = { href: string; title: string; description: string; icon: IconName; accent: Accent };

const SHORTCUTS: readonly Shortcut[] = [
  { href: "/admin/subtes", title: "Subtes", description: "Kelola daftar subtes dan urutannya.", icon: "database", accent: "sky" },
  { href: "/admin/ruangan", title: "Ruangan", description: "Kelola ruangan dan kapasitasnya.", icon: "home", accent: "emerald" },
  { href: "/admin/program", title: "Program", description: "Kelola program (Kelas 3 SMA, Gap Year, dst).", icon: "cap", accent: "violet" },
  { href: "/admin/tipe-kelas", title: "Tipe Kelas", description: "Kelola tipe kelas dan ukuran standarnya.", icon: "users", accent: "orange" },
  { href: "/admin/rombel", title: "Rombel", description: "Kelola rombel dan pantau jumlah siswanya.", icon: "cube", accent: "rose" },
  { href: "/admin/siswa", title: "Siswa", description: "Kelola siswa dan pindah rombel.", icon: "user", accent: "teal" },
  { href: "/admin/mentor", title: "Daftar Mentor", description: "Kelola mentor, level, rate, dan status.", icon: "userplus", accent: "violet" },
  { href: "/admin/kompetensi", title: "Kompetensi", description: "Tetapkan subtes yang boleh diajar tiap mentor.", icon: "shield", accent: "amber" },
  { href: "/admin/availability", title: "Availability", description: "Pantau dan isi availability mentor.", icon: "calendar", accent: "indigo" },
  { href: "/admin/kalender", title: "Kalender", description: "Atur hari aktif dan slot sesi harian.", icon: "calendar", accent: "teal" },
  { href: "/admin/sesi-kurikulum", title: "Sesi & Kurikulum", description: "Atur sesi per hari dan per minggu.", icon: "sliders", accent: "sky" },
  { href: "/admin/distribusi", title: "Distribusi Subtes", description: "Atur jumlah sesi tiap subtes per minggu.", icon: "layers", accent: "orange" },
  { href: "/admin/jadwal", title: "Jadwal", description: "Buat, periksa, dan sesuaikan jadwal per periode.", icon: "calendar", accent: "indigo" },
  { href: "/admin/simulator", title: "Simulator", description: "Uji mesin penjadwalan dengan data simulasi.", icon: "flask", accent: "rose" },
];

export default async function AdminHomePage() {
  // Dipanggil lagi di page: layout tidak dijalankan ulang pada navigasi sisi client.
  const session = await requireRole(["admin"]);
  const name = session.profile.fullName || session.user.email || "Admin";

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">
          Selamat datang, <span className="font-medium text-primary">{name}</span>
        </p>
        <h1 className="mt-1 text-2xl font-bold text-navy sm:text-[32px]">Dashboard Admin</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Master data, program, rombel, siswa, dan mentor tersedia. Fitur lain dibangun bertahap sesuai roadmap.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SHORTCUTS.map((item) => {
          const a = ACCENTS[item.accent];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span aria-hidden="true" className={`absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-60 ${a.blob}`} />
                <span className={`relative flex h-11 w-11 items-center justify-center rounded-xl ${a.chip}`}>
                  <Icon name={item.icon} className="h-6 w-6" />
                </span>
                <div className="relative flex flex-1 items-end justify-between gap-3">
                  <div>
                    <h4 className="text-foreground">{item.title}</h4>
                    <p className="mt-0.5 text-sm text-muted">{item.description}</p>
                  </div>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.arrow}`}>
                    <Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
