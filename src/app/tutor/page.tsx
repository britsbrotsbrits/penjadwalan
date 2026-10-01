import { requireRole } from "@/lib/auth/session";

export default async function TutorHomePage() {
  await requireRole(["tutor"]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Dashboard Mentor</h1>
      <p className="mt-2 text-sm opacity-70">
        Placeholder Phase 2. Jadwal, availability, dan attendance dibangun di phase berikutnya.
      </p>
    </main>
  );
}
