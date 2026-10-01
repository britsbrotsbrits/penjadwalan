import { requireRole } from "@/lib/auth/session";

export default async function AdminHomePage() {
  // Dipanggil lagi di page: layout tidak dijalankan ulang pada navigasi sisi client.
  await requireRole(["admin"]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Dashboard Admin</h1>
      <p className="mt-2 text-sm opacity-70">
        Placeholder Phase 2. Fitur admin dibangun bertahap mulai Phase 3.
      </p>
    </main>
  );
}
