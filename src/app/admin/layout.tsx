import { requireRole } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin-nav";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["admin"]);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-current/20 px-6 py-3">
        <span className="font-semibold">Edu Ops · Admin</span>
        <div className="flex items-center gap-4 text-sm">
          <span>{session.profile.fullName || session.user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="flex flex-col gap-6 px-6 py-6 md:flex-row">
        <aside className="md:w-44 md:shrink-0">
          <AdminNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
