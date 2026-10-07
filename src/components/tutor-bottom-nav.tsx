"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

const ITEMS: ReadonlyArray<{ href: string; label: string; icon: IconName; exact?: boolean }> = [
  { href: "/tutor", label: "Beranda", icon: "home", exact: true },
  { href: "/tutor/availability", label: "Availability", icon: "calendar" },
];

export function TutorBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Menu mentor"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface md:static md:border-0 md:bg-transparent"
    >
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium md:flex-none md:flex-row md:gap-2 md:rounded-lg md:px-3 md:text-sm ${
              active ? "text-primary md:bg-primary-soft" : "text-muted hover:text-foreground"
            }`}
          >
            <Icon name={item.icon} className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
