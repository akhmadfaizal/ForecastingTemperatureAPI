# Inferensi lokal Arsitektur 1 di Mac

Node.js menjalankan `predict.py` sebagai proses Python native. Input dibaca dari
stdin dan hasil dikirim sebagai satu objek JSON melalui stdout. Pesan diagnostik
Python dan TensorFlow diarahkan ke stderr, termasuk pesan dari plugin native saat
proses berhenti. Tidak ada server HTTP Python yang dijalankan.

## Konfigurasi development saat ini

Kunci berikut berada pada `.env.development` di folder `web_api`:

```dotenv
ENABLE_LEGACY_ARCHITECTURE=true
PREDICT_RUNTIME=native
PYTHON_COMMAND=/Users/afi/Development/JupyterLab/.venv/bin/python
PREDICT_SCRIPT=inference/predict.py
MODEL_BUNDLE=inference/model_42_hari_seed_1
INFLUX_SYNC_ENABLED=true
```

Jalur skrip dan bundle diselesaikan relatif terhadap folder `web_api`. Gunakan
`npm run start:a1` untuk konfigurasi lokal ini. `npm start` memilih production.
Siklus A1 otomatis aktif setiap lima menit: sinkronisasi InfluxDB, inferensi native
dan penyimpanan enam keluaran. Dashboard memakai `npm run dev:a1` di `web_frontend`.
Kedua layanan terikat loopback; MySQL dan jaringan privat harus tetap tersedia.

## Status aktif train-only — 13 Oktober 2026

Bundle `model_train_only_42_hari_seed_1` memakai enam model seed1 dari run
`pc_train_only_20261013`, scaler `fit_on_train`, inferensi CPU.
Identitas keluaran `train_only42_20261013_s1`. PC CPU versus Mac CPU lulus pada
20.748 keluaran val/test, maksimum0,000003814697265625°C, toleransi0,0001°C.
Jalur CLI dan Node.js aktif serta siklus otomatis penyimpanan enam prediksi lulus.
Bukti `output/deployment_train_only_2026-10-13/`.

Bundle global lama `model_42_hari_seed_1` dipertahankan untuk rollback;
backup konfigurasi development di `inference/backups/sebelum_train_only_20261013/`.
Penggantian model ini tidak mengubah hasil pengukuran arsitektur historis menjadi
pengukuran model baru; naskah dan bukti pengukuran harus menyebut versi yang diuji.

## Riwayat model pilot (11 Oktober; sudah digantikan)

`pilot_mac/config/service.json` menunjuk dua bundle kandidat arsip September 2026.
Model tidak disalin atau dilatih ulang. Semua keluaran diberi status
`pilot_model_arsip`, bukan model final 42 hari atau hasil perbandingan arsitektur.
Status verifikasi historis Mini PC tidak dianggap sebagai verifikasi Mac baru.

`engine/runtime.py` dan `engine/common.py` disalin dari
`Arsip/Arsip Pipeline dan Training Awal/pipeline_training_kandidat_deployment/mini_pc_inference_api/app/`.
Runtime mempertahankan pemeriksaan checksum, scaler, interpolasi dan fitur waktu
yang sama dengan implementasi A2. Tidak mengimpor aplikasi FastAPI.

Penghubung mengubah DATETIME MySQL tanpa offset menjadi WIB sebelum pemrosesan.
Keluaran dua model digabung menjadi enam entri `predictions`, masing-masing
dengan `ensemble_size: 1`, untuk kontrak penyimpanan A1. Status tiap model dan
status verifikasi tetap disertakan pada JSON lengkap. Catatan pemeriksaan numerik
tersedia pada `web_api/logs/native-mac-pilot-verification.json` setelah uji pilot.

Pada pemeriksaan 11 Oktober 2026, enam keluaran berhasil diterima Node.js dan
normalisasi waktu MySQL/ISO konsisten. LSTM sesuai acuan Metal arsip (selisih
maksimum sekitar 0,000001 °C); GRU arsip berbeda sampai 1,32479 °C pada toleransi
0,00001 °C. Keberhasilan pemanggilan proses tidak menutup masalah portabilitas
numerik GRU atau membuktikan kesiapan model final.

## Pemakaian bundle berikutnya

`--bundle` menerima direktori yang memiliki `config/service.json`. Konfigurasi
memuat `timezone`, `output_status` (maksimal 30 karakter), serta kedua entri model
LSTM/GRU dengan lokasi bundle dan status verifikasinya. Masing-masing bundle
memuat manifest, checksum, scaler dan tiga model horizon 60/120/180 menit.
Lokasi bundle relatif terhadap direktori tersebut.

Bundle final dari training PC harus diekspor dan diuji kesesuaian format serta
keluarannya sebelum menggantikan konfigurasi pilot. Runtime ini memakai satu
model per horizon per jenis; strategi pemilihan model/seed final belum ditetapkan
oleh penyesuaian teknis ini.

Uji adaptor tanpa memuat model:

```bash
/Users/afi/Development/JupyterLab/.venv/bin/python -m unittest discover -s inference -p 'test_adapter.py' -v
```

Folder inferensi lokal dikecualikan dari deployment Vercel melalui
`.vercelignore`. Mode Arsitektur 2 production tetap menerima snapshot tanpa
menjalankan Python.
