import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

describe("parsePublicEnv", () => {
  it("menerima env publik yang valid", () => {
    const env = parsePublicEnv(valid);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
  });

  it("menolak URL yang bukan URL", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "bukan-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("menolak anon key yang kosong atau hilang", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("parseServerEnv", () => {
  it("menerima env server yang valid", () => {
    expect(parseServerEnv(valid).SUPABASE_SERVICE_ROLE_KEY).toBe("service-key");
  });

  it("menolak jika service role key hilang", () => {
    expect(() =>
      parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: undefined }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
