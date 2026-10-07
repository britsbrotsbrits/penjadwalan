/**
 * Pengacak berseed (mulberry32). Seed yang sama selalu menghasilkan urutan yang sama, sehingga
 * simulasi dapat diulang persis. Murni, tanpa Math.random.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Bilangan pecahan [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Bilangan bulat acak, min dan max termasuk. */
  int(min: number, max: number): number {
    if (max < min) throw new Error("max harus >= min");
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("daftar kosong");
    return items[this.int(0, items.length - 1)]!;
  }

  /** Salinan teracak (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** k item berbeda. */
  sample<T>(items: readonly T[], k: number): T[] {
    return this.shuffle(items).slice(0, Math.min(k, items.length));
  }
}
