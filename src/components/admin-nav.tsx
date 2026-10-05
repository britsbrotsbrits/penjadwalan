"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; exact?: boolean };

// Mengikuti struktur sidebar di master prompt. Menu lain ditambahkan saat fiturnya dibangun.
const GROUPS: ReadonlyArray<{ title: string; items: readonly NavItem[] }> = [
  { title: "Dashboard", items: [{ href: "/admin", label: "Dashboard", exact: true }] },
  { title: "Akademik", items: [{ href: "/admin/subtes", label: "Subtes" }] },
  {
    title: "Program & Kelas",
    items: [
      { href: "/admin/program", label: "Program" },
      { href: "/admin/tipe-kelas", label: "Tipe Kelas" },
      { href: "/admin/rombel", label: "Rombel" },
      { href: "/admin/siswa", label: "Siswa" },
    ],
  },
  {
    title: "Mentor",
    items: [
      { href: "/admin/mentor", label: "Daftar Mentor" },
      { href: "/admin/kompetensi", label: "Kompetensi" },
      { href: "/admin/availability", label: "Availability" },
    ],
  },
  {
    title: "Operasional",
    items: [
      { href: "/admin/ruangan", label: "Ruangan" },
      { href: "/admin/kalender", label: "Kalender" },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Menu admin" className="flex flex-col gap-5 text-sm">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide opacity-50">
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
                className={active ? "font-semibold underline" : "opacity-80 hover:underline"}
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
