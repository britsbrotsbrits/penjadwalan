import { describe, expect, it } from "vitest";
import {
  homePathForRole,
  isProtectedPath,
  isUserRole,
  requiredRoleForPath,
} from "./roles";

describe("isUserRole", () => {
  it("menerima role yang dikenal", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("tutor")).toBe(true);
  });

  it("menolak nilai lain", () => {
    expect(isUserRole("superadmin")).toBe(false);
    expect(isUserRole("ADMIN")).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
    expect(isUserRole(null)).toBe(false);
    expect(isUserRole(1)).toBe(false);
  });
});

describe("homePathForRole", () => {
  it("memetakan role ke beranda", () => {
    expect(homePathForRole("admin")).toBe("/admin");
    expect(homePathForRole("tutor")).toBe("/tutor");
  });
});

describe("requiredRoleForPath", () => {
  it("mengenali area admin dan tutor beserta turunannya", () => {
    expect(requiredRoleForPath("/admin")).toBe("admin");
    expect(requiredRoleForPath("/admin/rombel/1")).toBe("admin");
    expect(requiredRoleForPath("/tutor")).toBe("tutor");
    expect(requiredRoleForPath("/tutor/jadwal")).toBe("tutor");
  });

  it("tidak salah cocok pada path yang hanya mirip awalan", () => {
    expect(requiredRoleForPath("/administrator")).toBeNull();
    expect(requiredRoleForPath("/tutorial")).toBeNull();
    expect(requiredRoleForPath("/adminx/y")).toBeNull();
  });

  it("path publik tidak butuh role", () => {
    expect(requiredRoleForPath("/")).toBeNull();
    expect(requiredRoleForPath("/login")).toBeNull();
    expect(requiredRoleForPath("/api/health")).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("true untuk area terlindungi, false untuk publik", () => {
    expect(isProtectedPath("/admin/x")).toBe(true);
    expect(isProtectedPath("/login")).toBe(false);
  });
});
