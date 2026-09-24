# Laporan uji inference Ling dan respons Cloudflare 1010

**Tanggal:** 23 September 2026
**Endpoint publik:** `https://inference.qd-tmmin.site/v1`
**Model:** `inclusionAI/Ling-3.0-tiny-fp8`

Pemeriksaan memakai key gateway yang berlaku di `dx-2` dan data laporan sintetis. Key tidak ditampilkan atau dimasukkan ke file laporan maupun source control. Hasil uji lintas klien di bawah berasal dari pengujian lanjutan yang diberikan pengguna; pemeriksaan baca saja sebelumnya juga mengonfirmasi gateway lokal 200 dengan key benar, 401 dengan key salah, dan respons Cloudflare 1010 pada `urllib`. Tidak ada file, key, service, atau konfigurasi `dx-2` yang diubah.

## Hasil uji

| Asal dan klien | `GET /v1/models` | `POST /v1/chat/completions` |
| --- | --- | --- |
| `dx-2`, `curl` | **200**, model Ling tersedia | **200**, satu tool call valid |
| Komputer lokal, `curl` | **200**, model Ling tersedia | **200**, satu tool call valid |
| Komputer lokal, OpenAI JavaScript SDK | **200**, model Ling tersedia | **200**, satu tool call valid |
| Komputer lokal, Python `urllib` | **403**, Cloudflare Error 1010 | **403**, Cloudflare Error 1010 |

POST yang berhasil memakai satu forced function `submit_care_classification`, `temperature: 1`, `top_p: 0.95`, `top_k: 20`, `max_tokens: 8192`, dan thinking aktif. Ketiganya menghasilkan `finish_reason: tool_calls` dengan tepat satu function bernama benar. Pada data sintetis CARE, hasilnya kategori `SAFETY`, severity `HIGH`, confidence `0.90–0.95`. Ini memvalidasi transport Chat Completions dan mekanisme forced tool call, **belum** isi prompt PCR atau eksekusi worker `supplier-henkaten`.

| Ray ID POST | Hasil |
| --- | --- |
| `dx-2` `curl`: `a3f6a86d5ada859a-HKG` | 200 |
| Lokal `curl`: `a3f6a94f6da68533-HKG` | 200 |
| Lokal OpenAI JavaScript SDK: `a3f6ab715ef602ae-HKG` | 200 |
| Lokal Python `urllib`: `a3f6aad98eca06e8-HKG` | 403/1010 |

Percobaan POST pertama di `dx-2` berhenti **sebelum** request dikirim karena versi `curl` di sana tidak mendukung `--json`. Pengulangan dengan `--data-binary` berhasil 200.

## Diagnosis

1. Ling, gateway, tunnel publik, dan Chat Completions berfungsi untuk klien `curl` dan OpenAI JavaScript SDK yang diuji. Karena aplikasi memakai OpenAI JavaScript SDK, 403 pada `urllib` saja tidak membuktikan bahwa worker aplikasi akan ditolak.
2. Respons **403/1010** berasal dari Cloudflare. [Dokumentasi Error 1010](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/) menyebut pemblokiran berdasarkan signature klien. Perbedaan respons antar-klien konsisten dengan itu, tetapi fitur atau rule spesifik belum diketahui tanpa Security Events.
3. Key pada konfigurasi CARE lokal berbeda dari key gateway saat ini: request `curl` dengan key lokal menghasilkan **401**, sedangkan key server yang berlaku menghasilkan **200**. Ini masalah konfigurasi terpisah dari 403/1010.
4. Setelah uji lintas klien, `.env` lokal `supplier-henkaten` diisi endpoint, model, dan key gateway yang berlaku; GitHub environment `staging` juga menerima tujuh secrets PCR. Nilai key tidak masuk source control. Worker PCR yang sebenarnya **belum diuji end-to-end** sesuai keputusan menghentikan investigasi inference. Host deployment lain juga dapat mempunyai IP atau kebijakan Cloudflare berbeda.

## Tindak lanjut untuk `supplier-henkaten`

Pada saat validasi inference end-to-end kembali dijadwalkan, jalankan satu assessment Henkaten sintetis melalui worker dan periksa keputusan, assessment, serta notifikasinya. Hasil 403 pada `urllib` sendiri tidak menjadi alasan untuk mengubah Cloudflare. Bila **worker aplikasi** mendapat 403, cari Ray ID request tersebut di [Cloudflare Security Events](https://developers.cloudflare.com/waf/analytics/security-events/) untuk menemukan fitur/rule pemblokir, lalu pertimbangkan pengecualian yang spesifik bagi trafik API yang sah sambil mempertahankan autentikasi gateway.
