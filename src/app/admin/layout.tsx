import { requireRole } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin-nav";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icons";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["admin"]);
  const name = session.profile.fullName || session.user.email || "Pengguna";

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 bg-navy px-3 py-5 md:flex md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        <div className="px-2">
          <Brand onDark />
        </div>
        <AdminNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 md:px-6">
          {/* Menu (mobile) */}
          <details className="relative md:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 text-navy hover:bg-neutral-soft">
              <Icon name="menu" />
              <span className="text-sm font-medium">Menu</span>
            </summary>
            <div className="absolute left-0 top-full z-20 mt-2 max-h-[80vh] w-64 overflow-y-auto rounded-xl bg-navy p-3 shadow-lg">
              <AdminNav />
            </div>
          </details>
          <span className="hidden text-sm font-medium text-muted md:block">Edu Ops · Admin</span>
          <div className="flex items-center gap-2 text-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft font-semibold text-sky-800">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-48 truncate sm:block">{name}</span>
            <SignOutButton />
          </div>
        </header>
        <div className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</div>
      </div>
    </div>
  );
}
