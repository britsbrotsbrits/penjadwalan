import type { PatternItem, PatternKind } from "./pattern";

/**
 * Membaca isian formulir pola sesi. Murni: tanpa Supabase/React/Next.
 * Pola penuh: tiap sesi aktif dipilih kosong / Subtes / Drilling, untuk program dan tipe kelas.
 */

export type PatternFormItems = Array<{ slot_no: number; kind: PatternKind }>;

export type PatternFormResult =
  | { ok: true; items: PatternFormItems }
  | { ok: false; message: string };

const KINDS: readonly string[] = ["SUBTEST", "DRILLING"];

/** values: nomor sesi -> pilihan mentah ("", "SUBTEST", "DRILLING"). items kosong = hapus pola (ikut parent). */
export function parsePatternForm(activeSlotNos: readonly number[], values: ReadonlyMap<number, string>): PatternFormResult {
  const items: PatternFormItems = [];
  for (const slotNo of activeSlotNos) {
    const raw = (values.get(slotNo) ?? "").trim();
    if (raw === "") continue;
    if (!KINDS.includes(raw)) return { ok: false, message: `Pilihan untuk sesi ${slotNo} tidak valid.` };
    items.push({ slot_no: slotNo, kind: raw as PatternKind });
  }
  if (items.length > 0 && !items.some((i) => i.kind === "SUBTEST")) {
    return { ok: false, message: "Pola harus punya minimal satu sesi bertipe Subtes." };
  }
  return { ok: true, items };
}

/** Pilihan awal formulir dari pola yang tersimpan pada scope itu sendiri. */
export function patternFormDefaults(own: readonly Pick<PatternItem, "slotNo" | "kind">[]): Map<number, string> {
  return new Map(own.map((i) => [i.slotNo, i.kind] as const));
}
