# Edu Ops

Education Operations Management System: scheduling tutor, rombel, ruangan, attendance, dan payroll.

Stack: Next.js (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Vitest · Vercel.

Prinsip: **CODING = ENGINE, DATABASE + CONFIGURATION = RULES.** Dokumen arsitektur dan requirement ada di [`docs/phase-0/`](docs/phase-0).

## Status

Phase 2 (schema, auth, role): tabel `profiles`, helper RLS, login/logout, guard role, tes RLS.
Tabel akademik dimulai di Phase 3-4.

## Setup Supabase (sekali di awal)

1. Buat project Supabase. Di **Authentication > Sign In / Providers**, **matikan "Allow new users to sign up"**. Akun dibuat oleh admin, bukan pendaftaran publik.
2. Terapkan migrasi di `supabase/migrations/` secara berurutan: `supabase db push` (Supabase CLI), atau tempel isi file SQL ke **SQL Editor**.
3. Buat user admin pertama: **Authentication > Users > Add user** (centang auto-confirm). Trigger otomatis membuat profile berstatus **tutor + nonaktif**.
4. Jadikan user itu admin lewat **SQL Editor** (konteks tepercaya, `auth.uid()` NULL, jadi diizinkan):

   ```sql
   update public.profiles
   set role = 'admin', is_active = true, full_name = 'Nama Admin'
   where id = (select id from auth.users where email = 'email-admin@contoh.com');
   ```

5. Login di `/login`. Admin masuk ke `/admin`, tutor ke `/tutor`.

Role sengaja TIDAK diambil dari `user_metadata`. Hanya `profiles.role` yang dipercaya.

## Tes RLS

`supabase/tests/profiles_rls.test.sql` berisi 20 kasus (anon, tutor, user nonaktif, admin, eskalasi role, admin aktif terakhir). Jalankan seluruh file di SQL Editor pada project **dev/scratch** atau lewat `psql`; semua perubahan di-rollback. Hasil yang benar: NOTICE `PASS ...` untuk tiap kasus dan `SEMUA TES LULUS` di akhir. Tes ini wajib dijalankan ulang setiap ada perubahan policy atau tabel baru.

## Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # isi nilai Supabase Anda
npm run dev                  # http://localhost:3000
```

Cek deployment: `GET /api/health` mengembalikan `{ "status": "ok", "phase": 2 }`.

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
    auth/         role, profile, sesi, guard requireRole()
    sheets/       sinkronisasi DB -> Google Sheets
    env.ts        validasi environment (Zod)
  server/         use-case / server actions per domain
supabase/
  migrations/     migrasi SQL berurutan
  seed/           seed data awal
  tests/          tes RLS (SQL)
docs/phase-0/     requirement lock, arsitektur, skema, security
```

Modul bertanda **engine murni** dilarang mengimpor Supabase, React, atau Next. Aturan ini ditegakkan oleh ESLint (`eslint.config.mjs`), supaya simulator, test, dan produksi memakai engine yang sama.

## Deploy ke Vercel

1. Push repo ke GitHub, lalu **Add New Project** di Vercel dan pilih repo ini (framework terdeteksi otomatis sebagai Next.js).
2. Di **Settings > Environment Variables**, isi `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` (nilai dari Supabase > Project Settings > API).
3. `SUPABASE_SERVICE_ROLE_KEY` adalah secret server. Jangan beri prefix `NEXT_PUBLIC_`.
4. Setelah `npm install` pertama, commit `package-lock.json` (lalu ganti `npm install` di `.github/workflows/ci.yml` menjadi `npm ci`).
