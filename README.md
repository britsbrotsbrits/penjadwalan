# Edu Ops

Education Operations Management System: scheduling tutor, rombel, ruangan, attendance, dan payroll.

Stack: Next.js (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Vitest · Vercel.

Prinsip: **CODING = ENGINE, DATABASE + CONFIGURATION = RULES.** Dokumen arsitektur dan requirement ada di [`docs/phase-0/`](docs/phase-0).

## Status

- Phase 2 (schema, auth, role): tabel `profiles`, helper RLS, login/logout, guard role, tes RLS.
- Phase 3 (master data): subtes, ruangan, slot sesi harian, dan hari aktif, lengkap dengan halaman admin
  (`/admin/subtes`, `/admin/ruangan`, `/admin/kalender`), RLS, seed, dan tes.

- Phase 4 (program, tipe kelas, rombel, siswa): hierarki Program > Tipe Kelas > Rombel > Siswa, kode siswa otomatis,
  pindah rombel dengan riwayat, halaman `/admin/program`, `/admin/tipe-kelas`, `/admin/rombel`, `/admin/siswa`.
- Phase 5 (mentor/tutor, kompetensi, availability): `/admin/mentor`, `/admin/kompetensi`, `/admin/availability`,
  dan `/tutor/availability` (mentor mengisi sendiri).

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

## Setup master data (Phase 3)

Jalankan di **SQL Editor** Supabase, berurutan, masing-masing sekali:

1. `supabase/migrations/20261004110000_create_master_data.sql` (membuat tabel, RLS, dan 7 baris hari aktif).
2. `supabase/seed/001_master_data.sql` (data awal: 7 subtes, 15 ruangan, 8 slot sesi). Aman dijalankan ulang: tiap tabel hanya diisi bila masih kosong, jadi data yang sudah Anda ubah lewat aplikasi tidak ditimpa.

Daftar ruangan awal BELUM final; tambahkan ruangan lain di `/admin/ruangan`. Aturan jeda antar sesi belum ditentukan, jadi slot dibuat bersebelahan.

Aturan penting master data: tidak ada penghapusan (hanya nonaktifkan lewat kolom Status), hanya admin yang dapat mengubah, tutor hanya dapat membaca, dan slot sesi aktif tidak boleh tumpang tindih (dijaga langsung oleh database).

## Setup program, tipe kelas, rombel, siswa (Phase 4)

Jalankan di **SQL Editor** Supabase, berurutan, masing-masing sekali:

1. `supabase/migrations/20261005100000_create_academic_structure.sql` (5 tabel, trigger, fungsi `move_student`, view jumlah siswa, RLS).
2. `supabase/seed/002_programs_class_types.sql` (4 program dan 14 tipe kelas awal). Aman dijalankan ulang.

Rombel dan siswa TIDAK di-seed: admin membuatnya lewat aplikasi. Aturan penting:

- Hanya admin yang dapat membaca/menulis rombel, siswa, dan riwayat. Tutor hanya dapat membaca program dan tipe kelas.
- Tidak ada penghapusan (nonaktifkan lewat Status). `program_id` tipe kelas, `class_type_id` rombel, dan `rombel_id` siswa tidak dapat diubah lewat UPDATE biasa.
- Pindah rombel hanya lewat fungsi `move_student()` (halaman detail siswa), sehingga riwayat (dari, ke, alasan, admin pelaku) selalu tercatat.
- Ukuran standar tipe kelas hanya peringatan di halaman Rombel, bukan batas keras.

## Setup mentor, kompetensi, availability (Phase 5)

Jalankan di **SQL Editor** Supabase: `supabase/migrations/20261006100000_create_tutors.sql` (sekali). Tidak ada seed:
mentor berasal dari akun (Authentication > Users). Setiap akun ber-role tutor otomatis mendapat satu baris data mentor
(akun yang sudah ada diisi otomatis oleh migrasi). Aturan penting:

- Akun baru: nonaktif dan **belum dapat dijadwalkan** sampai admin mengisi nama, level, rate di `/admin/mentor` dan mencentang kedua kotak.
- `level` = peringkat seniority 0..99 (hanya preferensi lunak; bobot di konfigurasi Phase 7). `rate` = Rupiah per sesi, kosong = belum diisi.
- Tutor hanya melihat data dan rate DIRINYA; tidak bisa mengubah level/rate/status. Kompetensi dan availability ditulis lewat fungsi database (atomik); tidak ada DELETE.
- Availability mingguan (hari x sesi) mengikuti hari aktif dan slot aktif di menu Kalender. Sel yang belum pernah diisi dianggap TIDAK tersedia. Availability per periode ditambahkan saat tabel periode jadwal dibuat.

## Tes RLS

File di `supabase/tests/`:

| File | Cakupan |
|---|---|
| `profiles_rls.test.sql` | 20 kasus Phase 2: anon, tutor, user nonaktif, admin, eskalasi role, admin aktif terakhir |
| `master_data_rls.test.sql` | 17 kelompok kasus Phase 3: akses per peran, tidak ada DELETE, constraint (kode, kapasitas, durasi), tumpang tindih slot, `set_active_days()` |
| `academic_rls.test.sql` | 17 kelompok kasus Phase 4: akses per peran, tidak ada DELETE, kolom tak bisa diubah, `move_student`, riwayat, kode siswa, constraint, view jumlah siswa |
| `tutors_rls.test.sql` | 16 kelompok kasus Phase 5: anon, tutor A/B, tutor nonaktif, admin; isolasi rate, eskalasi, fungsi availability/kompetensi/update tutor, constraint, cascade |

Jalankan seluruh isi file di SQL Editor pada project **dev/scratch** atau lewat `psql`. Semua perubahan di-rollback, dan tes tidak bergantung pada isi database (akun dan data yang sudah ada tidak mengganggu). Hasil yang benar: tidak ada error merah. Di `psql` terlihat NOTICE `PASS ...` per kasus dan `SEMUA TES LULUS` di akhir; SQL Editor Supabase mungkin tidak menampilkan NOTICE, jadi ketiadaan error sudah berarti lulus. Jika ada kasus yang gagal, pesan error menyebut kasusnya. Tes ini wajib dijalankan ulang setiap ada perubahan policy atau tabel baru.

## Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # isi nilai Supabase Anda
npm run dev                  # http://localhost:3000
```

Cek deployment: `GET /api/health` mengembalikan `{ "status": "ok", "phase": 5 }`.

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
    master-data/  skema Zod, helper waktu/kapasitas, pemetaan error DB (murni, ber-tes)
    academic/     skema Zod, label, tanggal, pencarian/paginasi siswa (murni, ber-tes)
    tutors/       skema Zod, grid availability, label tutor (murni, ber-tes)
    sheets/       sinkronisasi DB -> Google Sheets
    env.ts        validasi environment (Zod)
  components/     komponen UI bersama (ActionForm, AdminNav)
  server/         use-case / server actions per domain
    master-data/  queries + server actions subtes, ruangan, slot, hari aktif
    academic/     queries + server actions program, tipe kelas, rombel, siswa
    tutors/       queries + server actions mentor, kompetensi, availability
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
