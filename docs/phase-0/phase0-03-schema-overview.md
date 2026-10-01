# Phase 0 — 03. Skema Level Tinggi

Ini peta entitas dan relasi, BUKAN DDL final. DDL dibuat bertahap per phase (Phase 2 dst.). Daftar tabel dari master prompt dipakai sebagai referensi, disesuaikan dengan dependensi nyata.

## 1. Domain & tabel

### Identitas
- `profiles` (id = auth.users.id, role: admin|tutor, nama, aktif). Role disimpan di tabel ini, BUKAN di user metadata yang dapat diubah user.
- `tutor_profiles` (id, profile_id, level/seniority, rate_per_session, aktif).

### Struktur akademik
- `programs`
- `class_types` (program_id, nama, default_size) — unik (program_id, nama).
- `rombels` (class_type_id, nama, aktif, periode mulai/selesai, fixed_room_id nullable). Unik (class_type_id, nama).
- `students` (nama, kode internal, rombel_id, status). 
- `student_rombel_history` (perpindahan; atau lewat audit_logs — DEC-05).
- `subtests` (kode, nama, aktif, urutan).
- `tutor_competencies` (tutor_id, subtest_id) — unik pasangan.

### Ruangan
- `rooms` (nama, kapasitas > 0, aktif).

### Konfigurasi
- `calendar_settings` / `session_slots` (nomor sesi, jam mulai, durasi, aktif) + `active_days`.
- `scheduling_settings` (key, scope_type: global|program|class_type|rombel|rombel_day, scope_id, day_of_week nullable, period_id nullable, value jsonb) — unik pada kombinasi scope; value divalidasi Zod per key. Memuat sesi/hari, bobot soft, dll.
- `subtest_distributions` (scope: class_type/rombel, period nullable) + `subtest_distribution_items` (subtest_id nullable, is_flexible_group, sessions_per_week). "KMM/PPU Flexible" dimodelkan sebagai item flexible dengan daftar subtes yang diperbolehkan (`flexible_allowed_subtests`), bukan subtes baru.
- `combined_session_rules` (program/class_type, jenis sesi, anggota maksimum, aktif) — isi belum ditentukan (TBD-01).

### Tutor operasional
- `tutor_availability` (tutor_id, period_id nullable, day_of_week, slot_no, available) — unik.
- `tutor_requests` (tutor_id, rombel_id/subtest, mandatory bool, status).

### Scheduling
- `schedule_periods` (rentang tanggal, status)
- `scheduling_runs` (period_id, mode: full|additional|simulation, seed, status, ringkasan jsonb)
- `teaching_sessions` (period_id, tanggal, slot_no, subtest_id, tutor_id, room_id, status, locked bool, run_id, created_by)
- `teaching_session_rombels` (teaching_session_id, rombel_id) — anggota sesi.
  - Sesi normal = 1 anggota; combined session = >1 anggota. Satu model untuk keduanya menggantikan tabel terpisah `combined_sessions` kecuali ada kebutuhan khusus (DEC-04). `combined_session_rule_id` nullable pada sesi menunjuk rule yang mengizinkan.
- `unscheduled_requirements` (run_id, rombel_id, subtest_id, jumlah, reason_code, detail jsonb).

Constraint DB (pertahanan terakhir selain engine):
- Tutor tidak double booking: unique (tutor_id, tanggal, slot_no) untuk sesi tidak CANCELLED (partial unique index).
- Room tidak double booking: unique (room_id, tanggal, slot_no) idem.
- Rombel tidak punya dua sesi di slot sama: unique (rombel_id, tanggal, slot_no) via tabel anggota (perlu kolom denormalisasi tanggal/slot + trigger konsistensi).
- Kapasitas, kompetensi, availability: dicek oleh trigger/fungsi validasi pada insert/update (selain engine), karena tidak bisa diekspresikan sebagai unique index.

### Attendance & payroll
- `attendance` (teaching_session_id, tutor_id, status HADIR|..., waktu check-in, dikoreksi_oleh, alasan koreksi) — unik (teaching_session_id, tutor_id).
- `payroll_periods`, `payroll_items` (tutor_id, jumlah attendance valid, rate snapshot, total, status). Rate disalin (snapshot) saat period dihitung agar perubahan rate tidak mengubah histori.

### Sistem
- `notifications` (recipient/role, tipe, payload, action_url, dibaca)
- `audit_logs` (actor_id, waktu, entity, entity_id, before, after, alasan)
- `sync_runs`, `integration_settings` (konfigurasi Sheets; kredensial TIDAK disimpan di DB, memakai env server).

## 2. Hubungan kunci (ringkas)

```
programs 1─n class_types 1─n rombels 1─n students
tutor_profiles n─n subtests (tutor_competencies)
tutor_profiles 1─n tutor_availability
rooms 1─n rombels (fixed_room_id, opsional)
teaching_sessions n─1 tutor_profiles / rooms / subtests
teaching_sessions 1─n teaching_session_rombels n─1 rombels
teaching_sessions 1─n attendance
payroll_items ← agregasi attendance valid
```

## 3. Catatan integritas

- Hapus = soft delete (aktif/nonaktif) untuk entitas yang direferensikan histori jadwal/attendance/payroll; FK `ON DELETE RESTRICT`.
- Semua tabel punya `created_at`, `updated_at`; tabel mutasi penting dikaitkan ke audit log lewat server (atau trigger untuk perubahan yang tidak boleh terlewat).
- Jumlah siswa rombel untuk cek kapasitas dihitung dari `students` aktif (lihat DEC-02).
- Indeks awal: (tutor_id, tanggal, slot_no), (room_id, tanggal, slot_no), (rombel_id) pada anggota, (rombel_id, status) pada students.
