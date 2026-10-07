import { requireRole } from "@/lib/auth/session";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { TutorBottomNav } from "@/components/tutor-bottom-nav";

export default async function TutorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireRole(["tutor"]);
  const name = session.profile.fullName || session.user.email;

  return (
    <div className="min-h-screen pb-16 md:pb-0">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-6">
          <Brand />
          <div className="hidden md:block">
            <TutorBottomNav />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden max-w-48 truncate sm:block">{name}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="px-4 py-6 md:px-8">{children}</div>
      <div className="md:hidden">
        <TutorBottomNav />
      </div>
    </div>
  );
}
