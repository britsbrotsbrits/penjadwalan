# Phase 0 — 05. Keputusan Terbuka & Roadmap

## 1. Keputusan yang perlu dikonfirmasi sebelum Phase 1/2

Setiap item punya usulan default; jika tidak ada koreksi, usulan dipakai.

| ID | Pertanyaan | Usulan default |
|---|---|---|
| DEC-01 | Jadwal berbentuk template mingguan berulang, atau sesi bertanggal per period? | **Sesi bertanggal** per `schedule_period` (attendance dan payroll butuh tanggal nyata). Pola mingguan bisa dipakai sebagai input generator. |
| DEC-02 | Cek kapasitas ruangan memakai jumlah siswa aktual atau ukuran class type? | **Jumlah siswa aktual aktif**; jika 0 siswa, fallback ke ukuran class type dengan warning. |
| DEC-03 | Boleh beberapa rombel di-fixed ke ruangan yang sama? | Boleh secara data; konflik waktu tetap hard constraint. Validator memberi warning jika irisan kebutuhan melebihi kapasitas waktu. |
| DEC-04 | Combined session: tabel terpisah atau satu model `teaching_sessions` + anggota? | **Satu model** (sesi + anggota). Entity "Combined Session" tetap ada secara konseptual lewat sesi dengan >1 anggota dan `combined_session_rule_id`. |
| DEC-05 | Riwayat perpindahan siswa: tabel khusus atau cukup audit log? | Tabel `student_rombel_history` ringan + audit log. |
| DEC-06 | Eksekusi scheduler: sinkron di server atau job background? | Mulai sinkron dengan batas waktu; putuskan ulang setelah Stress Test simulator. |
| DEC-07 | Tutor boleh melihat nama siswa rombelnya? | **Tidak** pada awal (hanya rombel + jumlah siswa). Dapat dibuka nanti lewat view terbatas. |
| DEC-08 | Ruang lingkup attendance: status selain HADIR (izin/absen/pengganti)? | Awal hanya HADIR (+ koreksi Admin). Status lain ditambah saat Phase 13 jika diminta. |
| DEC-09 | Satu tutor satu rate, atau rate bisa berbeda per program/class type? | Satu rate per tutor, disimpan snapshot per payroll period. Rate per class type ditunda sampai diminta. |
| DEC-10 | Bahasa UI | Bahasa Indonesia (sidebar sesuai master prompt). Kode, nama tabel, dan komentar teknis dalam bahasa Inggris. |

## 2. Roadmap (mengikuti master prompt)

| Phase | Fokus | Keluaran utama |
|---|---|---|
| 0 | Requirement lock + arsitektur | 5 dokumen ini |
| 1 | Foundation | Next.js + TS + Tailwind, struktur repo, lint/test setup, koneksi Supabase, env, CI dasar |
| 2 | Schema + Auth + Roles | `profiles`, helper RLS, login, guard role, tes RLS pertama |
| 3 | Master data | subtes, ruangan, slot sesi/kalender |
| 4 | Program/Class Type/Rombel/Siswa | CRUD + seed program/class type |
| 5 | Tutor/Kompetensi/Availability | CRUD, UI availability tutor |
| 6 | Ruangan | manajemen ruangan + fixed room |
| 7 | Konfigurasi akademik | config resolver, distribusi subtes, validasi discrepancy |
| 8 | Simulator | generator data, runner, laporan metrik |
| 9 | Scheduling engine | pipeline constraint-based, explain unscheduled |
| 10 | Schedule management + validation | UI jadwal, manual adjustment tervalidasi |
| 11 | Approval/Lock/Incremental | state machine, Generate Additional |
| 12–17 | Tutor dashboard, Attendance, Payroll, Admin dashboard+notif, Reports+Sheets, Audit+hardening | sesuai master prompt |
| 18–20 | Testing/stress, UI final, production deploy | |

Urutan dapat bergeser bila dependensi mengharuskan (mis. config resolver dibutuhkan lebih awal oleh Phase 4). Pergeseran akan dilaporkan eksplisit.

## 3. Definition of Done (berlaku per step)

Implementasi selesai, type-safe, relasi DB valid, otorisasi + RLS valid dan teruji, batas server/client benar, error handling ada, UI usable, fitur lama tidak rusak, migrasi aman dan tidak duplikat, validasi berjalan, instruksi tes manual tersedia. Untuk scheduler ditambah: lulus simulasi dan validasi.

## 4. Format laporan tiap step

Objective → file/tabel terdampak → implementasi (hanya scope step) → validasi → ringkasan: files changed, database changes, logic added, security considerations, testing result, manual verification, remaining issue.

## 5. Di luar lingkup (kecuali diminta)

Login siswa, aplikasi mobile native, pembayaran online, penggunaan Google Sheets sebagai database utama, optimasi performa prematur.
