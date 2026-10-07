"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

type NavItem = { href: string; label: string; exact?: boolean };

// Mengikuti struktur sidebar di master prompt. Menu lain ditambahkan saat fiturnya dibangun.
const GROUPS: ReadonlyArray<{ title: string; icon: IconName; items: readonly NavItem[] }> = [
  { title: "Dashboard", icon: "dashboard", items: [{ href: "/admin", label: "Dashboard", exact: true }] },
  {
    title: "Akademik",
    icon: "book",
    items: [
      { href: "/admin/subtes", label: "Subtes" },
      { href: "/admin/sesi-kurikulum", label: "Sesi & Kurikulum" },
      { href: "/admin/distribusi", label: "Distribusi Subtes" },
    ],
  },
  {
    title: "Program & Kelas",
    icon: "layers",
    items: [
      { href: "/admin/program", label: "Program" },
      { href: "/admin/tipe-kelas", label: "Tipe Kelas" },
      { href: "/admin/rombel", label: "Rombel" },
      { href: "/admin/siswa", label: "Siswa" },
    ],
  },
  {
    title: "Mentor",
    icon: "users",
    items: [
      { href: "/admin/mentor", label: "Daftar Mentor" },
      { href: "/admin/kompetensi", label: "Kompetensi" },
      { href: "/admin/availability", label: "Availability" },
    ],
  },
  { title: "Penjadwalan", icon: "play", items: [{ href: "/admin/simulator", label: "Simulator" }] },
  {
    title: "Operasional",
    icon: "building",
    items: [
      { href: "/admin/ruangan", label: "Ruangan" },
      { href: "/admin/kalender", label: "Kalender" },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Menu admin" className="flex flex-col gap-4 text-sm">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <Icon name={group.icon} className="h-4 w-4" />
            {group.title}
          </span>
          {group.items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-2 py-1.5 pl-8 ${
                  active
                    ? "bg-primary font-medium text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
