# API Prediksi Suhu

API Node.js menyimpan pembacaan sensor di MySQL, menjalankan tahap 07 melalui
Python, lalu menyimpan hasil prediksi H+60, H+120, dan H+180.

Pada Arsitektur 2, folder ini digunakan sebagai backend Express di Vercel dengan
`ENABLE_LEGACY_ARCHITECTURE=false`. Dalam mode tersebut, Vercel hanya menerima
snapshot dari Node-RED dan melayani data untuk antarmuka; Vercel tidak mengakses
InfluxDB lokal dan tidak menjalankan Python/WSL.

## Persiapan

1. Buat database tujuan, pilih database tersebut pada koneksi MySQL, lalu jalankan `schema.sql`.
2. Pilih konfigurasi lokal development atau production seperti bagian berikut.
3. Dari folder `web_api`, jalankan `npm install`.
4. Pastikan paket `deployment_bundle` sudah dibuat oleh tahap 06.
5. Jalankan backend dengan perintah sesuai environment.

Untuk database lama yang sudah memiliki tabel lain, jalankan hanya
`migrations/001_edge_snapshot_receipts.sql` sebelum memakai endpoint snapshot.

## Deployment backend ke Vercel

Jadikan folder `web_api` sebagai **Root Directory** proyek Vercel. Entrypoint
`index.js` mengekspor aplikasi Express sebagai satu Vercel Function. Berkas
`vercel.json` mengunci build dan seluruh route ke entrypoint tersebut agar file
internal seperti `src/app.js` tidak dideteksi sebagai Function terpisah. Atur
environment variable berikut pada Vercel tanpa mengunggah berkas `.env`:

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, dan `MYSQL_DATABASE` dari Aiven.
- `MYSQL_SSL_CA` berisi CA certificate Aiven dalam format PEM.
- `MYSQL_CONNECTION_LIMIT=2`.
- `SNAPSHOT_INGEST_TOKEN` berupa token acak yang juga dipasang pada Node-RED.
- `ENABLE_LEGACY_ARCHITECTURE=false`.

Jalankan skema atau migrasi pada Aiven sebelum menguji `GET /health`. Berkas
`.vercelignore` mencegah `.env`, log lokal, dan test ikut diunggah.

## Dua environment lokal

Backend mendukung dua berkas konfigurasi yang tersimpan hanya di komputer lokal:

- `.env.development` untuk pengujian development, disarankan memakai database
  `skripsi_suhu_dev` dan token khusus development.
- `.env.production` untuk menguji konfigurasi production dari komputer lokal,
  memakai database `skripsi_suhu` dan token production.

Buat keduanya dari template tanpa memasukkan nilai rahasia ke Git:

```bash
cp .env.development.example .env.development
cp .env.production.example .env.production
```

Jalankan salah satu mode:

```bash
npm run start:dev
npm run start:prod
```

`npm run dev` menjalankan mode development dengan pemantauan perubahan berkas.
`npm start` menjalankan mode production. Berkas `schema.sql` tidak mengunci nama
database sehingga dapat diterapkan pada database yang dipilih oleh masing-masing
environment. Database `skripsi_suhu_dev` perlu dibuat dan diberi skema sebelum
mode development memakai database tersebut.

Pemisahan ini berlaku pada komputer lokal. Untuk deployment Vercel, salin nilai
yang sesuai dari `.env.production` ke Environment Variables proyek; jangan
unggah berkas `.env.production` ke repositori.

## Sinkronisasi InfluxDB ke MySQL

Isi `INFLUX_TOKEN` di `.env`, lalu uji satu kali dengan:

```bash
npm run sync:influx
```

Jika uji berhasil, ubah `INFLUX_SYNC_ENABLED=true` dan jalankan ulang API.
API akan mengambil rata-rata suhu dan kelembapan per 5 menit dari InfluxDB,
kemudian melakukan upsert ke `sensor_readings`. Query mengulang 10 menit
terakhir agar data yang datang terlambat dapat diperbarui tanpa membuat baris
duplikat. Rentang waktu pada hasil perintah ditampilkan dalam WIB dengan offset
`+07:00`. Query internal ke InfluxDB tetap memakai UTC sesuai penyimpanan waktu
InfluxDB.

