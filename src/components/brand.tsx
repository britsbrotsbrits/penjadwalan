/**
 * Wordmark BRITS edu center (teks + penanda "B"). Ganti isi komponen ini dengan <img src="/logo.svg">
 * setelah file logo resmi diletakkan di folder public/.
 */
export function Brand({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-700 text-lg font-bold text-white"
      >
        B
      </span>
      <span className="flex flex-col leading-none">
        <span className={`text-base font-semibold tracking-[0.2em] ${onDark ? "text-white" : "text-navy"}`}>
          BRITS
        </span>
        <span className={`text-[10px] tracking-[0.25em] ${onDark ? "text-white/70" : "text-muted"}`}>
          edu center
        </span>
      </span>
    </span>
  );
}
