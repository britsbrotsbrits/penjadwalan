# Phase 0 — 01. Requirement Lock

Status: DRAFT untuk review. Sumber: Master Project Overview. Tidak ada requirement yang diubah; hal yang belum final dicatat di Bagian 7 (TBD) dan Bagian 8 (risiko/temuan).

## 1. Prinsip yang dikunci

| # | Prinsip |
|---|---|
| P1 | CODING = ENGINE; DATABASE + CONFIGURATION = RULES |
| P2 | Supabase/PostgreSQL = source of truth. Google Sheets hanya output (DB → Sheets) |
| P3 | Failure harus eksplisit: required / scheduled / unscheduled + alasan |
| P4 | Schedule (rencana) ≠ Attendance (aktual). Payroll = attendance valid × rate |
| P5 | Seniority, request tutor = soft. Junior tidak punya cap 50% |
| P6 | Approved/Locked tidak pernah disentuh Generate Additional |
| P7 | Prioritas: correctness > integrity > security > validity jadwal > maintainability > configurability > performance > UI |

## 2. Role

- ADMIN: akses penuh operasional.
- TUTOR: login; profil, availability sendiri, jadwal sendiri, rombel/sesi yang diajar, isi attendance sendiri, riwayat attendance, estimasi penghasilan sendiri.
- SISWA: entity data saja, tanpa login.

## 3. Hierarki data

Program → Class Type (template) → Rombel (instance dinamis) → Student.
Nama rombel (Junior A, B, ...) adalah data, bukan kode.

## 4. Seed data (data awal, BUKAN konstanta kode)

### Program & Class Type (ukuran = kapasitas siswa default class type)
| Program | Class Type (ukuran) |
|---|---|
| Kelas 3 SMA | General (20), VVIP (13), Fast Track (7) |
| Super Camp | VVIP (7), Gold (3), Platinum (1) |
| Super Intensif | Regular (20), Junior (14), VIP (14), Eksekutif (7) |
| Gap Year | Junior (20), Eksekutif (14), Gold (6), Platinum (3) |

### Default session per hari (konfigurasi level Class Type)
| Program | Class Type → sesi/hari |
|---|---|
| Kelas 3 SMA | General 1, VVIP 1, Fast Track 2 |
| Gap Year | Junior 2, Eksekutif 2, Gold 2, Platinum 2 |
| Super Intensif | Regular 2, Junior 3, VIP 4, Eksekutif 4 |
| Super Camp | VVIP 6, Gold 6, Platinum 6 |

### Subtes (master data, extensible)
LBI, LBE, PU, PPU, KMM, PM, PK.

### Ruangan awal (15, belum final)
Amsterdam 20, Bolivia 7, Kamerun 20, Dominika 3, Egypt 20, Jordan 13, Kanada 13, Latvia 20, France 20, Grenada 3, Hungaria 6, Maroko 13, Norwegia 13, Oman 20, Polandia 14.

### Kalender default
Senin–Sabtu, 8 sesi/hari, 90 menit, mulai 07.00 (07.00–08.30 ... 17.30–19.00). Semua configurable (jumlah, waktu, durasi, hari aktif, period, special session).

### Baseline distribusi mingguan Gap Year (configurable)
KMM 1, PPU 1, KMM/PPU Flexible 1, PM 2, PK 3, PU 2, LBI 1, LBE 1 = 12/minggu.
"KMM/PPU Flexible" bukan subtes baru; ia slot fleksibel yang boleh diisi KMM atau PPU.

## 5. Hierarki konfigurasi

Global default → Program/Class Type default → Rombel override → Day/Period override. Scheduler memakai nilai aktif paling spesifik.

## 6. Constraint

### Hard
1. Tutor tidak double booking.
2. Room tidak double booking.
3. Rombel tidak punya dua sesi di slot yang sama.
4. Tutor harus available (kecuali override eksplisit + tercatat audit).
5. Tutor harus kompeten pada subtes.
6. Kapasitas room ≥ jumlah siswa rombel.
7. Fixed room dihormati.
8. Combined session hanya jika rule mengizinkan.
9. Jadwal LOCKED/APPROVED tidak diubah oleh Generate Additional.
10. Tidak ada jadwal invalid yang dinyatakan valid.

### Soft (bobot configurable)
Seniority untuk kelas bernilai tinggi, request tutor (kecuali dijadikan mandatory oleh Admin), workload balance, variasi hari, hindari pola terlalu berat, distribusi tutor merata, randomisasi hanya antar kandidat setara.

## 7. TBD Register (JANGAN dikarang; harus configurable)

| ID | Item | Perlakuan sementara |
|---|---|---|
| TBD-01 | Jumlah sesi malam/asrama dan mapping final combined session (VVIP, Gold, Platinum) | Model combined-session rule generik, tanpa isi default |
| TBD-02 | Aturan break antar sesi | Tidak ada break sampai dikonfigurasi |
| TBD-03 | Distribusi subtes mingguan selain Gap Year | Validation warning "distribusi belum ada" |
| TBD-04 | Daftar ruangan lengkap | Admin menambah lewat UI |
| TBD-05 | Jika total sesi/minggu ≠ total distribusi subtes | Warning/error, tanpa sesi tambahan otomatis |
| TBD-06 | Kapasitas rombel untuk cek ruangan: pakai jumlah siswa aktual atau ukuran class type? | Lihat DEC-02 |
| TBD-07 | Apakah beberapa rombel boleh di-fixed ke ruangan yang sama (bergantian waktu)? | Lihat DEC-03 |

## 8. Temuan & risiko (belum konflik, tapi perlu diketahui)

1. Konsistensi Gap Year: 2 sesi/hari × 6 hari = 12 = total baseline. Konsisten.
2. Program lain memiliki total sesi/minggu (mis. Kelas 3 SMA General = 6, Super Camp = 36, Super Intensif VIP = 24) tanpa distribusi subtes → TBD-03.
3. Bottleneck ruangan (dari 15 ruangan awal): kelas berukuran 20 hanya muat di 6 ruangan (Amsterdam, Kamerun, Egypt, Latvia, France, Oman); kelas 14 muat di 7 (6 itu + Polandia). Banyak rombel General/Regular/Junior-Gap Year paralel bisa memicu "No available room". Simulator (Phase 8) harus menguji ini.
4. Ukuran pas (Bolivia 7 untuk 7 siswa, Hungaria 6 untuk 6) → tidak ada toleransi; perubahan jumlah siswa +1 membuat room invalid. Validation harus mendeteksi saat siswa dipindah/ditambah.
5. Platinum Gap Year = 3 siswa dan Gold Super Camp = 3 siswa hanya muat di ruangan ≥3 (semua muat); ruangan 3-kursi (Dominika, Grenada) adalah sumber daya langka untuk kelas kecil.
6. Super Camp 6 sesi/hari dari 8 slot: jika tidak ada aturan break, hampir seluruh hari terisi; tutor yang mengajar berturut-turut perlu diperhatikan workload (soft).
