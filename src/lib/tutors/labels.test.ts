import { describe, expect, it } from "vitest";
import { formatRupiah, tutorDisplayName } from "./labels";

describe("formatRupiah", () => {
  it("format Indonesia", () => {
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(999)).toBe("Rp999");
    expect(formatRupiah(50000)).toBe("Rp50.000");
    expect(formatRupiah(1234567)).toBe("Rp1.234.567");
    expect(formatRupiah(100000000)).toBe("Rp100.000.000");
  });

  it("null berarti belum diisi", () => {
    expect(formatRupiah(null)).toBe("-");
  });
});

describe("tutorDisplayName", () => {
  it("memakai nama bila ada", () => {
    expect(tutorDisplayName("  Budi ", "b@x.id")).toBe("Budi");
  });

  it("akun tanpa nama diberi penanda dan email bila ada", () => {
    expect(tutorDisplayName("", "b@x.id")).toBe("(tanpa nama) b@x.id");
    expect(tutorDisplayName("   ", null)).toBe("(tanpa nama)");
  });
});
