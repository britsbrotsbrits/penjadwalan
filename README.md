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
- Phase 6 (ruangan tetap): setiap rombel boleh punya ruangan tetap (`/admin/rombel`), ringkasan pemakaian di `/admin/ruangan`.
- Phase 7 (konfigurasi akademik): sesi per hari dan total sesi per minggu dengan hierarki program > tipe kelas > rombel
  (`/admin/sesi-kurikulum`), distribusi subtes per minggu (`/admin/distribusi`), resolver murni di `src/lib/config`,
  validasi discrepancy.
- Phase 9 (scheduling engine): scheduler constraint-based murni di `src/lib/scheduler` (hard constraint, scoring, repair, penjelasan alasan unscheduled), dijalankan lewat simulator.
- Phase 8 (simulator): `/admin/simulator` membuat data sintetis (Small / Realistic / Stress, seed tetap), menghitung
  kebutuhan sesi, menganalisis kelayakan, dan menyiapkan laporan metrik. Tanpa perubahan database.

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

## Setup ruangan tetap (Phase 6)

Jalankan di **SQL Editor** Supabase: `supabase/migrations/20261007100000_add_rombel_fixed_room.sql` (sekali). Tidak ada seed.

- Ruangan tetap bersifat opsional per rombel. Saat dipilih, ruangan harus ada dan aktif (dijaga database).
- Beberapa rombel boleh memakai ruangan yang sama (DEC-03); bentrok waktu tetap hard constraint di penjadwalan.
- Kapasitas TIDAK dipaksa database. UI memperingatkan bila kapasitas kurang dari siswa aktif (atau dari ukuran standar tipe kelas bila belum ada siswa, DEC-02). Validator penjadwalan kelak memperlakukannya sebagai hard constraint.
- Ruangan yang dinonaktifkan tidak diblokir walau dipakai rombel; rombelnya diberi peringatan dan tetap bisa diedit.

## Setup konfigurasi akademik (Phase 7)

Jalankan di **SQL Editor** Supabase, berurutan:

1. `supabase/migrations/20261008100000_create_academic_config.sql` (sekali)
2. `supabase/seed/003_academic_config.sql` (aman diulang; hanya mengisi tabel yang masih kosong)

- Nilai awal hanya yang tertulis di sumber: sesi per hari per tipe kelas (master prompt bagian 10), total sesi per minggu untuk Kelas 3 SMA General (6), Super Intensif VIP (24), dan Super Camp (36, level program), serta baseline distribusi Gap Year (12 sesi, termasuk item fleksibel KMM/PPU). Semua boleh diubah admin; tidak ada angka ini di kode.
- Nilai paling spesifik menang: rombel + hari > rombel > tipe kelas > program > global. Kolom kosong = ikut level di atasnya. Bila tidak ada nilai di level mana pun, hasilnya "belum diatur" (tidak ada angka karangan).
- Distribusi diwariskan sebagai satu kesatuan dari level terdekat yang punya item (rombel > tipe kelas > program).
- Bila total sesi/minggu berbeda dari total distribusi, halaman menampilkan **error** selisih (TBD-05); sistem tidak menambah atau mengurangi sesi otomatis. Program tanpa distribusi hanya diberi peringatan (TBD-03).
- Override per hari (`rombel_day`) sudah didukung database dan resolver, tetapi belum punya layar admin. Kolom periode (`period_id`) menunggu tabel periode jadwal.
- Tabel hanya bisa ditulis lewat fungsi database (`set_scheduling_setting`, `clear_scheduling_setting`, `set_subtest_distribution`, `clear_subtest_distribution`) dan hanya admin yang bisa membaca/menulis.

## Simulator (Phase 8)

Tidak ada SQL yang dijalankan di fase ini. Buka `/admin/simulator`, pilih mode dan seed, klik **Jalankan**.

- Berjalan murni di memori dengan data sintetis; tidak membaca atau menulis database produksi. Seed yang sama = skenario yang sama (URL bisa dibagikan, mis. `?mode=realistic&seed=7`).
- Model: satu minggu representatif (hari x nomor sesi). Penanggalan per periode (DEC-01) menunggu tabel periode jadwal.
- Kebutuhan sesi hanya berasal dari distribusi subtes; total yang berbeda dari sesi/minggu dilaporkan sebagai discrepancy, tidak ada sesi karangan.
- Analisis kelayakan memeriksa syarat perlu (tutor kompeten, kapasitas tutor, kapasitas ruangan menurut ukuran kelas, batas sesi/hari). Lolos tidak menjamin jadwal ada; gagal berarti pasti tidak mungkin, lengkap dengan alasan.
- Scheduler (Phase 9) dijalankan pada skenario; metrik (bentrok tutor/ruangan/rombel, kapasitas, kompetensi, availability, batas harian, ruangan tetap, pembukuan, beban tutor) dihitung ulang dari hasil, bukan dari klaim scheduler.
- Permintaan tutor belum dimodelkan (belum ada tabelnya), jadi "unmet requests" ditandai belum dimodelkan.

