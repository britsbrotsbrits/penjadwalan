import type { Tally } from "./candidates";
import type { UnscheduledReason } from "./types";

/**
 * Menjelaskan MENGAPA sebuah kebutuhan tidak bisa dijadwalkan, dari hitungan kegagalan per sel.
 * Alasan utama = penyebab yang paling banyak menghalangi sel; penyebab struktural didahulukan
 * (tidak ada tutor kompeten / tidak ada ruangan yang muat). Murni.
 */

export type Explanation = { reason: UnscheduledReason; detail: string };

export function explainFailure(tally: Tally): Explanation {
  if (tally.poolEmpty) {
    return { reason: "NO_COMPETENT_TUTOR", detail: "Tidak ada tutor yang kompeten untuk subtes yang dibutuhkan." };
  }
  if (tally.fixedRoomMissing) {
    return { reason: "NO_ROOM_CAPACITY", detail: "Ruangan tetap rombel tidak ditemukan." };
  }
  if (tally.noRoomFits) {
    return { reason: "NO_ROOM_CAPACITY", detail: "Tidak ada ruangan (atau ruangan tetap) yang muat untuk jumlah siswa rombel ini." };
  }

  const causes: Array<{ reason: UnscheduledReason; count: number; text: string }> = [
    { reason: "NO_AVAILABLE_TUTOR_SLOT", count: tally.tutorUnavailable + tally.tutorBusy, text: `${tally.tutorUnavailable} sel tutor kompeten tidak tersedia, ${tally.tutorBusy} sel tutor tersedia sudah terpakai` },
    { reason: "FIXED_ROOM_BUSY", count: tally.fixedBusy, text: `${tally.fixedBusy} sel ruangan tetap sudah terpakai` },
    { reason: "NO_FREE_ROOM", count: tally.roomBusy, text: `${tally.roomBusy} sel semua ruangan yang muat sudah terpakai` },
    { reason: "NO_ROMBEL_SLOT", count: tally.rombelBusy + tally.dayLimit, text: `${tally.rombelBusy} sel rombel sudah terisi, ${tally.dayLimit} sel melebihi batas sesi per hari` },
  ];
  // Urutan array menjadi tie-breaker (tutor, ruangan tetap, ruangan, rombel).
  const main = causes.reduce((m, c) => (c.count > m.count ? c : m), causes[0]!);
  const parts = causes.filter((c) => c.count > 0).map((c) => c.text);
  const detail = `Dari ${tally.cells} sel: ${parts.length > 0 ? parts.join("; ") : "tidak ada sel yang bisa dipakai"}.`;
  return { reason: main.count > 0 ? main.reason : "NO_AVAILABLE_TUTOR_SLOT", detail };
}
