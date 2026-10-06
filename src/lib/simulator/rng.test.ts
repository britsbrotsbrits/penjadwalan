import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("seed sama = urutan sama; seed beda = urutan beda", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });

  it("next di [0,1) dan int di rentang termasuk batas", () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const f = r.next();
      expect(f >= 0 && f < 1).toBe(true);
      const n = r.int(3, 6);
      expect(n >= 3 && n <= 6).toBe(true);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(new Rng(9).int(5, 5)).toBe(5);
  });

  it("int menolak rentang terbalik; pick menolak daftar kosong", () => {
    expect(() => new Rng(1).int(2, 1)).toThrow();
    expect(() => new Rng(1).pick([])).toThrow();
  });

  it("shuffle dan sample mempertahankan isi tanpa duplikat", () => {
    const r = new Rng(7);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...r.shuffle(items)].sort((a, b) => a - b)).toEqual(items);
    const s = r.sample(items, 3);
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
    expect(r.sample(items, 99)).toHaveLength(8);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("chance 0 tidak pernah, chance 1 selalu", () => {
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });
});
