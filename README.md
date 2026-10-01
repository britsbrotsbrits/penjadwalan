# Edu Ops

Education Operations Management System: scheduling tutor, rombel, ruangan, attendance, dan payroll.

Stack: Next.js (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Vitest · Vercel.

Prinsip: **CODING = ENGINE, DATABASE + CONFIGURATION = RULES.** Dokumen arsitektur dan requirement ada di [`docs/phase-0/`](docs/phase-0).

## Status

Phase 1 (project foundation). Belum ada tabel, auth, atau fitur. Itu dimulai di Phase 2.

## Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # isi nilai Supabase Anda
npm run dev                  # http://localhost:3000
```

Cek deployment: `GET /api/health` mengembalikan `{ "status": "ok", "phase": 1 }`.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | server development |
| `npm run build` | build produksi |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (termasuk aturan batas engine) |
| `npm run test` | Vitest |
| `npm run check` | typecheck + lint + test |

## Struktur

```
src/
  app/            routes (Next.js App Router)
  lib/
    config/       resolver konfigurasi         [engine murni]
    scheduler/    scheduling engine            [engine murni]
    validation/   validation engine            [engine murni]
    simulator/    simulator                    [engine murni]
    payroll/      kalkulasi payroll            [engine murni]
    supabase/     client browser & server
    auth/         guard role (Phase 2)
    sheets/       sinkronisasi DB -> Google Sheets
    env.ts        validasi environment (Zod)
  server/         use-case / server actions per domain
supabase/
  migrations/     migrasi SQL berurutan
  seed/           seed data awal
docs/phase-0/     requirement lock, arsitektur, skema, security
```

Modul bertanda **engine murni** dilarang mengimpor Supabase, React, atau Next. Aturan ini ditegakkan oleh ESLint (`eslint.config.mjs`), supaya simulator, test, dan produksi memakai engine yang sama.

## Deploy ke Vercel

1. Push repo ke GitHub, lalu **Add New Project** di Vercel dan pilih repo ini (framework terdeteksi otomatis sebagai Next.js).
2. Di **Settings > Environment Variables**, isi `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` (nilai dari Supabase > Project Settings > API).
3. `SUPABASE_SERVICE_ROLE_KEY` adalah secret server. Jangan beri prefix `NEXT_PUBLIC_`.
4. Setelah `npm install` pertama, commit `package-lock.json` (lalu ganti `npm install` di `.github/workflows/ci.yml` menjadi `npm ci`).
