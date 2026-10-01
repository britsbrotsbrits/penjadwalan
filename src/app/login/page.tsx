import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Masuk</h1>

      {inactive ? (
        <div className="flex flex-col gap-3 rounded border border-current/30 p-4 text-sm">
          <p>Akun Anda belum aktif atau telah dinonaktifkan. Hubungi admin.</p>
          {state.status === "inactive" ? (
            <form action={signOutAction}>
              <button type="submit" className="underline">
                Keluar
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <LoginForm />
    </main>
  );
}
