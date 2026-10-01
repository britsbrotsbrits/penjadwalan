# Phase 0 — 02. Arsitektur

## 1. Tiga lapisan

| Lapisan | Isi | Lokasi |
|---|---|---|
| DATA | siswa, tutor, rombel, ruangan, jadwal, attendance | tabel PostgreSQL |
| RULES | sesi/hari, distribusi subtes, bobot, combined-session rule, fixed room | tabel konfigurasi |
| ENGINE | resolver konfigurasi, scheduler, validator, simulator, payroll calculator | TypeScript murni (tanpa dependensi DB/UI) |

Aturan emas: tidak ada `if (classType === "Junior")` di engine. Engine hanya membaca nilai hasil resolusi konfigurasi.

## 2. Stack & keputusan teknis

- Next.js (App Router) + TypeScript strict + Tailwind.
- Supabase: Postgres, Auth, RLS. Migrasi dengan Supabase CLI (satu folder `supabase/migrations`, berurutan, tidak ada migrasi duplikat).
- Validasi input: Zod di server actions / route handlers. Tipe DB digenerate dari skema.
- Test: Vitest (unit/engine), pgTAP atau skrip SQL (RLS), Playwright (UI) pada fase terkait.
- Deploy: GitHub + Vercel.
- Tidak memakai microservice. Satu aplikasi Next.js; engine adalah modul di dalam repo.

## 3. Struktur repo yang diusulkan (dibuat di Phase 1)

```
src/
  app/                    # routes (admin/, tutor/, auth)
  components/
  lib/
    supabase/             # client server/browser, tipe
    auth/                 # guard role, helper
    config/               # resolver konfigurasi (murni)
    scheduler/            # engine murni: types, constraints, scoring, solve, explain
    validation/           # validation engine (murni)
    simulator/            # generator data sintetis + runner (memakai scheduler)
    payroll/              # kalkulasi (murni)
    sheets/               # sinkronisasi DB → Sheets
  server/                 # server actions / use-case per domain
supabase/
  migrations/
  seed/
docs/
tests/
```

Prinsip: `scheduler`, `config`, `validation`, `payroll` tidak mengimpor Supabase atau React. Input berupa objek terstruktur, output berupa objek hasil. Dengan begitu simulator, test, dan produksi memakai engine yang sama.

## 4. Resolusi konfigurasi

Satu mekanisme untuk semua aturan yang bisa diubah (sesi/hari, bobot, dll.):

```
resolve(key, context{rombel, classType, program, day?, period?})
  1. override day/period untuk rombel   (paling spesifik)
  2. override rombel
  3. default class type
  4. default program
  5. default global
```

Tiap key punya skema Zod (tipe nilai), dan hasil resolusi menyertakan `source` (level mana yang menang) agar bisa ditampilkan di UI dan dijelaskan di hasil scheduling.

## 5. Pipeline scheduler

Input: snapshot (kebutuhan sesi, tutor+kompetensi+availability, ruangan, jadwal existing yang beku, rule, preferensi).

1. **Expand kebutuhan**: dari konfigurasi + distribusi subtes → daftar `requirement` (rombel, subtes, jumlah sesi per minggu, batas per hari). Jika total ≠ distribusi → catat discrepancy, bukan mengarang sesi.
2. **Urutkan kebutuhan** most-constrained-first (kandidat tutor/room paling sedikit lebih dulu, rombel besar lebih dulu).
3. Untuk tiap kebutuhan: filter kandidat (slot, tutor, room) memakai **hard constraint**.
4. **Scoring** soft constraint (seniority, request, workload, variasi hari).
5. Pilih terbaik; random hanya di antara skor setara/near-equivalent (seed random disimpan agar reproducible).
6. Assign, lalu update state internal (indeks conflict).
7. Jika buntu → repair terbatas (backtracking lokal pada assignment yang belum beku). Tidak pernah menyentuh jadwal beku.
8. **Validation penuh** pada hasil akhir.
9. Output: `scheduled[]`, `unscheduled[]` dengan `reason_code` terstruktur, ringkasan, skor, seed.

Alasan unscheduled bersifat enum terstruktur (mis. `NO_COMPETENT_TUTOR`, `NO_AVAILABLE_TUTOR_SLOT`, `NO_ROOM_CAPACITY`, `NO_FREE_ROOM`, `FIXED_ROOM_BUSY`, `COMBINED_RULE_VIOLATION`, `DISTRIBUTION_MISMATCH`).

## 6. Full vs Generate Additional

- **Generate Jadwal**: memproses semua kebutuhan period yang statusnya belum APPROVED/LOCKED.
- **Generate Additional**: snapshot memasukkan seluruh jadwal APPROVED/LOCKED (dan opsional DRAFT/GENERATED yang dipertahankan) sebagai **fixed occupancy**. Hanya requirement yang belum terpenuhi diproses. Validator memverifikasi bahwa tidak ada baris beku yang berubah (hash sebelum/sesudah).

## 7. State machine jadwal

```
DRAFT → GENERATED → APPROVED → LOCKED
  ↑         ↓           ↓          ↓
  └─────────┴───────────┴────→ CANCELLED
```

Aturan: transisi diperiksa di server dan dengan trigger DB; hanya Admin; tiap transisi masuk audit log. LOCKED tidak dapat diedit manual tanpa unlock eksplisit (tercatat). Detail transisi final di Phase 11.

## 8. Manual adjustment

Setiap edit memanggil validator yang sama dengan scheduler (single source of validation). Pelanggaran hard constraint ditolak, kecuali "override" eksplisit oleh Admin dengan alasan wajib, tercatat di audit log dan ditandai di UI.

## 9. Validation engine

Fungsi murni `validate(snapshot) → {required, scheduled, unscheduled, violations[], warnings[]}`. Dipakai oleh: scheduler (akhir run), manual adjustment, simulator, dashboard, dan test.

## 10. Simulator

Generator data sintetis (Small / Realistic / Stress) dengan seed tetap → memanggil scheduler yang sama → laporan metrik (completion %, konflik, workload, unmet request). Berjalan tanpa menyentuh data produksi (tabel/skema terpisah atau murni in-memory; keputusan di Phase 8).

## 11. Eksekusi scheduler

Run besar bisa melebihi batas waktu serverless. Rencana: tabel `scheduling_runs` (status, seed, input hash, hasil), eksekusi di server (route handler dengan batas waktu aman); jika stress test terlalu berat, pindah ke job background (Supabase Edge Function / queue). Diputuskan setelah simulator memberi data nyata (DEC-06).

## 12. Google Sheets

Sinkronisasi satu arah DB → Sheets lewat service account, di server. Tabel `sync_runs` mencatat status. Tidak ada pembacaan balik sebagai data utama.

## 13. Audit & notifikasi

- `audit_logs` append-only (actor, waktu, entity, before/after jsonb, alasan).
- `notifications` dibuat oleh server (event domain), masing-masing punya `action_url` agar dapat ditindaklanjuti.
