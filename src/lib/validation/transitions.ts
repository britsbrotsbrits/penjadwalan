/**
 * Alur status periode jadwal (cermin tabel di database: set_period_status). Murni.
 * Database adalah penegak sebenarnya; tabel ini hanya untuk menampilkan tombol yang relevan.
 */
export type PeriodStatus = "DRAFT" | "GENERATED" | "APPROVED" | "LOCKED" | "CANCELLED";

export const PERIOD_TRANSITIONS: Readonly<Record<PeriodStatus, readonly PeriodStatus[]>> = {
  DRAFT: ["CANCELLED"],
  GENERATED: ["APPROVED", "CANCELLED"],
  APPROVED: ["GENERATED", "LOCKED", "CANCELLED"],
  LOCKED: [],
  CANCELLED: [],
};

export function allowedTransitions(from: string): readonly PeriodStatus[] {
  return PERIOD_TRANSITIONS[from as PeriodStatus] ?? [];
}

export function canTransition(from: string, to: string): boolean {
  return allowedTransitions(from).includes(to as PeriodStatus);
}

/** Status yang boleh Generate Additional. */
export function canGenerateAdditional(status: string): boolean {
  return status === "GENERATED" || status === "APPROVED";
}

/** Transisi yang tidak bisa dibalik dan karenanya butuh konfirmasi. */
export function needsConfirmation(to: string): boolean {
  return to === "LOCKED" || to === "CANCELLED";
}
