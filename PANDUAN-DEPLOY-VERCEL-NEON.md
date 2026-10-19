# Panduan Deploy Dashboard ke Vercel + Database Neon

Nama menu di Vercel/Neon bisa sedikit berbeda dari tulisan di sini karena tampilannya sering diperbarui. Intinya sama.

## 0. Apa yang berubah di kode

| Sebelum | Sesudah |
|---|---|
| Data disimpan ke **Supabase** lewat REST API | Data disimpan ke **Neon Postgres** lewat driver `@neondatabase/serverless` |
| Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Env: **`DATABASE_URL`** (Supabase tidak dipakai lagi) |
| Ada `pnpm-lock.yaml` + `pnpm-workspace.yaml` berisi placeholder `set this to true or false` | Dihapus. Vercel memakai **npm** dan `package-lock.json` yang sudah sinkron |
| `package-lock.json` tidak sinkron (xlsx, jszip, html2canvas hilang) | Sudah diperbarui, `npm ci` lolos |
| Link tombol Telegram tanpa `https://` bila memakai URL otomatis Vercel | Sudah diperbaiki |

Folder lama `supabase/` sudah dihapus. Lapisan database sekarang ada di `features/shared/backend/database/db.ts` (fungsi `dbGet` / `dbUpsert`).

Pengujian yang sudah dilakukan: `next build` lolos tanpa error, ESLint bersih, dan 17 uji SQL di Postgres sungguhan (PGlite) lulus. Uji itu mencakup skema yang bisa dijalankan dua kali, simpan lalu baca data, timpa data, semua query bot Telegram, penolakan injeksi SQL, dan payload ±1 MB. Yang belum bisa saya uji dari sini adalah koneksi ke akun Neon dan Vercel Anda. Karena itu langkah verifikasi di bagian E wajib dijalankan.

---

## A. Persiapan di komputer

Zip ini sudah proyek lengkap (LTS, HSI, WMS, Metabright, portal, login, migration) dengan patch Neon sudah tergabung, dan `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.pnpm-store` sudah dihapus. Tidak perlu menimpa apa pun.

1. Ekstrak zip ke folder baru.
2. Pastikan tidak ada `pnpm-lock.yaml`, `pnpm-workspace.yaml`, maupun folder `.pnpm-store`.
3. Pasang dependensi dan cek build lokal:
   ```
   npm install
   npm run build
   ```
   Build harus selesai tanpa error. Tanpa `DATABASE_URL` pun build tetap lolos, karena database hanya dipakai saat aplikasi berjalan.

---

## B. Buat database Neon

1. Buka https://neon.com lalu daftar atau login.
2. **Create project**. Isi nama bebas (misal `dashboard-prq`).
   - **Region:** pilih **AWS Asia Pacific (Singapore)**. Ini yang terdekat dengan Anda dan menghemat waktu respons.
   - Versi Postgres: biarkan default.