## Scheduling engine (Phase 9)

Tidak ada SQL di fase ini. Engine murni (tanpa database) di `src/lib/scheduler`, dijalankan dari `/admin/simulator`; belum ada tombol "Generate" untuk data asli (itu Phase 10).

- Pipeline: kebutuhan diurutkan paling terbatas lebih dulu, tiap sesi dicari kandidatnya dengan hard constraint sebagai filter (rombel tidak bentrok dan tidak melebihi sesi/hari, ruangan bebas dan muat atau ruangan tetap, tutor kompeten + tersedia + tidak bentrok), lalu soft constraint sebagai skor (pemerataan beban tutor, sebar antar hari, hemat ruangan besar, pakai spesialis dulu, seimbangkan subtes fleksibel). Skor setara dipilih acak dengan seed, jadi hasil bisa diulang.
- Bila buntu, repair terbatas memindahkan satu sesi penghalang ke sel lain (selalu diperiksa ulang dan dibatalkan bila gagal).
- Sesi tidak pernah ditempatkan melanggar hard constraint. Yang tidak muat dilaporkan beserta alasan terstruktur: `NO_COMPETENT_TUTOR`, `NO_AVAILABLE_TUTOR_SLOT`, `NO_ROOM_CAPACITY`, `NO_FREE_ROOM`, `FIXED_ROOM_BUSY`, `NO_ROMBEL_SLOT`, dan rincian jumlah sel yang terhalang.
- Belum ada: jadwal beku untuk Generate Additional (Phase 11), combined session (TBD-01), permintaan tutor, dan bobot seniority (arti level belum didefinisikan).

## Jadwal bertanggal (Phase 10)

- **Model (DEC-01):** jadwal = pertemuan bertanggal per `schedule_periods` (maks. 92 hari, tidak boleh tumpang tindih). Tabel: `schedule_periods`, `scheduling_runs`, `teaching_sessions` (satu sesi = satu rombel; sesi gabungan menunggu TBD-01), `unscheduled_requirements`. Hanya bisa ditulis lewat RPC (admin dicek di database).
- **Generate Jadwal (DEC-06, sinkron):** snapshot dari data nyata (`scheduler/snapshot.ts`) -> scheduler membuat pola mingguan -> `schedule/plan.ts` memperluasnya ke tanggal periode (dibatasi tanggal mulai/selesai rombel) -> `save_generated_schedule` menyimpan atomik dan **mengganti semua sesi periode itu**. Libur/tanggal merah belum dimodelkan.
- **Validasi:** `_schedule_violations()` di database (kapasitas, kompetensi, availability, ruangan tetap, data nonaktif, hari/sesi aktif, di luar periode) dipakai oleh generate, edit manual, dan laporan; `validation/weekly-distribution.ts` memeriksa distribusi subtes per minggu (kekurangan hanya pada minggu penuh). Indeks unik mencegah mentor/ruangan/rombel dobel.
- **Edit manual:** tambah, ubah (tanggal, sesi, subtes, mentor, ruangan), dan batalkan sesi; pelanggaran ditolak dengan alasan. Belum ada mekanisme override (butuh audit log, Phase 17).
- **Status:** hanya DRAFT dan GENERATED yang bisa diedit/digenerate ulang; APPROVED/LOCKED/CANCELLED dilindungi.

## Alur status dan Generate Additional (Phase 11)

- **Alur status** (`set_period_status`, admin saja; tabel yang sama di `validation/transitions.ts` untuk tombol UI): GENERATED -> APPROVED, APPROVED -> GENERATED (tarik persetujuan), APPROVED -> LOCKED, dan DRAFT/GENERATED/APPROVED -> CANCELLED. LOCKED dan CANCELLED final. Approve butuh minimal satu sesi dan nol pelanggaran (kebutuhan yang belum terjadwal tidak menghalangi). Cancel membatalkan semua sesi periode sehingga tanggal dan slotnya bebas dipakai periode lain. Lock dan Cancel butuh centang konfirmasi di UI.
- **Generate Additional** (`save_additional_schedule`, `schedule/additional.ts`): hanya pada GENERATED/APPROVED. Sesi yang ada dijadikan pola mingguan dan dibekukan (`SchedulerInput.frozen`: hanya mengisi hunian, tidak pernah dipindahkan); kebutuhan dikurangi sesi yang ada; hanya sisanya dijadwalkan. Sesi lama tidak pernah diubah atau dihapus, status periode tidak berubah, sesi baru bertanda `ADDITIONAL`. Hanya sesi baru yang divalidasi (pelanggaran lama tidak menghalangi). Pola dipakai konservatif: sel hari/sesi yang dipakai sesi lama pada tanggal mana pun dianggap terisi.
- **Belum ada:** audit log perubahan status dan override (Phase 17).

