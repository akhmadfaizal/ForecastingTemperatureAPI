# Pengujian Postman API Production

Impor dua berkas berikut ke Postman:

1. `Skripsi API Production.postman_collection.json`
2. `Skripsi API Production.postman_environment.json`

Pilih environment **Skripsi API Production** di kanan atas. Buka environment,
kemudian isi `snapshot_ingest_token` dengan token production yang sama pada Vercel
dan Node-RED. Jangan menyimpan token ke collection, Git, vault, atau tangkapan layar.

Jalankan request secara berurutan:

1. **Health Vercel dan Aiven** mengharapkan HTTP 200.
2. **Enam prediksi terbaru** mengharapkan enam baris LSTM/GRU untuk horizon 60/120/180.
3. **Snapshot tanpa token ditolak** mengharapkan HTTP 401.
4. **Replay snapshot terbaru dengan token** mengambil data terbaru dari backend dan
   mengirim kembali `snapshot_id` yang sama. Hasil yang benar adalah HTTP 200,
   `duplicate: true`, dan `stored: false`, sehingga tidak menambah data penelitian palsu.

Request keempat tidak boleh dijalankan jika enam prediksi terbaru berasal dari waktu
observasi yang berbeda atau pembacaan pasangannya sudah tidak tersedia dalam 200 baris
terakhir. Pre-request script akan menghentikan pengujian pada kondisi tersebut.
