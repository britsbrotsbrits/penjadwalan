# Phase 0 — 04. Model Security & RLS

Prinsip: secure-by-design. RLS diaktifkan di SEMUA tabel di schema `public`; tanpa policy = tanpa akses. Policy dianalisis dari seluruh jalur akses, bukan satu kolom.

## 1. Identitas & role

- Sumber role: `profiles.role`, hanya dapat diubah oleh Admin (server). Jangan memakai `user_metadata` (dapat diubah user) sebagai dasar otorisasi.
- Helper SQL `SECURITY DEFINER` dengan `search_path` terkunci: `is_admin()`, `current_tutor_id()`. Dipakai di semua policy agar konsisten dan tidak rekursif.
- Service role key hanya di server (env), tidak pernah di client. Dipakai sempit: scheduler run, sinkronisasi Sheets, job sistem.

## 2. Pertanyaan analisis wajib per tabel

Siapa pemilik? Siapa boleh baca? Siapa boleh ubah? Relasi antar-row? Akses tidak langsung (via join/view/RPC)? Akses langsung dengan anon key? Bisakah data dibaca lewat tabel lain?

## 3. Matriks akses (usulan)

| Tabel | Admin | Tutor |
|---|---|---|
| profiles | CRUD | baca/ubah profil sendiri (kolom terbatas; bukan role) |
| tutor_profiles | CRUD | baca sendiri; **rate**: baca sendiri saja |
| programs, class_types, subtests | CRUD | baca |
| rombels | CRUD | baca hanya rombel yang ia ajar (via teaching_session_rombels) |
| students | CRUD | **tidak ada akses** default (lihat DEC-07) |
| tutor_competencies | CRUD | baca sendiri |
| tutor_availability | CRUD | CRUD baris sendiri (selama period terbuka) |
| tutor_requests | CRUD | buat/baca sendiri |
| rooms | CRUD | baca |
| scheduling_settings, distribusi, rules | CRUD | tidak ada |
| teaching_sessions | CRUD (via server+validasi) | baca hanya `tutor_id = sendiri` dan status APPROVED/LOCKED |
| teaching_session_rombels | CRUD | baca untuk sesi miliknya |
| scheduling_runs, unscheduled_requirements | CRUD | tidak ada |
| attendance | baca semua; koreksi (tercatat) | insert/baca sendiri, hanya untuk sesinya, dalam jendela waktu yang valid; tidak bisa edit/hapus setelah submit |
| payroll_periods/items | CRUD | baca item sendiri saja |
| notifications | baca semua admin | baca yang ditujukan ke dirinya |
| audit_logs | baca; insert hanya via server/trigger | tidak ada; tidak ada UPDATE/DELETE untuk siapa pun |
| sync_runs, integration_settings | CRUD | tidak ada |

## 4. Jalur akses tidak langsung yang wajib diperiksa

1. **Tutor → rombel → students**: policy baca `rombels` untuk tutor tidak boleh membuka `students` otomatis. `students` terpisah dan tertutup.
2. **Embedded select PostgREST** (`rombels(students(*))`): RLS tabel anak tetap berlaku; diuji.
3. **Views**: dibuat `security_invoker = true`; tanpa itu view melewati RLS pemilik.
4. **RPC / SECURITY DEFINER**: setiap fungsi memeriksa `is_admin()` / kepemilikan secara eksplisit; tidak mengembalikan baris di luar entitlement.
5. **Jadwal DRAFT/GENERATED**: tutor tidak boleh melihat jadwal yang belum APPROVED (mencegah bocornya draft).
6. **Combined session**: tutor melihat nama rombel anggota sesinya, tapi tidak data siswa.
7. **Attendance**: policy insert memverifikasi `teaching_session.tutor_id = current_tutor_id()` dan sesi tidak CANCELLED; tutor tidak dapat menulis `tutor_id` orang lain atau mengubah koreksi/payroll.
8. **Rate & payroll**: tutor lain tidak boleh membaca rate/total tutor lain, termasuk lewat agregasi view.
9. **Escalation**: tutor tidak boleh meng-update `role`, `rate_per_session`, `level` sendiri (batasi kolom via RPC atau trigger, bukan hanya policy baris).
10. **Public/anon**: tidak ada policy untuk `anon` pada tabel domain. Tidak ada "public read" hanya karena data terlihat final.

## 5. Mutasi & server-side

- Setiap server action: autentikasi → otorisasi (role) → validasi Zod → validasi domain (validator engine) → mutasi → audit log.
- Jangan mengandalkan UI untuk membatasi; DB (RLS + constraint/trigger) adalah lapisan terakhir.
- Operasi multi-tabel (generate, approve, lock) berjalan dalam transaksi.

## 6. Pengujian security (Phase 2 dan seterusnya)

Set tes RLS per tabel: (a) anon, (b) tutor A, (c) tutor B, (d) admin, untuk SELECT/INSERT/UPDATE/DELETE, termasuk embedded select, view, dan RPC. Tes ini menjadi bagian Definition of Done setiap phase yang menambah tabel.
