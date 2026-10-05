import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_LENGTH,
  buildStudentListQuery,
  pageRange,
  parseStudentListParams,
  sanitizeSearchTerm,
  totalPages,
} from "./search";

const UUID = "4e4b7779-079f-4fdc-8b32-7f6ea93c6920";

describe("parseStudentListParams", () => {
  it("default bila kosong: status aktif, halaman 1", () => {
    expect(parseStudentListParams({})).toEqual({ q: "", rombelId: "", status: "aktif", page: 1 });
  });

  it("membaca nilai valid", () => {
    expect(
      parseStudentListParams({ q: "  budi ", rombel: UUID, status: "semua", page: "3" }),
    ).toEqual({ q: "budi", rombelId: UUID, status: "semua", page: 3 });
    expect(parseStudentListParams({ status: "nonaktif" }).status).toBe("nonaktif");
  });

  it("nilai tidak valid jatuh ke default, bukan error", () => {
    const p = parseStudentListParams({ rombel: "bukan-uuid", status: "hacked", page: "-2" });
    expect(p).toEqual({ q: "", rombelId: "", status: "aktif", page: 1 });
    expect(parseStudentListParams({ page: "1.5" }).page).toBe(1);
    expect(parseStudentListParams({ page: "abc" }).page).toBe(1);
    expect(parseStudentListParams({ page: "0" }).page).toBe(1);
    expect(parseStudentListParams({ page: "999999999" }).page).toBe(1);
  });

  it("memakai nilai pertama bila parameter berulang", () => {
    expect(parseStudentListParams({ q: ["a", "b"], page: ["2", "9"] })).toEqual({
      q: "a",
      rombelId: "",
      status: "aktif",
      page: 2,
    });
  });

  it("memotong pencarian yang terlalu panjang", () => {
    expect(parseStudentListParams({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_MAX_LENGTH);
  });
});

describe("sanitizeSearchTerm", () => {
  it("membuang karakter sintaks filter PostgREST", () => {
    expect(sanitizeSearchTerm("a,b(c)\"d'e\\f")).toBe("a b c d e f");
  });

  it("meng-escape wildcard LIKE", () => {
    expect(sanitizeSearchTerm("100%_jujur")).toBe("100\\%\\_jujur");
  });

  it("merapikan spasi dan aman untuk string kosong", () => {
    expect(sanitizeSearchTerm("  budi   santoso ")).toBe("budi santoso");
    expect(sanitizeSearchTerm("")).toBe("");
    expect(sanitizeSearchTerm(",,,")).toBe("");
  });

  it("tidak bisa menyisipkan filter tambahan", () => {
    const out = sanitizeSearchTerm("x),is_active.eq.false,(y");
    expect(out.includes(",")).toBe(false);
    expect(out.includes("(")).toBe(false);
    expect(out.includes(")")).toBe(false);
  });
});

describe("paginasi", () => {
  it("pageRange inklusif", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: 24 });
    expect(pageRange(2)).toEqual({ from: 25, to: 49 });
    expect(pageRange(3, 10)).toEqual({ from: 20, to: 29 });
  });

  it("totalPages minimal 1", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(25)).toBe(1);
    expect(totalPages(26)).toBe(2);
    expect(totalPages(100, 10)).toBe(10);
  });
});

describe("buildStudentListQuery", () => {
  it("tidak menulis nilai default", () => {
    expect(buildStudentListQuery({ q: "", rombelId: "", status: "aktif", page: 1 })).toBe("");
  });

  it("menulis hanya parameter yang berbeda dari default", () => {
    expect(buildStudentListQuery({ q: "budi", rombelId: UUID, status: "semua", page: 2 })).toBe(
      `?q=budi&rombel=${UUID}&status=semua&page=2`,
    );
    expect(buildStudentListQuery({ q: "a b", rombelId: "", status: "aktif", page: 1 })).toBe(
      "?q=a+b",
    );
  });
});
