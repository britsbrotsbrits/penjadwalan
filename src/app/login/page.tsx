import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";
import { signOutAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const state = await getSessionState();
  if (state.status === "active") redirect(homePathForRole(state.profile.role));

  const { reason } = await searchParams;
  const inactive = state.status === "inactive" || reason === "inactive";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-line bg-surface p-7 shadow-sm">
        <Brand />
        <div>
          <h1 className="text-2xl font-bold text-navy">Edu Ops</h1>
          <p className="mt-1 text-sm text-muted">Education Operations Management System</p>
        </div>

        {inactive ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-warning-soft p-3 text-sm text-amber-900">
            <p>Akun Anda belum aktif atau telah dinonaktifkan. Hubungi admin.</p>
            {state.status === "inactive" ? (
              <form action={signOutAction}>
                <button type="submit" className="font-medium underline">
                  Keluar
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        <LoginForm />
      </div>
    </main>
  );
}
