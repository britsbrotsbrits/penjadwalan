/**
 * Label dan status tampilan untuk struktur akademik. Murni.
 */

/** "Super Intensif · Junior · Junior A" */
export function rombelPath(parts: {
  programName: string;
  classTypeName: string;
  rombelName: string;
}): string {
  return `${parts.programName} · ${parts.classTypeName} · ${parts.rombelName}`;
}

export type SizeLevel = "ok" | "full" | "over";

export type SizeStatus = {
  level: SizeLevel;
  /** Siswa melebihi ukuran standar; 0 bila tidak melebihi. */
  over: number;
  label: string;
};

/**
 * Bandingkan jumlah siswa aktif dengan ukuran standar tipe kelas.
 * Ini PERINGATAN saja, bukan batas keras: admin tetap boleh menambah siswa.
 */
export function sizeStatus(activeStudents: number, defaultSize: number): SizeStatus {
  if (activeStudents > defaultSize) {
    const over = activeStudents - defaultSize;
    return { level: "over", over, label: `Melebihi ukuran standar (${over} siswa)` };
  }
  if (activeStudents === defaultSize) {
    return { level: "full", over: 0, label: "Penuh" };
  }
  return { level: "ok", over: 0, label: `${defaultSize - activeStudents} tempat tersisa` };
}

type NamedProgram = { id: string; name: string };
type NamedClassType = { id: string; programId: string; name: string };
type NamedRombel = { id: string; classTypeId: string; name: string };

/**
 * Peta id rombel -> "Program · Tipe kelas · Rombel". Data digabung di aplikasi
 * (query dibuat datar). Bila induknya tidak ditemukan, dipakai "?" supaya tidak crash.
 */
export function buildRombelLabels(
  programs: readonly NamedProgram[],
  classTypes: readonly NamedClassType[],
  rombels: readonly NamedRombel[],
): Map<string, string> {
  const programById = new Map(programs.map((p) => [p.id, p.name]));
  const classTypeById = new Map(classTypes.map((c) => [c.id, c]));
  const labels = new Map<string, string>();
  for (const rombel of rombels) {
    const classType = classTypeById.get(rombel.classTypeId);
    labels.set(
      rombel.id,
      rombelPath({
        programName: classType ? (programById.get(classType.programId) ?? "?") : "?",
        classTypeName: classType?.name ?? "?",
        rombelName: rombel.name,
      }),
    );
  }
  return labels;
}

/** Peta id tipe kelas -> "Program · Tipe kelas". */
export function buildClassTypeLabels(
  programs: readonly NamedProgram[],
  classTypes: readonly NamedClassType[],
): Map<string, string> {
  const programById = new Map(programs.map((p) => [p.id, p.name]));
  return new Map(
    classTypes.map((c) => [c.id, `${programById.get(c.programId) ?? "?"} · ${c.name}`]),
  );
}
