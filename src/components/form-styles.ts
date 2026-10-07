// Kelas Tailwind bersama untuk form admin.
export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-disabled focus:border-primary disabled:bg-neutral-soft disabled:text-muted";

export const buttonClass =
  "rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled";

export const secondaryButtonClass =
  "rounded-lg border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-neutral-soft disabled:opacity-60";

export const headerCellClass = "text-xs font-medium uppercase tracking-wide text-muted";

export const rowClass = "grid items-center gap-3 border-b border-line py-2";

// Baris form "tambah data" (di dalam kotak sendiri, tanpa garis bawah).
export const createRowClass = "grid items-center gap-3";

export const selectClass = inputClass;

// Kotak konten putih (kartu).
export const cardClass = "rounded-xl border border-line bg-surface p-4 shadow-sm";