3. Setelah project jadi, klik **Connect**. Pada pilihan connection string:
   - Nyalakan **Connection pooling** (host berisi `-pooler`).
   - Salin string yang bentuknya:
     `postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   - Simpan di tempat aman. String ini berisi password, jangan dibagikan atau di-commit.
4. **Buat tabel** (cukup sekali). Pilih salah satu cara:
   - **Cara 1 (paling mudah):** di Neon buka **SQL Editor**, tempel seluruh isi `neon/schema.sql`, lalu klik **Run**.
   - **Cara 2:** buat file `.env.local` di folder proyek berisi `DATABASE_URL=...` (salin dari `env.example`), lalu jalankan `npm run db:setup`. Semua baris harus berstatus `OK`.
5. Cek: di Neon buka **Tables**, harus ada enam tabel: `dashboard_state`, `legacy_storage_backups`, `legacy_storage_entries`, `reporting_imports`, `dashboard_records`, `migration_logs`. Skema ini aman dijalankan berulang kali.

---

## C. Upload kode ke GitHub

1. Pastikan `.env`, `.env.local`, dan `node_modules` **tidak** ikut. File `.gitignore` sudah mengaturnya.
2. Dari folder proyek:
   ```
   git init
   git add .
   git commit -m "Dashboard PRQ - Neon"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```
3. Cek di GitHub: tidak ada folder `.pnpm-store`, tidak ada `.env`, dan tidak ada `pnpm-lock.yaml`.

---

## D. Buat project di Vercel

1. Buka https://vercel.com lalu login (paling mudah dengan akun GitHub).
2. **Add New > Project**, pilih repo tadi, lalu **Import**.
3. Pada halaman konfigurasi:
   - **Framework Preset:** Next.js (terdeteksi otomatis).
   - **Build Command, Output Directory, Install Command:** biarkan default (jangan diubah).
   - **Root Directory:** `./` (kecuali repo Anda menaruh proyek di subfolder).
4. Buka **Environment Variables** dan isi sebelum menekan Deploy:

| Nama | Wajib? | Isi |
|---|---|---|
| `DATABASE_URL` | Ya | Connection string Neon dari langkah B.3 |
| `DASHBOARD_USERNAME` | Ya | Username untuk login |
| `DASHBOARD_PASSWORD` | Ya | Password login (kuat) |
| `DASHBOARD_SESSION_SECRET` | Ya | String acak minimal 32 karakter (lihat cara membuatnya di bawah) |
| `MASTER_ACCESS_PASSWORD` | Ya | Password menu Master (upload data). **Jangan dikosongkan**: bawaan kode adalah `123456` |
| `DASHBOARD_USER_ROLE` | Tidak | `PRQ_INTERNAL` (default, bisa buka Master) atau `VIEWER` (hanya lihat) |
| `NEXT_PUBLIC_APP_URL` | Tidak | `https://domain-anda.vercel.app` (dipakai link bot Telegram; nilainya ikut tertanam saat build) |
| `TELEGRAM_BOT_TOKEN` | Hanya jika pakai bot | Token dari BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Hanya jika pakai bot | String bebas, huruf/angka/`_`/`-` |

   Cara membuat `DASHBOARD_SESSION_SECRET`:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Centang **Production**, **Preview**, dan **Development** untuk setiap variabel, lalu **Save**.

5. Klik **Deploy** dan tunggu sampai berstatus **Ready**.
6. Setelah selesai, buka **Settings > General > Node.js Version** dan pastikan **22.x**. Proyek ini mensyaratkan Node 22.13 atau lebih baru.
7. Buka **Settings > Functions > Function Region** dan pilih **Singapore (sin1)** agar sedekat database Neon. Perubahan region baru berlaku pada deploy berikutnya (**Deployments > titik tiga > Redeploy**).

> **Penting:** perubahan Environment Variables hanya berlaku untuk deployment **baru**. Setelah menambah atau mengubah variabel, selalu **Redeploy**.

---

## E. Verifikasi setelah deploy (wajib dijalankan berurutan)

1. Buka URL Vercel. Harus diarahkan ke halaman **/login**.
2. Login dengan `DASHBOARD_USERNAME` dan `DASHBOARD_PASSWORD`. Harus masuk ke **/portal**.
3. Buka dashboard **LTS**. Karena belum ada upload, yang tampil adalah data bawaan (seed).
4. Buka menu **Master**, masukkan `MASTER_ACCESS_PASSWORD`, lalu upload tiga CSV (Sales/PS, CAPS/NAL, CT0/REG).
5. Lihat status simpan di bagian atas halaman LTS. Harus **tidak** muncul tulisan "database server belum dikonfigurasi" atau "sync server gagal".
6. Cek di Neon: **Tables > dashboard_state**. Harus ada satu baris dengan `key = lts` dan kolom `updated_at` terbaru.
7. Refresh halaman. Angka tidak boleh berubah dari yang Anda upload.

Jika langkah 5 atau 6 gagal, lihat bagian G.

---

## F. Bot Telegram (opsional)

1. Pastikan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET` sudah diisi di Vercel dan sudah Redeploy.
2. Daftarkan webhook dengan membuka URL ini di browser (ganti tiga nilai):
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://DOMAIN-ANDA/api/telegram/webhook&secret_token=<SECRET>
   ```
   `<SECRET>` harus sama persis dengan `TELEGRAM_WEBHOOK_SECRET`. Hasil yang benar: `{"ok":true,"result":true,...}`.