TensorFlow tetap dijalankan oleh Python. Node.js menjadi pintu HTTP dan pengelola
MySQL. Pemisahan ini mempertahankan format model Keras hasil training.

### Arsitektur 1 di Mac — aktif sementara 13 Oktober 2026

Jalankan `npm run start:a1` untuk API loopback port3000. Entrypoint khusus ini
menjalankan siklus lima menit: InfluxDB → MySQL DBngin `skripsi_suhu_dev` → Python
native CPU → enam prediksi → MySQL. Siklus bertumpuk dilewati, kegagalan dicatat
untuk dicoba ulang, dan enam keluaran bundle/issue yang sama tidak ditambahkan lagi
oleh scheduler. Endpoint POST manual masih dapat menambahkan baris.

Bundle aktif `inference/model_42_hari_seed_1` memakai enam model seed1, scaler
normalisasi global, dari run `pc_42hari_20261011_174728`. PC CPU–Mac CPU lulus
pemeriksaan seluruh20.748 keluaran pada toleransi0,0001°C. Pemeriksaan GPU historis
tetap gagal dan dipertahankan. Model train-only baru belum dipasang.

Dashboard lokal: jalankan `npm run dev:a1` pada folder `web_frontend`, lalu buka
`http://localhost:5173`. Dashboard ini membaca API lokal dan memberi penanda A1;
konfigurasi produksi A2 tetap terpisah. MySQL dan jaringan privat harus tersedia,
dan layanan perlu dijalankan kembali setelah reboot. Lihat
[panduan inferensi Mac](inference/README.md) dan
[bukti pemasangan A1](../output/deployment_42hari_sementara_2026-10-13/README.md).

Pada Windows, konfigurasi bawaan proyek memakai `PREDICT_RUNTIME=wsl`. Node.js
memanggil `run_python_wsl.sh`, sehingga inferensi memakai environment TensorFlow
yang sama dengan training dan dapat mengakses GPU NVIDIA melalui WSL2.

## Endpoint

### `POST /api/readings`

```json
{
  "timestamp": "2026-09-18T08:00:00+07:00",
  "temperature": 26.5,
  "humidity": 51.2
}
```

### `POST /api/snapshots`

Menerima snapshot dari Node-RED setelah inferensi lokal selesai. Permintaan wajib
memakai header `Authorization: Bearer <SNAPSHOT_INGEST_TOKEN>`. Body memuat
`reading` terakhir dan respons Python API secara utuh pada properti `prediction`.
API memvalidasi keberadaan LSTM dan GRU untuk horizon 60, 120, dan 180 menit,
lalu menyimpan pembacaan serta enam prediksi dalam satu transaksi. ID snapshot
dibentuk secara deterministik dari sumber dan waktu observasi agar pengiriman
ulang tidak menggandakan data.

```json
{
  "source": "node-red-mini-pc",
  "reading": {
    "timestamp": "2026-09-29T10:00:00+07:00",
    "temperature": 26.8,
    "humidity": 55.2
  },
  "prediction": {
    "observed_at": "2026-09-29T10:00:00+07:00",
    "latest_temperature_celsius": 26.8,
    "threshold_celsius": 27,
    "models": {
      "LSTM": ["tiga objek prediksi dari Python API"],
      "GRU": ["tiga objek prediksi dari Python API"]
    },
    "bundle_status": { "LSTM": "...", "GRU": "..." },
    "verification_status": { "LSTM": "...", "GRU": "..." }
  }
}
```

### `POST /api/predictions`

Endpoint lama untuk Arsitektur 1. Endpoint ini mengambil data terbaru dari MySQL,
menjalankan prediksi dari sisi Node.js, dan menyimpan hasilnya. Endpoint ini tidak
dipakai pada alur Arsitektur 2.

### `GET /api/predictions/latest`

Mengambil prediksi tersimpan yang paling baru untuk setiap model dan horizon.

### `GET /health`

Memeriksa API dan koneksi MySQL.
