import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Edu Ops</h1>
      <p className="text-base opacity-80">
        Education Operations Management System: scheduling tutor, rombel,
        ruangan, attendance, dan payroll.
      </p>
      <p className="text-sm opacity-60">
        Status: Phase 2 (schema, auth, role). Fitur aplikasi dibangun bertahap.
      </p>
      <Link href="/login" className="w-fit rounded bg-foreground px-4 py-2 text-background">
        Masuk
      </Link>
    </main>
  );
}