3. Cek: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`. Kolom `last_error_message` harus kosong.

---

## G. Jika ada error

| Gejala | Penyebab | Solusi |
|---|---|---|
| Build gagal: `npm ci ... not in sync` | `package-lock.json` lama | Pakai `package-lock.json` dari patch ini |
| Build gagal soal pnpm / `allowBuilds` | `pnpm-lock.yaml` / `pnpm-workspace.yaml` masih ada | Hapus keduanya lalu push ulang |
| Login selalu gagal | `DASHBOARD_USERNAME` atau `DASHBOARD_PASSWORD` belum diisi, atau belum Redeploy | Isi variabelnya lalu Redeploy |
| Setiap beberapa saat harus login ulang | `DASHBOARD_SESSION_SECRET` berubah-ubah atau kosong | Isi dengan nilai tetap |
| "Database Neon belum dikonfigurasi" (503) | `DATABASE_URL` kosong atau belum Redeploy | Isi `DATABASE_URL` lalu Redeploy |
| `relation "dashboard_state" does not exist` | Tabel belum dibuat | Jalankan `neon/schema.sql` (langkah B.4) |
| `password authentication failed` / `SSL` | Connection string salah atau terpotong | Salin ulang dari Neon, harus berakhiran `?sslmode=require` |
| Permintaan pertama lambat lalu normal | Neon (paket gratis) tidur saat lama tidak dipakai | Wajar; tunggu beberapa detik |
| Upload master gagal dengan `413` / `FUNCTION_PAYLOAD_TOO_LARGE` | Vercel membatasi body request dan response sekitar 4,5 MB | Lihat bagian H |
| Telegram `500: Telegram env belum lengkap` | Token atau secret belum diisi | Isi keduanya lalu Redeploy |
| Telegram `401 Unauthorized` | `secret_token` di setWebhook tidak sama dengan env | Daftarkan ulang webhook dengan secret yang sama |
| Cek log | | Vercel > project > **Logs**; Neon > **Monitoring** |

---

## Catatan modul

- **HSI** memakai `/api/dashboard-state` (key `default`), **WMS** memakai `/api/wms/dashboard-state` (key `wms`), **LTS** memakai `/api/lts/dashboard-state` (key `lts`). Ketiganya sudah lewat Neon karena memakai `features/shared/backend/database/db.ts`.
- **Metabright** tidak punya penyimpanan server; datanya dari `features/metabright/data/default.json` dan diproses di browser, jadi tidak butuh tabel Neon.
- Batas 4,5 MB di bagian H berlaku juga untuk HSI dan WMS, bukan hanya LTS.

---

## H. Batasan dan keputusan yang masih terbuka

1. **Batas ukuran 4,5 MB per request/response di Vercel.** Satu bulan data LTS di server kira-kira 1 MB. Setelah sekitar 4 periode tersimpan, simpan atau muat data dari server bisa gagal dengan error 413. Solusinya: hapus periode lama dari arsip, atau minta saya buat pembatasan otomatis (hanya N periode terbaru yang disimpan di server).
2. **Data di server belum dibaca saat halaman dibuka.** Kode saat ini menyimpan data ke Neon saat master meng-upload, tetapi saat dashboard dibuka, permintaan baca ke server ditolak (401) karena server meminta token Master, sedangkan token itu hanya ada di memori setelah Master dibuka. Akibatnya:
   - data hasil upload terlihat di browser tempat Anda upload (tersimpan di browser),
   - di browser atau perangkat lain, dashboard menampilkan data bawaan (seed), bukan data terbaru dari Neon.

   Ini bukan masalah Neon. Ini perilaku akses di `app/api/lts/dashboard-state/route.ts`. Perbaikannya perlu keputusan keamanan dari Anda: mengizinkan semua pengguna yang sudah login membaca data (metode GET) berarti pengguna VIEWER juga bisa membaca data master mentah lewat API itu. Saya belum mengubahnya tanpa persetujuan Anda.
3. **Ganti semua password bawaan** sebelum dipakai orang lain, terutama `MASTER_ACCESS_PASSWORD`.
