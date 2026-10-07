import { describe, expect, it } from "vitest";
import type { Tally } from "./candidates";
import { explainFailure } from "./explain";

const tally = (over: Partial<Tally> = {}): Tally => ({
  cells: 48, rombelBusy: 0, dayLimit: 0, noRoomFits: false, fixedRoomMissing: false, fixedBusy: 0,
  roomBusy: 0, poolEmpty: false, tutorUnavailable: 0, tutorBusy: 0, ...over,
});

describe("explainFailure", () => {
  it("struktural didahulukan: tanpa tutor kompeten, ruangan tetap hilang, tidak ada ruangan muat", () => {
    expect(explainFailure(tally({ poolEmpty: true, roomBusy: 40 })).reason).toBe("NO_COMPETENT_TUTOR");
    expect(explainFailure(tally({ fixedRoomMissing: true, noRoomFits: true })).reason).toBe("NO_ROOM_CAPACITY");
    expect(explainFailure(tally({ noRoomFits: true })).reason).toBe("NO_ROOM_CAPACITY");
  });

  it("penyebab terbanyak menang dan semua penyebab dirinci", () => {
    const e = explainFailure(tally({ tutorUnavailable: 10, tutorBusy: 5, roomBusy: 20, rombelBusy: 3, dayLimit: 4 }));
    expect(e.reason).toBe("NO_FREE_ROOM");
    expect(e.detail).toBe(
      "Dari 48 sel: 10 sel tutor kompeten tidak tersedia, 5 sel tutor tersedia sudah terpakai; 20 sel semua ruangan yang muat sudah terpakai; 3 sel rombel sudah terisi, 4 sel melebihi batas sesi per hari.",
    );
  });

  it("masing-masing penyebab terpetakan ke kodenya", () => {
    expect(explainFailure(tally({ tutorBusy: 9 })).reason).toBe("NO_AVAILABLE_TUTOR_SLOT");
    expect(explainFailure(tally({ tutorUnavailable: 9 })).reason).toBe("NO_AVAILABLE_TUTOR_SLOT");
    expect(explainFailure(tally({ fixedBusy: 9 })).reason).toBe("FIXED_ROOM_BUSY");
    expect(explainFailure(tally({ dayLimit: 9 })).reason).toBe("NO_ROMBEL_SLOT");
    expect(explainFailure(tally({ rombelBusy: 9 })).reason).toBe("NO_ROMBEL_SLOT");
  });

  it("seri: urutan tutor, ruangan tetap, ruangan, rombel", () => {
    expect(explainFailure(tally({ tutorBusy: 5, roomBusy: 5, rombelBusy: 5 })).reason).toBe("NO_AVAILABLE_TUTOR_SLOT");
    expect(explainFailure(tally({ roomBusy: 5, rombelBusy: 5 })).reason).toBe("NO_FREE_ROOM");
  });
});