## Tabel jadwal dan ekspor (Phase 12)

- **Tabel mingguan** (`schedule/grid.ts`, murni): baris = sesi (dengan jam), kolom = hari aktif; sel berisi sesi, tanda **√** (mentor tersedia tetapi belum ada kelas; hanya tampilan mentor, tidak di luar periode), kosong, atau di luar periode.
- **Admin:** `/admin/jadwal/[id]/tabel`, pilih mentor atau kelas lalu navigasi minggu. **Mentor:** `/tutor/jadwal`, hanya jadwal sendiri dari periode Approved/Locked lewat RPC `my_schedule` (mentor tidak punya akses baca ke tabel jadwal).
- **Ekspor:** satu sumber `schedule/grid-svg.ts` (SVG mandiri). PNG = SVG digambar ke canvas lalu diunduh; PDF = dialog cetak browser (A4 landscape, pilih "Simpan sebagai PDF"). Tanpa dependensi tambahan.
- **Belum ada:** jam khusus per hari (mis. Jumat), keterangan ruangan/lantai, ekspor massal semua mentor sekaligus.

## Presensi mentor (Phase 13)

- **Model:** satu catatan per sesi (`attendance`) = siapa yang SEBENARNYA mengajar. Status **HADIR**, **TUKAR**, **MENGGANTIKAN** masuk presensi (ekspor sheet di Phase 16); **tidak hadir = tidak ada catatan**. TUKAR dan MENGGANTIKAN wajib memilih mentor lawan dari daftar. Jadwal (`teaching_sessions`) tidak pernah diubah oleh presensi.
- **Mentor** (`/tutor/absensi`): mengisi sekali, hanya pada hari sesi (Asia/Jakarta), hanya untuk sesi di periode Approved/Locked. HADIR hanya untuk sesinya sendiri; TUKAR/MENGGANTIKAN boleh untuk sesi mana pun hari itu. Tidak bisa diubah setelah dikirim. Satu mentor tidak bisa tercatat mengajar dua sesi pada tanggal dan sesi yang sama.
- **Admin** (`/admin/absensi`): lihat per tanggal, tambah, koreksi, dan hapus (tanpa batas waktu). Koreksi menyimpan `edited_by` dan catatan. Penghapusan permanen dan belum punya riwayat (audit log di Phase 17).
- **Keamanan:** tabel hanya bisa ditulis lewat fungsi (`submit_attendance`, `admin_set_attendance`, `admin_delete_attendance`); mentor hanya membaca catatannya sendiri dan membaca sesi hari ini lewat `attendance_today()`.
- **Belum ada:** ekspor sheet (Phase 16), pengaruh ke payroll (Phase 14, aturan belum ditentukan), pembatalan sesi yang sudah punya presensi tidak menghapus presensinya (payroll nanti hanya menghitung sesi yang masih SCHEDULED).

## Tes RLS

File di `supabase/tests/`:

| File | Cakupan |
|---|---|
| `profiles_rls.test.sql` | 20 kasus Phase 2: anon, tutor, user nonaktif, admin, eskalasi role, admin aktif terakhir |
| `master_data_rls.test.sql` | 17 kelompok kasus Phase 3: akses per peran, tidak ada DELETE, constraint (kode, kapasitas, durasi), tumpang tindih slot, `set_active_days()` |
| `academic_rls.test.sql` | 17 kelompok kasus Phase 4: akses per peran, tidak ada DELETE, kolom tak bisa diubah, `move_student`, riwayat, kode siswa, constraint, view jumlah siswa |
| `tutors_rls.test.sql` | 16 kelompok kasus Phase 5: anon, tutor A/B, tutor nonaktif, admin; isolasi rate, eskalasi, fungsi availability/kompetensi/update tutor, constraint, cascade |
| `fixed_room.test.sql` | 7 kelompok kasus Phase 6: ruangan tetap harus aktif, ganti/kosongkan, berbagi ruangan, kapasitas tidak dipaksa, ruangan dinonaktifkan, tanpa DELETE, tutor/anon |
| `academic_config.test.sql` | 11 kelompok kasus Phase 7: nilai per level, upsert, validasi nilai/scope/hari, clear, distribusi (item fleksibel, penggantian atomik, input buruk), tanpa tulis langsung, tutor/anon |
| `attendance.test.sql` | 8 kelompok kasus Phase 13: HADIR, validasi, TUKAR/MENGGANTIKAN, satu catatan per sesi, hanya hari ini dan periode final, bacaan mentor, admin (tambah/ubah/hapus), constraint tabel, hak akses |
| `tutor_schedule.test.sql` | 1 kelompok kasus Phase 12: `my_schedule` (hanya sesi sendiri, hanya Approved/Locked, sesi batal tersembunyi, batas rentang, admin/anon ditolak) |
| `schedule_status.test.sql` | 9 kelompok kasus Phase 11: 25 pasangan transisi status, syarat approve, proteksi APPROVED/LOCKED, cancel membebaskan slot, Generate Additional (hanya menambah, sesi lama utuh, atomik, validasi hanya sesi baru), hak akses |
| `schedule.test.sql` | 11 kelompok kasus Phase 10: periode (unik, urutan, panjang, tumpang tindih), sesi manual (semua aturan), dobel, ubah/batalkan, proteksi status, generate atomik, laporan validasi, ubah periode, hak akses |

