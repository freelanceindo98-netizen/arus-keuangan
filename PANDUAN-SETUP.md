# ARUS — PANDUAN PEMASANGAN PWA KEUANGAN PRIBADI

Aplikasi mobile-first yang membaca dan menulis transaksi **langsung** ke spreadsheet Google Sheets yang sudah ada. **Tidak membuat spreadsheet baru. Tidak mengubah skrip bot Telegram.**

> Penting: Aplikasi ini sudah disiapkan sebagai **kode sumber siap konfigurasi**, bukan situs yang sudah online. Tanpa Google OAuth Client ID dan link spreadsheet asli, koneksi ke akun Google belum bisa diuji secara langsung. Ikuti petunjuk di bawah.

## 1. Yang perlu disiapkan

- Akun Google yang punya hak **Editor** pada Google Sheets pribadi Anda.
- Spreadsheet yang sudah memiliki tab persis bernama **Pemasukan** dan **Pengeluaran**.
- Header **A1:G1** pada kedua tab dalam urutan ini:
  `Tanggal & Jam | Kategori | Keterangan | Nominal (Rp) | Bulan | Sumber | ID Update`
- Akun GitHub gratis untuk memublikasikan aplikasi dengan HTTPS.
- Akses ke [Google Cloud Console](https://console.cloud.google.com/).

**Backup terlebih dahulu:** di Google Sheets pilih **File → Buat salinan** untuk pemulihan jika nanti salah mengedit/menghapus transaksi. Aplikasi tetap menggunakan **spreadsheet asli**, bukan salinan tersebut.

## 2. Mengapa tanpa Google Apps Script baru?

Anda sudah memiliki bot Telegram dengan Google Apps Script aktif. Agar tidak perlu mengganti kode atau memicu benturan fungsi di proyek lama, versi ini memakai **Google Sheets API langsung dari browser + Login Google (OAuth)**. Ini juga membuat halaman bisa benar-benar menjadi PWA dengan manifest dan service worker. Tidak memerlukan server, database, API key, atau Google Apps Script kedua.

Keamanan: pengguna harus login ke Google dan memiliki izin terhadap spreadsheet. **Frontend GitHub Pages bisa dikunjungi publik**, tetapi data Sheets **tidak** menjadi publik. Di Google Cloud, biarkan aplikasi dalam mode *Testing* dan tambahkan **hanya akun Anda** sebagai test user. Jangan jadikan spreadsheet publik, jangan unggah token akses, password, atau Client Secret ke GitHub. Client ID web bukan rahasia; Client Secret adalah rahasia.

Google Sheets API meminta izin **melihat, mengedit, membuat, dan menghapus spreadsheet yang dapat diakses akun tersebut**; izin ini cukup luas. Hanya izinkan aplikasi/proyek OAuth milik Anda sendiri dan batasi akses spreadsheet.

## 3. Memublikasikan PWA ke GitHub Pages

1. Buat akun di https://github.com/ jika belum ada.
2. Klik **New repository**. Contoh nama: `arus-keuangan` dan pilih **Public** (GitHub Pages tersedia gratis untuk repo publik). **Jangan unggah file keuangan pribadi**.
3. Di komputer, ekstrak file `Arus-PWA-Keuangan.zip`.
4. Buka repositori → **Add file → Upload files**. Unggah semua file **di dalam** folder `Keuangan-PWA`, termasuk folder `icons`, sehingga `index.html` berada di akar repositori. `PANDUAN-SETUP.md` boleh ikut diunggah.
5. Klik **Commit changes**.
6. Masuk ke **Settings → Pages**. Pada **Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/(root)`, lalu **Save**.
7. Alamat situs umumnya menjadi `https://USERNAME.github.io/arus-keuangan/` (ganti USERNAME dengan nama pengguna GitHub Anda).
8. Pastikan situs tampil di browser. Pada tahap ini halaman akan meminta Client ID Google (memang belum dikonfigurasi).

**Catatan:** Semua file frontend di repository publik bisa dilihat orang. Itu normal dan tidak memberikan akses ke spreadsheet; sistem pengaman sebenarnya adalah autentikasi Google dan izin berbagi Sheets. Jangan menambahkan data/rahasia ke dalam repository.

## 4. Mengaktifkan Google Sheets API

1. Buka https://console.cloud.google.com/ dan login menggunakan **akun Google Anda sendiri**.
2. Pada pemilih proyek di bagian atas klik **New Project**; beri nama misalnya **Arus Keuangan Pribadi**.
3. Dalam proyek tersebut buka **APIs & Services → Library**.
4. Cari **Google Sheets API**, klik lalu pilih **Enable**.
5. Buka **Google Auth Platform** (di beberapa tampilan disebut OAuth consent screen).
6. Pada **Branding**, isikan nama aplikasi misalnya `Arus Keuangan` dan email pendukung milik Anda.
7. Pada **Audience**, pilih **External** dan status **Testing**. Di bagian **Test users**, tambahkan alamat email Google **Anda sendiri**. Jangan menambahkan pengguna tidak dikenal.
8. Pada **Data Access/Scopes**, jika diminta, tambahkan scope:
   `https://www.googleapis.com/auth/spreadsheets`
9. Pada **Clients → Create Client**, pilih jenis **Web application**.
10. Isi nama misalnya `Arus PWA Web`.
11. Pada **Authorized JavaScript origins**, klik **Add URI**, masukkan **asal situs (origin) saja** tanpa nama repository, contoh:
    `https://USERNAME.github.io`
12. Kolom **Authorized redirect URIs** boleh dibiarkan kosong karena aplikasi memakai token popup (bukan authorization-code redirect).
13. Klik **Create**. Salin **Client ID** yang berakhiran `.apps.googleusercontent.com` — **jangan salin Client Secret ke aplikasi**.

Jika Anda menggunakan domain sendiri, tambahkan origin HTTPS domain tersebut. Jika melakukan pengujian dengan server lokal, tambahkan `http://localhost:5500` atau origin sesuai port yang Anda gunakan.

Google dapat menampilkan persetujuan izin dan peringatan aplikasi dalam pengujian. Lanjutkan **hanya** apabila aplikasi OAuth itu benar-benar proyek milik Anda, dan izin yang ditampilkan sesuai kebutuhan. Mode Testing bisa meminta pemberian izin kembali secara berkala.

## 5. Memasukkan Client ID ke aplikasi

1. Di repositori GitHub, buka file `config.js`, klik **Edit** (ikon pensil).
2. Ganti teks:

   `GANTI_DENGAN_CLIENT_ID.apps.googleusercontent.com`

   dengan **Client ID** yang Anda salin dari Google Cloud.
3. Jangan ubah tanda petik, koma, atau nama properti lainnya.
4. Klik **Commit changes**.
5. Buka kembali alamat aplikasi setelah perubahan dipublikasikan. Jika browser menyimpan versi lama, refresh halaman atau buka ulang aplikasinya.

**Contoh format** (bukan kredensial sungguhan):

```javascript
window.ARUS_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID: '1234567890-abcdef.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  SOURCE_DEFAULT: 'Aplikasi PWA',
  TIMEZONE: 'Asia/Makassar'
});
```

## 6. Menghubungkan ke Google Sheets yang SUDAH ADA

1. Buka Google Sheets asli yang sudah punya tab **Pemasukan** dan **Pengeluaran**.
2. Klik **Bagikan → Salin link**. **Jangan mengubah pengaturan share menjadi publik**.
3. Buka PWA → menu **Pengaturan**.
4. Tempel link Google Sheets tersebut ke kolom **Link atau ID spreadsheet**.
5. Tekan **Simpan spreadsheet**. Link/ID hanya disimpan di browser perangkat itu.
6. Tekan **Hubungkan Google**.
7. Pilih akun Google yang mempunyai akses **Editor** ke spreadsheet.
8. Setujui izin akses yang ditampilkan Google.
9. Aplikasi akan membaca data dari dua tab tersebut dan menampilkan dashboard.

**Jangan membuka dengan `file://` atau double-click index.html untuk penggunaan normal.** Aplikasi OAuth dan PWA harus diakses melalui HTTPS, misalnya GitHub Pages.

## 7. Mencatat transaksi dari HP

1. Tekan tombol **+ Tambah Transaksi**.
2. Pilih **Pengeluaran** atau **Pemasukan**.
3. Ketik nominal, misalnya `25000`, lalu pilih/ketik **Kategori**.
4. Tanggal sudah otomatis **hari ini** (waktu Asia/Makassar). Ubah hanya bila perlu.
5. Isi **Keterangan** jika ingin.
6. Tekan **Simpan transaksi**.

Aplikasi menambahkan baris baru dengan tujuh kolom yang cocok:

| Kolom | Contoh yang disimpan |
|---|---|
| A — Tanggal & Jam | Tanggal/jam Google Sheets (diformat `17/11/2026 06:30`) |
| B — Kategori | Makanan & Minuman |
| C — Keterangan | Beli sarapan |
| D — Nominal (Rp) | 25000 (angka, bukan teks) |
| E — Bulan | `2026-11` (sama seperti skrip bot Telegram) |
| F — Sumber | `Aplikasi PWA` |
| G — ID Update | Kosong (tidak mengganggu ID numerik Telegram) |

Tanggal disimpan sebagai nilai **tanggal/jam numerik asli Google Sheets**, bukan sekadar string, dan aplikasi mengatur format tampilannya. Kode bot Telegram sebelumnya tidak diubah. Tab/dashboard lain yang mungkin sudah ada di file tersebut juga tidak dimodifikasi aplikasi.

## 8. Riwayat, edit, hapus, dan analisis

- **Beranda**: ringkasan saldo, pemasukan, pengeluaran, kategori terbesar, transaksi terbaru.
- **Periode**: hari ini, minggu berjalan, bulan berjalan, custom tanggal.
- **Riwayat**: cari berdasarkan kategori/keterangan; filter jenis, kategori dan tanggal; tekan **Ubah** atau **Hapus**.
- **Analisis**: rata-rata pengeluaran per hari, perubahan vs periode sebelumnya, kategori terbesar, grafik tren dan perbandingan pemasukan vs pengeluaran.
- **Pengaturan**: mengubah kategori tambahan dan label kolom Sumber untuk transaksi baru.

**Edit** hanya memperbarui A:D pada baris terpilih; E diperbarui ketika tanggal berubah jika bukan formula; F/G tetap dipertahankan. **Hapus** akan mengosongkan A:G setelah konfirmasi, tanpa menghapus baris fisik atau menggeser nomor baris lain. Baris yang sudah berubah di Google Sheets sesudah dimuat akan ditolak saat edit/hapus, sehingga pengguna diminta memuat ulang.

Catatan: tanpa transaksi unik permanen pada data lama, pemeriksaan baris tidak menjamin perlindungan absolut bila ada dua baris identik yang dipindahkan secara bersamaan. Sebelum menghapus, pastikan transaksi yang dipilih benar; cadangkan spreadsheet dan gunakan Google Sheets **Version history** apabila membutuhkan pemulihan.

## 9. Pasang di layar utama HP

### Android — Google Chrome
1. Buka alamat HTTPS aplikasi di Chrome.
2. Tekan menu titik tiga `⋮` → **Install app / Pasang aplikasi** atau **Tambahkan ke Layar Utama** (pilihan berbeda menurut versi Chrome).
3. Pilih **Install / Tambahkan**.
4. Ketuk ikon **Arus** dari layar utama.

### iPhone — Safari
1. Buka alamat HTTPS aplikasi di Safari.
2. Ketuk **Bagikan / Share**.
3. Pilih **Add to Home Screen / Tambahkan ke Layar Utama**.
4. Ketuk **Add / Tambah**.

**Koneksi internet dibutuhkan** untuk membaca dan menyimpan transaksi; PWA hanya menyimpan file tampilan agar dapat dimuat cepat. Tidak ada mode penyimpanan transaksi offline. Google dapat meminta login ulang apabila token sesi kedaluwarsa. Pada browser/versi HP tertentu, popup Google bisa diblokir dalam mode aplikasi; bila itu terjadi, buka alamat situs melalui Chrome/Safari untuk menghubungkan akun dan gunakan aplikasi yang kompatibel.

## 10. Checklist pengujian

- [ ] Kedua tab tetap bernama `Pemasukan` dan `Pengeluaran`, urutan A:G tidak berubah.
- [ ] Bot Telegram yang sudah ada masih dapat mencatat dan melaporkan transaksi.
- [ ] Masuk ke PWA dengan Google, data lama muncul di Riwayat.
- [ ] Pemasukan baru Rp 12.345 muncul sebagai satu baris baru di tab Pemasukan.
- [ ] Pengeluaran baru Rp 23.456 muncul sebagai satu baris baru di tab Pengeluaran.
- [ ] Kolom E berisi bulan `yyyy-MM`; kolom F `Aplikasi PWA`; kolom G kosong.
- [ ] Format A terlihat sebagai tanggal dan jam; D berupa nilai angka Rupiah.
- [ ] Filter hari ini, minggu ini, bulan ini, custom menampilkan total yang benar.
- [ ] Grafik kategori, tren, perbandingan membaca data asli.
- [ ] Nominal kosong, nol, negatif, atau non-angka ditolak.
- [ ] Edit salah satu transaksi percobaan dan periksa hanya baris tersebut berubah.
- [ ] Hapus transaksi percobaan, konfirmasi muncul dan baris lainnya tidak bergeser.
- [ ] Sesudah bot menulis transaksi baru, tekan Sinkronkan di PWA: transaksi tersebut muncul.
- [ ] Data lama tidak berubah tanpa tindakan edit/hapus yang disengaja.
- [ ] Dari HP, aplikasi dapat ditambahkan ke layar utama dan membuka tampilan PWA.
- [ ] Uji saat offline: aplikasi tidak mengaku berhasil menyimpan transaksi.

## 11. Jika terjadi kesalahan

| Tampilan/kondisi | Yang perlu diperiksa |
|---|---|
| Client ID belum dikonfigurasi | Edit `config.js` di GitHub dengan Client ID Web Application asli. |
| Login `origin_mismatch` | Authorized JavaScript origin harus `https://USERNAME.github.io`, tanpa path `/arus-keuangan`. |
| `access_blocked`/pengguna tidak diizinkan | Tambahkan email Anda pada Audience → Test users di Google Cloud. |
| `403` saat membuka data | Sheets API belum aktif, izin OAuth belum diberikan, atau akun tidak punya hak Editor pada file. |
| Tab tidak ditemukan | Pastikan nama tab persis `Pemasukan` dan `Pengeluaran`. |
| Header tidak sesuai | Pastikan urutan dan penulisan tujuh kolom A:G sama seperti screenshot; aplikasi berhenti agar aman. |
| Ada transaksi lama tidak masuk ringkasan | Periksa format tanggal lama; format umum `dd/MM/yyyy HH:mm` dan tanggal asli Sheets sudah didukung. |
| Muncul angka serial pada kolom tanggal | Penambahan tersimpan tetapi pemformatan sel gagal. Cek izin Editor dan formatkan kolom A sebagai `dd/MM/yyyy HH:mm`. |
| Grafik belum tampil | Cek transaksi memiliki tanggal yang dapat dibaca dan periode yang cocok. |
| Tombol tambah tidak bekerja | Pastikan spreadsheet sudah diatur dan login Google masih aktif. |
| Bot Telegram berhenti | Aplikasi PWA tidak memasang trigger atau mengedit skrip bot; periksa log Apps Script bot yang lama. |

## 12. Daftar file

```
Keuangan-PWA/
├── index.html             # Struktur layar dan formulir
├── styles.css             # Tampilan responsif mobile-first
├── app.js                 # Google OAuth, Sheets API, dashboard, transaksi
├── config.js              # Hanya isi GOOGLE_CLIENT_ID
├── manifest.webmanifest   # Metadata PWA
├── sw.js                  # Cache file statis PWA (bukan transaksi)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── PANDUAN-SETUP.md       # Panduan ini
```

### Batasan versi awal
- Belum terhubung karena belum ada OAuth Client ID, Spreadsheet ID, dan akun Google yang diberi izin.
- Grafik/format data riil perlu dites terhadap transaksi asli.
- Akses online diperlukan untuk membaca/menulis; aplikasi tidak menyimpan antrian transaksi saat offline.
- Login ulang dapat diperlukan ketika akses Google habis; instalasi PWA dan popup login mungkin berbeda antar HP/browser.
- Keamanan data mengikuti izin Sheets dan OAuth project, bukan perlindungan halaman GitHub Pages.
