"use client";

// Batas error untuk seluruh area admin. Pesan mentah error sengaja TIDAK ditampilkan
// (bisa memuat detail internal); digest dipakai untuk mencari log di Vercel.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex max-w-xl flex-col gap-3">
      <h1 className="text-xl font-semibold">Terjadi kesalahan</h1>
      <p className="text-sm opacity-80">
        Halaman tidak dapat dimuat. Coba lagi; bila terus terjadi, hubungi pengembang
        {error.digest ? ` dengan kode ${error.digest}` : ""}.
      </p>
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded bg-foreground px-3 py-1 text-sm text-background"
      >
        Coba lagi
      </button>
    </main>
  );
}