Jalankan seluruh isi file di SQL Editor pada project **dev/scratch** atau lewat `psql`. Semua perubahan di-rollback, dan tes tidak bergantung pada isi database (akun dan data yang sudah ada tidak mengganggu). Hasil yang benar: tidak ada error merah. Di `psql` terlihat NOTICE `PASS ...` per kasus dan `SEMUA TES LULUS` di akhir; SQL Editor Supabase mungkin tidak menampilkan NOTICE, jadi ketiadaan error sudah berarti lulus. Jika ada kasus yang gagal, pesan error menyebut kasusnya. Tes ini wajib dijalankan ulang setiap ada perubahan policy atau tabel baru.

## Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # isi nilai Supabase Anda
npm run dev                  # http://localhost:3000
```

Cek deployment: `GET /api/health` mengembalikan `{ "status": "ok", "phase": 6 }`.

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
    config/       resolver konfigurasi, distribusi, validasi discrepancy [engine murni, ber-tes]
    scheduler/    scheduling engine            [engine murni]
    validation/   tanggal, ekspansi pola mingguan, pesan pelanggaran, distribusi mingguan [engine murni, ber-tes]
    schedule/     rencana jadwal per periode, skema form, label [murni, ber-tes]
    simulator/    simulator                    [engine murni]
    payroll/      kalkulasi payroll            [engine murni]
    supabase/     client browser & server
    auth/         role, profile, sesi, guard requireRole()
    master-data/  skema Zod, helper waktu/kapasitas, pemetaan error DB (murni, ber-tes)
    academic/     skema Zod, label, tanggal, pencarian/paginasi siswa (murni, ber-tes)
    tutors/       skema Zod, grid availability, label tutor (murni, ber-tes)
    rooms/        analisis ruangan tetap vs kapasitas (murni, ber-tes)
    scheduler/    tipe bersama, kebutuhan sesi, kelayakan, scheduler constraint-based, penjelasan (murni, ber-tes)
    simulator/    RNG berseed, generator skenario, metrik, runner (murni, ber-tes)
    sheets/       sinkronisasi DB -> Google Sheets
    env.ts        validasi environment (Zod)
  components/     komponen UI bersama (ActionForm, AdminNav)
  server/         use-case / server actions per domain
    master-data/  queries + server actions subtes, ruangan, slot, hari aktif
    academic/     queries + server actions program, tipe kelas, rombel, siswa
    tutors/       queries + server actions mentor, kompetensi, availability
    config/       queries + server actions konfigurasi sesi dan distribusi subtes
    schedule/     queries + server actions periode, generate, dan edit sesi
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

## Fondasi tampilan (UI foundation)

Token desain (warna, font Inter, ukuran heading) ada di `src/app/globals.css`. Komponen bersama:
`components/{icons,brand,ui}.tsx` (Icon, Brand, PageHeader, Card, Badge, StatCard), `form-styles.ts`,
`admin-nav.tsx` (sidebar navy), `tutor-bottom-nav.tsx`. Logo resmi: letakkan di `public/` lalu ubah `components/brand.tsx`.

## Tambah mentor dari aplikasi (Phase 13b)

Menu **Admin → Mentor** kini punya formulir **Tambah mentor** (nama, email, level, rate, dapat dijadwalkan, kirim email undangan) dan **Ubah email mentor**.
- Akun dibuat lewat Supabase Auth Admin API di server (`src/lib/supabase/admin.ts`, memakai `SUPABASE_SERVICE_ROLE_KEY`, hanya setelah `requireRole(["admin"])`). Kunci ini tidak boleh berawalan `NEXT_PUBLIC_`.
- Alur: buat akun → profil dijadikan role `tutor` aktif → `admin_update_tutor` mengisi level/rate/dapat-dijadwalkan. Bila langkah setelah pembuatan akun gagal, akun dihapus kembali (rollback).
- Tanpa email undangan: akun dibuat terkonfirmasi tanpa password; kirim email atur-password lewat **Ubah email**.
- Tidak ada fitur hapus akun di UI.
