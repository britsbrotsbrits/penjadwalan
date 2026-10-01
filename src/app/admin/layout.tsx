import { requireRole } from "@/lib/auth/session";
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
      {children}
    </div>
  );
}
