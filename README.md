# Sistem RKAP 2027 - PT Energi Batubara Lestari

Website internal penyusunan RKAP (Rencana Kerja format Balanced Scorecard + Anggaran OPEX/CAPEX berbasis Kode WBS),
lengkap dengan login, peran, alur pengajuan/persetujuan, konsolidasi, dan log audit.
Seluruh komponen gratis dan open source: Node.js, Express, SQLite.

## Menjalankan (Windows/Mac/Linux)
1. Pasang Node.js versi 22.13 atau lebih baru (LTS) dari nodejs.org.
2. Buka terminal di folder ini, lalu:
   ```
   npm install
   npm start
   ```
   (Windows: cukup klik dua kali `mulai.bat`.)
3. Saat pertama jalan, terminal menampilkan password akun `admin`. Simpan. (Atau tetapkan sendiri: `ADMIN_PASSWORD=...` sebelum `npm start`.)
4. Buka http://localhost:3000, login sebagai admin, menu **Pengguna** -> buat akun per departemen (peran `departemen`),
   akun CPOC/Finance (peran `reviewer`).
5. Agar bisa dibuka rekan sekantor: jalankan di satu komputer/server yang menyala terus, lalu akses lewat
   `http://<IP-komputer>:3000` dari jaringan kantor. Data tersimpan di `data/rkap.db` (backup file ini rutin).

## Peran
- **departemen**: hanya mengisi/mengajukan departemennya sendiri. Setelah Diajukan, data terkunci.
- **reviewer**: melihat semua, Setujui / Minta Revisi (dengan catatan), lihat Konsolidasi.
- **admin**: semua hak di atas + kelola pengguna.

## Aturan yang divalidasi server saat Ajukan
Bobot BSC total 100%; perspektif valid; nama Program Kerja unik; setiap baris OPEX/CAPEX memakai Kode WBS yang ada di master
dan terhubung ke Program Kerja yang ada.

## Menjalankan tes
`npm test` (menguji alur login, pembatasan akses antar departemen, validasi, pengajuan, review, konsolidasi).

## Opsi hosting gratis
Aplikasi ini butuh Node.js dan **disk yang permanen** (file SQLite). Banyak layanan hosting gratis tidak menyediakan disk permanen
atau membatasi/menghentikan aplikasi yang tidak aktif, sehingga data bisa hilang. Cek syarat terbaru layanan yang dipilih.
Pilihan paling aman tanpa biaya: komputer/server kantor sendiri (sudah ada) yang menyala selama masa pengisian RKAP.
Untuk Docker: `docker build -t rkap . && docker run -p 3000:3000 -v rkap-data:/app/data rkap`.

## Keamanan (wajib untuk produksi)
- Pasang di belakang HTTPS (mis. Nginx/Caddy), lalu set `COOKIE_SECURE=1`.
- Jangan buka ke internet tanpa HTTPS; batasi ke jaringan kantor/VPN.
- Ganti password admin awal; gunakan password unik per akun.
- Backup `data/rkap.db` harian.

## Keterbatasan versi ini
Ekspor baru CSV (belum .xlsx / format upload SAP); login lokal (belum SSO Microsoft/Google);
`node:sqlite` masih berstatus eksperimental di Node 22 (untuk skala besar, pindah ke PostgreSQL);
belum ada fitur Realisasi vs RKAP.
