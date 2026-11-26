# Deployment Guide — Staging and Production

Dokumen ini adalah runbook operator untuk staging dan production. Push ke `staging` atau `main`
menjalankan release gate lalu memanggil reusable deployment workflow untuk environment masing-masing.
Production hanya dapat berhasil setelah VPS, GitHub environment, dan tiga domain siap.

## 1. Topologi dan Batas Risiko

Satu VM Ubuntu 22.04 LTS menjalankan satu Compose project bernama
`supplier-henkaten-staging`:

- Caddy adalah satu-satunya service yang membuka host port `80` dan `443`;
- supplier web, TMMIN web, dan API hanya berada pada network Compose;
- PostgreSQL hanya berada pada internal data network dan tidak memiliki published port;
- data PostgreSQL, foto member, state Caddy, dan state deployment berada di
  `/opt/supplier-henkaten/staging/shared`;
- source dan runtime env per SHA berada di `/opt/supplier-henkaten/staging/releases`.

**Critical accepted risk:** v1 tidak memiliki backup, PITR, disaster recovery, replica, failover,
RPO/RTO, atau high availability. Kehilangan VM/disk/volume dapat menghilangkan database dan foto
secara permanen. Code rollback bukan database restore.

## 2. DNS

Buat tiga record DNS yang menunjuk ke public IP VM yang sama:

| Record | Target |
| --- | --- |
| `supplier-henkaten.qd-tmmin.site` | public IP VM staging |
| `henkaten.qd-tmmin.site` | public IP VM staging |
| `supplier-henkaten-api.qd-tmmin.site` | public IP VM staging |

Sebelum deployment, verifikasi dari jaringan publik:

```bash
dig +short supplier-henkaten.qd-tmmin.site
dig +short henkaten.qd-tmmin.site
dig +short supplier-henkaten-api.qd-tmmin.site
```

Ketiganya harus beririsan dengan address yang dihasilkan `VM_HOST`. Port TCP 80/443 harus dapat
diakses agar Caddy memperoleh sertifikat. Jika VM/provider mempunyai firewall selain UFW, buka
SSH, TCP 80, TCP 443, dan UDP 443 di sana juga.

## 3. SSH Key Deployment

Buat key khusus CI pada workstation operator. Jangan memakai key personal:

```bash
ssh-keygen -t ed25519 -a 100 -f ./supplier-henkaten-staging-ci -C supplier-henkaten-staging-ci
```

- Isi private key lengkap menjadi secret `VM_SSH_PRIVATE_KEY`.
- Public key `supplier-henkaten-staging-ci.pub` diberikan ke bootstrap.
- Simpan salinan private key di password manager operator; jangan commit ke repository.

Setelah bootstrap, ambil host key melalui jaringan yang dipercaya:

```bash
ssh-keyscan -p 22 -H VM_HOST > supplier-henkaten-staging-known-hosts
ssh-keygen -lf supplier-henkaten-staging-known-hosts
```

Bandingkan fingerprint dengan console/provider VM sebelum mengisi
`VM_SSH_KNOWN_HOSTS`. Jangan mengambil keyscan secara dinamis di workflow karena itu menghilangkan
perlindungan host identity.

## 4. Bootstrap VM

Requirement:

- VM baru dengan **Ubuntu 22.04 LTS**;
- akses awal `root`/`sudo` melalui console atau key provider;
- minimum 5 GiB free disk saat preflight; sediakan disk lebih besar untuk image dan data aktual;
- public key deploy dari langkah sebelumnya;
- port SSH final sudah dipilih.

Kirim script melalui akses awal VM:

```bash
scp deploy/scripts/bootstrap-vm.sh ubuntu@VM_HOST:/tmp/bootstrap-vm.sh
ssh ubuntu@VM_HOST
```

Validasi input dan OS dahulu, lalu jalankan bootstrap. Ganti contoh user/key/port dengan nilai
aktual:

```bash
bash /tmp/bootstrap-vm.sh --check staging henkaten-deploy \
  "ssh-ed25519 AAAA... supplier-henkaten-staging-ci" 22

sudo bash /tmp/bootstrap-vm.sh staging henkaten-deploy \
  "ssh-ed25519 AAAA... supplier-henkaten-staging-ci" 22
```

Script idempotent tersebut:

- memasang Docker Engine, Buildx, dan Compose plugin dari repository resmi Docker;
- membuat deploy user serta `authorized_keys`;
- menambahkan user ke group Docker dan data aplikasi GID 2000;
- membuat seluruh shared/release/state path;
- mengaktifkan UFW untuk port SSH yang dipilih, HTTP, dan HTTPS.

Putuskan sesi lalu login ulang agar membership group berlaku:

```bash
ssh -i ./supplier-henkaten-staging-ci -p 22 henkaten-deploy@VM_HOST
docker version
docker compose version
test -w /opt/supplier-henkaten/staging
```

Untuk VM production yang terpisah, jalankan script yang sama dengan argumen `production`. Script
membuat `/opt/supplier-henkaten/production`; jangan memakai shared path staging pada VM production.

## Production preparation

Production memakai Supplier `henkaten.qualitydivision.com`, Admin/Quality
`admin-henkaten.qualitydivision.com`, dan API `henkaten-api.qualitydivision.com`. Ketiga DNS A
record harus mengarah ke VM production. GitHub Environment bernama `production` menyimpan secret
yang sama namanya dengan staging. `VM_HOST` dan `VM_SSH_KNOWN_HOSTS` harus menunjuk ke VM
production; key CI boleh sama seperti staging. Pin known host hanya setelah fingerprint dibandingkan
dengan console/provider VM. `VM_USER` dan variable `VM_SSH_PORT` mengikuti endpoint production.

Push ke `main` menjalankan seluruh CI/security release gate dan otomatis deploy jika semuanya
lulus. PR ke `main` hanya menjalankan gate. Pastikan port TCP 80/443 dan UDP 443 terbuka pada UFW
dan firewall provider sebelum merge agar Caddy memperoleh TLS. Setelah merge, cocokkan SHA pada
`/release.json` kedua frontend dan `/ready` API, lalu jalankan `deploy/scripts/smoke-check.sh`
untuk tiga URL production. Lihat [production deployment plan](productionDeploymentPlan.md) untuk
kapasitas, status kesiapan, dan urutan verifikasi.

## 5. GitHub Environment

Di repository GitHub buka **Settings → Environments → New environment**, buat environment bernama
tepat `staging`.

Tambahkan environment secrets berikut:

| Secret | Isi |
| --- | --- |
| `VM_HOST` | hostname atau IPv4 VM, tanpa scheme/port |
| `VM_USER` | deploy user, contoh `henkaten-deploy` |
| `VM_SSH_PRIVATE_KEY` | private key OpenSSH lengkap |
| `VM_SSH_KNOWN_HOSTS` | seluruh output keyscan yang fingerprint-nya telah diverifikasi |
| `CADDY_EMAIL` | email valid untuk ACME |
| `POSTGRES_USER` | identifier aman, contoh `supplier_henkaten` |
| `POSTGRES_PASSWORD` | random minimum 32 karakter |
| `POSTGRES_DATABASE` | identifier aman, contoh `supplier_henkaten` |
| `SESSION_CSRF_SECRET` | random minimum 32 karakter, berbeda dari secret lain |
| `AUTH_THROTTLE_SECRET` | random minimum 32 karakter, berbeda dari secret lain |
| `TMMIN_BOOTSTRAP_USERNAME` | username protected bootstrap administrator |
| `TMMIN_BOOTSTRAP_PASSWORD` | password sementara minimum 12 karakter |

Secret opsional untuk role database runtime least-privilege (ADR 0057):

| Secret | Isi |
| --- | --- |
| `POSTGRES_APP_USER` | opsional; identifier role runtime non-superuser (`^[a-z_][a-z0-9_]{0,62}$`), wajib berbeda dari `POSTGRES_USER`. Bila kosong, diturunkan menjadi `<POSTGRES_USER>_app` (contoh `supplier_henkaten_app`). |
| `POSTGRES_APP_PASSWORD` | opsional; 32–128 karakter aman. Bila kosong, render runtime env menurunkan password satu arah HMAC-SHA256 dari `POSTGRES_PASSWORD` + env/user/database (mode staged zero-touch, tercetak sebagai warning di log deploy). |

Container `api` dan `bootstrap-admin` hanya menerima `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD`;
hanya `migrate` yang memakai `POSTGRES_USER`/`POSTGRES_PASSWORD` (owner schema). Karena password
turunan bergantung pada `POSTGRES_PASSWORD`, **mengganti `POSTGRES_PASSWORD` juga mengganti password
role runtime** selama `POSTGRES_APP_PASSWORD` belum diisi. Beralih dari password turunan ke secret
independen mengikuti koreografi rotasi pada bagian 11.

Untuk seluruh password/secret dotenv, gunakan hanya `A-Z`, `a-z`, `0-9`, `_`, dan `-`. Generator
yang sesuai:

```bash
openssl rand -base64 48 | tr '+/' '_-' | tr -d '=\n' | cut -c1-48
```

Tambahkan environment variables:

| Variable | Isi |
| --- | --- |
| `VM_SSH_PORT` | port SSH, biasanya `22` |
| `TMMIN_BOOTSTRAP_DISPLAY_NAME` | display name, contoh `TMMIN Bootstrap Admin` |

Domain staging, Compose project, dan remote base path tidak menjadi GitHub variable/secret. Nilai
tersebut dikunci di workflow agar tidak drift.

Rekomendasi branch protection untuk `staging`:

- require pull request;
- require branch to be up to date;
- require status check **Release candidate gate**;
- block force push dan branch deletion;
- jangan menambahkan deployment environment reviewer/manual approval karena kontrak staging adalah
  otomatis setelah gate.

## 6. Trigger dan First Deployment

Pull request ke `staging` menjalankan semua quality, integration, E2E, migration, container,
workflow/script, dan security gate tetapi tidak deploy. Hanya event `push` pada branch `staging`
yang dapat memanggil reusable deployment workflow.

Gunakan squash merge agar satu commit menjadi satu release candidate:

```bash
git switch staging
git pull --ff-only
```

Pantau **Actions → Staging CI**. Urutan penting:

1. seluruh job kandidat harus hijau;
2. `Release candidate gate` harus sukses;
3. `Deploy staging` membuat GitHub deployment untuk environment `staging`;
4. remote preflight memvalidasi OS, versi Docker, disk, permission, Compose, DNS, archive checksum,
   dan exposure policy;
5. image dibangun, PostgreSQL dihidupkan, forward migration dijalankan, bootstrap admin dijalankan
   secara idempotent, lalu API/web/Caddy dimulai berurutan;
6. tiga public surface harus mengembalikan SHA candidate sebelum pointer `current` diaktifkan.

First deployment dapat memerlukan waktu lebih lama karena image dan dependency belum ada di cache.
Keberhasilan workflow berarti exact SHA telah lolos smoke dari VM dan dari GitHub runner.

## 7. Verifikasi Setelah Deploy

Set `SHA` ke commit hasil squash:

```bash
SHA=0123456789abcdef0123456789abcdef01234567

curl -fsS https://supplier-henkaten-api.qd-tmmin.site/ready | jq
curl -fsS https://supplier-henkaten-api.qd-tmmin.site/health | jq
curl -fsS https://supplier-henkaten.qd-tmmin.site/release.json | jq
curl -fsS https://henkaten.qd-tmmin.site/release.json | jq

deploy/scripts/smoke-check.sh "$SHA" \
  https://supplier-henkaten.qd-tmmin.site \
  https://henkaten.qd-tmmin.site \
  https://supplier-henkaten-api.qd-tmmin.site
```

Verifikasi juga:

- deep link SPA kembali ke aplikasi, bukan 404;
- `/api/*` pada kedua frontend domain sampai ke API secara same-origin;
- SSE bekerja melalui proxy;
- HSTS, CSP, anti-framing, `nosniff`, referrer policy, dan permissions policy hadir;
- seluruh runtime container tidak berjalan sebagai UID 0;
- tidak ada host port PostgreSQL.

Login pertama memakai `TMMIN_BOOTSTRAP_USERNAME` dan password sementara. Segera selesaikan mandatory
password change melalui aplikasi. Mengubah secret bootstrap setelah akun dibuat tidak merotasi akun;
job bootstrap berikutnya sengaja no-op.

## 8. Release, Race Control, dan Retention

Setiap candidate berasal dari exact `git archive` SHA dan checksum SHA-256. Race dikendalikan di
empat lapis:

- concurrency GitHub tidak membatalkan deployment aktif; candidate pending yang lebih lama dapat
  digantikan candidate terbaru;
- SHA diperiksa saat job dimulai dan diperiksa lagi tepat sebelum koneksi SSH; keduanya harus masih
  menjadi head `staging`;
- satu remote `flock` mencakup seluruh critical section deploy/rollback;
- remote high-water GitHub run number menolak run lama yang tiba terlambat.

`current` dan `current_release` hanya diganti setelah public smoke sukses. Lima release disimpan,
termasuk current dan previous release; image dari release yang dibuang dihapus berdasarkan exact
tag. Shared PostgreSQL, foto, dan Caddy path tidak pernah dipruning oleh script.

Untuk membuktikan ordering, merge dua candidate berdekatan. Hasil akhir harus selalu SHA head
`staging`; run lama boleh tercatat sebagai superseded, bukan mengaktifkan SHA lama.

## 9. Rollback dan Rehearsal

Rollback hanya menghidupkan code/image dan env dari release lama. Ia tidak menjalankan down
migration, tidak menghapus volume, dan tidak mengembalikan schema/data. Semua rollback (manual,
automatic, dan rehearsal) berjalan lewat **driver rollback hardened bersama** dan selalu fail closed:
bila sesuatu tidak bisa diverifikasi, service aplikasi dihentikan dan PostgreSQL dipertahankan, bukan
menyalakan image yang tidak terverifikasi.

### 9.1 State deployment yang relevan

| Path | Arti |
| --- | --- |
| `releases/<sha>/.activated` | Bukti rilis pernah aktif (wajib untuk target rollback hardened). |
| `releases/<sha>/.activated-images` | Manifest pin lima image (`postgres`, `api`, `supplier-web`, `tmmin-web`, `caddy`) berisi image ID immutable yang dicatat saat aktivasi. |
| `releases/<sha>/.rollback-unsafe` | Penanda bahwa baseline rilis tidak bisa diverifikasi; rollback ke rilis ini ditolak bila tanpa pin. |
| `current`, `current_release` | Symlink dan pointer rilis aktif; selalu dipublikasikan dengan rename tepat setelah smoke sukses. |
| `shared/deployment-state/rollback-driver` | Symlink ke bundle driver strict yang dipublikasikan deploy terakhir. |
| `shared/deployment-state/rollback-driver.v.*` | Bundle driver berversi (`lib.sh`, `validate-runtime-env.sh`, `remote-rollback.sh`) dengan marker `.driver-contract` = `strict-five-image-pins-v2`. |
| `shared/deployment-state/rollback-driver.good` | Symlink ke bundle strict milik deploy terakhir yang **berhasil diaktifkan** (tidak ada sebelum aktivasi hardened pertama). |
| `shared/deployment-state/rollback-driver.legacy.*` | Driver pra-versioning yang dikarantina. **Non-strict — jangan pernah dijalankan.** |
| `shared/deployment-state/failclosed.log` | Output `compose stop` dari jalur fail-closed (tetap tertulis walau sesi SSH putus). |

### 9.2 Rollback manual

Hanya ke SHA yang masih retained dan memiliki pin terverifikasi:

```bash
ssh -p 22 henkaten-deploy@VM_HOST
DRIVER=/opt/supplier-henkaten/staging/shared/deployment-state/rollback-driver
# Jalankan HANYA bila driver adalah bundle strict (marker kontrak cocok); jika tidak, berhenti.
[[ -L "$DRIVER" && "$(cat "$DRIVER/.driver-contract" 2>/dev/null)" == strict-five-image-pins-v2 ]] &&
  "$DRIVER/remote-rollback.sh" staging PREVIOUS_40_CHARACTER_SHA /opt/supplier-henkaten/staging
```

Urutan kerja driver:

1. Mengambil deploy lock dan memvalidasi `.runtime.env`, `.source.sha`, `APP_ENV`/`RELEASE_SHA`.
2. Menolak (exit `4`, tanpa mengubah service apa pun) bila: rilis hardened tanpa `.activated`;
   `.activated-images`/`.rollback-unsafe` bukan file reguler; manifest tidak lengkap, image ID pin
   tidak ada secara lokal, atau retag gagal diverifikasi; target ditandai `.rollback-unsafe` tanpa
   pin; target tidak punya pin sama sekali; `current_release`/`.activated` berupa direktori atau
   `current` bukan symlink.
3. Menghentikan Caddy (ingress) lebih dulu, lalu menyalakan PostgreSQL, API, dan frontend dari image
   yang di-pin, dan baru menyalakan Caddy lagi setelah semuanya sehat; lalu menjalankan smoke check.
4. Mempublikasikan `.activated`, `current`, dan `current_release`.

Bila langkah 3–4 gagal atau diinterupsi, driver menghentikan Caddy dan service aplikasi
(PostgreSQL dipertahankan) dan keluar dengan status `1`. `current_release` tetap menunjuk rilis
sebelumnya; jalankan driver lagi untuk rilis dengan pin terverifikasi (biasanya yang tertulis di
`current_release`).

### 9.3 Automatic recovery saat deploy gagal

- Sebelum build, deploy memasang bundle driver strict baru dari candidate (belum menyentuh `.good`).
- Bila candidate gagal setelah service berubah, recovery hanya dicoba bila tag image pra-build terbukti
  dipulihkan dan rilis sebelumnya punya snapshot pin lengkap; jika tidak, service aplikasi dihentikan.
- Recovery memakai driver bersama milik candidate, **tidak pernah** script milik rilis target.
- Bila driver candidate hilang, non-strict, atau gagal karena alasan selain penolakan kebijakan
  (exit `4`), deploy mencoba ulang **sekali** dengan `rollback-driver.good`, tetapi hanya bila bundle
  itu strict dan setelah memverifikasi ulang kelima pin target. Penolakan kebijakan (exit `4`) bersifat
  final.
- Setelah driver melapor sukses, deploy memverifikasi sendiri bahwa `current_release` menunjuk target
  dan setiap service menjalankan tepat satu container dengan image ID yang di-pin. Baru kemudian deploy
  mencetak `DEPLOY_RESULT=automatic-rollback-completed forced_smoke_failure=<bool> restored=<sha>` dan
  keluar dengan status `3`. Workflow tetap menganggap status non-zero sebagai gagal.
- Setelah deploy berhasil diaktifkan, bundle driver-nya dipromosikan menjadi `rollback-driver.good`
  dan bundle lain (termasuk driver legacy yang dikarantina) dipruning.

### 9.4 Target yang ditolak dan jalur pemulihan

Target tanpa manifest `.activated-images` lima image yang terverifikasi selalu ditolak — misalnya
rilis legacy lama yang tidak pernah menjadi `current` saat deploy hardened, baseline campuran
yang ditandai `.rollback-unsafe`, atau rilis hardened yang kehilangan `.activated-images`. Pipeline **tidak bisa** men-deploy ulang SHA lama (workflow hanya
men-deploy tip branch dan menolak SHA stale), jadi jalur pemulihan yang didukung adalah mengirim kode
yang diinginkan sebagai **commit baru** di branch deployment (misalnya `git revert` dari perubahan yang
bermasalah) sehingga pipeline membangun, mengaktifkan, dan mem-pin release baru tersebut.

Bila candidate membawa pemeriksaan pin yang rusak, driver candidate menolak dengan exit `4` dan
automatic recovery sengaja tidak mencoba ulang; pulihkan manual dengan
`/opt/supplier-henkaten/<env>/shared/deployment-state/rollback-driver.good/remote-rollback.sh`
(argumen sama dengan 9.2).

### 9.5 Deploy hardened pertama di atas rilis legacy (`db60208`)

Rilis legacy tidak punya pin. Sebelum build, deploy mem-backfill `.activated-images` rilis aktif dari
container yang sedang berjalan, dengan syarat setiap service punya **tepat satu** container yang
`Config.Image`-nya persis image reference rilis itu, dan `.Created`-nya (presisi nanodetik) **lebih
awal secara ketat** dari mtime `current_release`. Bila salah satu syarat gagal, rilis legacy ditandai
`.rollback-unsafe` sebelum build (deploy dibatalkan bila penanda pun tidak bisa ditulis), dan kegagalan
deploy pertama akan menghentikan service aplikasi tanpa automatic rollback.

Pemeriksaan waktu ini adalah heuristik khusus rilis legacy: ia mengandalkan `current_release` yang
tidak di-`touch`/di-restore manual dan jam host yang tidak mundur. Rilis hardened tidak bergantung
padanya karena pin dicatat saat aktivasi.

Batas ini ditegakkan oleh `release_is_hardened()` di `deploy/scripts/lib.sh`: sebuah rilis dianggap
hardened bila `.runtime.env`-nya memuat `POSTGRES_APP_USER` atau tree-nya memuat
`apps/api/src/cli/migrate.ts`. Bila rilis aktif yang hardened ternyata tidak punya `.activated-images`
(manifest hilang/terhapus), deploy **tidak pernah** mem-backfill pin dari container yang berjalan:

- redeploy SHA yang sama ditolak sebelum build
  (`legacy pin backfill is not permitted for hardened releases`);
- deploy SHA baru menandai rilis tersebut `.rollback-unsafe` sebelum build lalu melanjutkan; rilis itu
  tidak bisa menjadi target rollback dan pemulihannya mengikuti jalur commit baru pada 9.4.

**Risiko residual yang diterima:** bila deploy legacy pernah membangun ulang tag PostgreSQL bersama lalu
rollback legacy menyalakan PostgreSQL dari tag itu untuk SHA aplikasi yang lebih lama, backfill akan
mem-pin kombinasi yang memang sedang berjalan tersebut (tidak ada catatan image PostgreSQL independen
untuk rilis legacy).

**Pemeriksaan opsional (read-only) di VM production sebelum merge deploy hardened pertama ke `main`.**
Langkah 1–4 juga dijalankan otomatis oleh `remote-deploy.sh` sebelum build dan gagal tertutup ke
`.rollback-unsafe`; menjalankannya lebih dulu hanya memberi tahu sebelumnya apakah automatic rollback ke
`db60208` akan tersedia. Langkah 5 memperkirakan durasi lock index migration.

1. `stat -c '%.9Y' /opt/supplier-henkaten/production/current_release`
2. Untuk setiap service (`postgres api supplier-web tmmin-web caddy`):
   `docker ps -q --filter label=com.docker.compose.project=supplier-henkaten-production --filter label=com.docker.compose.service=<service>`
   harus mengembalikan **tepat satu** container.
3. `docker inspect --format '{{.Created}} {{.Config.Image}} {{.Image}}' <id>`; konversi `.Created` dengan
   `date -u -d '<created>' +%s.%N` dan pastikan nilainya lebih kecil (ketat) dari hasil langkah 1.
4. `Config.Image` harus persis `supplier-henkaten-postgres:18.4-pgvector-0.8.5` untuk postgres dan
   `supplier-henkaten-<service>:<SHA aktif>` untuk service aplikasi; bila riwayat rebuild/rollback legacy
   seperti di atas pernah terjadi, bandingkan juga `.Image` PostgreSQL dengan ekspektasi operator.
5. Ukuran `OutboxEvent` (migration `20261126002800_outbox_realtime_poll_index` memakai `CREATE INDEX`
   biasa yang menahan write ke tabel itu selama index dibangun, sementara API lama masih melayani):

   ```bash
   pg="$(docker ps -q --filter label=com.docker.compose.project=supplier-henkaten-production --filter label=com.docker.compose.service=postgres)"
   docker exec -i "$pg" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
   SELECT count(*), pg_size_pretty(pg_total_relation_size('"OutboxEvent"')) FROM "OutboxEvent";
   SQL
   ```

   Sampai ratusan ribu baris, build index selesai dalam hitungan detik atau kurang. Bila jauh lebih besar,
   merge pada jam sepi.

Seluruh pemeriksaan di atas read-only. Bila langkah 2–4 gagal, deploy pertama tetap berjalan (rilis
legacy ditandai `.rollback-unsafe` sebelum build), tetapi automatic rollback ke `db60208` tidak tersedia:
bila deploy itu gagal, service aplikasi dihentikan dan layanan mati sampai commit perbaikan ter-deploy.
Putuskan merge dengan kesadaran itu.

### 9.6 Driver bundle dan fallback operator

- Instalasi mengkarantina direktori driver pra-versioning (non-strict) sebagai `rollback-driver.legacy.*`
  **sebelum** men-stage bundle baru; driver itu tidak pernah dikembalikan ke path terdokumentasi.
- Bila staging atau publikasi symlink gagal (atau proses mati di jendela itu), `rollback-driver` tidak
  ada sampai deploy berikutnya. Gunakan `remote-rollback.sh` dari bundle `rollback-driver.v.*` terbaru
  yang `.driver-contract`-nya tepat `strict-five-image-pins-v2` (bundle yang sudah di-stage dipertahankan),
  atau `rollback-driver.good` bila ada. Bila tidak ada bundle strict, gunakan jalur commit baru (9.4).
- **Jangan pernah** menjalankan `rollback-driver.legacy.*` — driver itu dapat menyalakan rilis tanpa pin
  dari tag yang bisa berubah.

### 9.7 Interupsi dan kegagalan host

- Deploy dan rollback memasang trap yang dikunci pada flag "service sedang diganti": kegagalan,
  SIGTERM/SIGINT/SIGHUP, atau putusnya sesi SSH (runner CI dibatalkan) di jendela itu menghentikan Caddy
  dan service aplikasi (PostgreSQL dipertahankan). Output `compose stop` ditulis ke `failclosed.log`
  sehingga stop tetap selesai walau pipe output sudah tertutup; cleanup tidak bisa diinterupsi sinyal
  kedua.
- SIGKILL, OOM killer, atau mati listrik melewati semua trap. Karena service memakai
  `restart: unless-stopped`, set campuran yang sedang berjalan bisa hidup lagi setelah reboot. Setelah
  deploy/rollback yang terbunuh seperti itu, **segera jalankan driver (9.2) untuk rilis yang tertulis di
  `current_release`**.
- Deploy dan rollback menolak berjalan sebelum mengubah service bila `current_release` atau `.activated`
  berupa direktori atau `current` bukan symlink; perbaiki state tersebut lebih dulu.

### 9.8 Rehearsal staging

Sesudah minimal dua release sukses, rehearsal staging yang confirmation-gated:

```bash
/opt/supplier-henkaten/staging/current/deploy/scripts/rehearse-staging.sh \
  PREVIOUS_40_CHARACTER_SHA CURRENT_40_CHARACTER_SHA \
  /opt/supplier-henkaten/staging VM_HOST I_ACCEPT_STAGING_INTERRUPTION
```

Rehearsal memakai driver bersama untuk kedua rollback manual dan menolak berjalan bila driver itu belum
terpasang atau tidak strict. Ia mengganti code ke previous release, menjalankan current release dengan
forced smoke failure, lalu mengembalikan release terbaru, sambil memvalidasi identitas cluster PostgreSQL
dan sentinel foto. Karena rollback manual pertama sudah menghasilkan state pointer/sentinel yang
diharapkan, rehearsal hanya lulus bila `remote-deploy.sh` keluar dengan status `3` dan mencetak
`DEPLOY_RESULT=automatic-rollback-completed forced_smoke_failure=true restored=<PREVIOUS_SHA>`; kegagalan
lebih awal (preflight/build/migrate) membuat rehearsal gagal. Jalankan hanya dalam maintenance window
staging. Mekanisme `DEPLOY_FORCE_SMOKE_FAILURE` tetap internal pada controlled direct-VM rehearsal; jangan
menambahkan bypass/dispatch publik ke workflow.

### 9.9 Status keluar

| Script | Status | Arti |
| --- | --- | --- |
| `remote-deploy.sh` | `0` | Candidate aktif. |
| `remote-deploy.sh` | `3` | Candidate gagal; automatic recovery selesai dan terverifikasi. |
| `remote-deploy.sh` | `1` / lainnya | Gagal; service aplikasi candidate dihentikan bila sempat diubah. |
| `remote-rollback.sh` | `0` | Rollback selesai dan pointer dipublikasikan. |
| `remote-rollback.sh` | `4` | Penolakan kebijakan sebelum service apa pun diubah (final, tidak dicoba ulang). |
| `remote-rollback.sh` | `1` / lainnya | Gagal; bila service sempat diubah, Caddy dan service aplikasi dihentikan. |

## 10. Migration

- Hosted deployment menjalankan service `migrate` (`node dist/cli/migrate.js`) dengan
  `POSTGRES_USER` sebagai owner schema: pertama `prisma migrate deploy`, lalu provisioning idempotent
  role runtime `POSTGRES_APP_USER` (verifier SCRAM-SHA-256, grant per tabel/kolom, revoke `CREATE` pada
  schema `public`, verifikasi login non-superuser). `REQUIRE_APP_DB_ROLE=true` membuat deploy gagal
  bila provisioning gagal atau ada tabel immutable baru yang belum dikategorikan.
- Rollback menjalankan `migrate.js --provision-role-only` dari release target: grant direkonsiliasi
  tanpa migration, dan tabel immutable yang belum dikenal release lama dicabut seluruh aksesnya.
- Migration harus forward-only dan backward-compatible dengan setidaknya satu code release
  sebelumnya.
- CI menguji fresh database dan previous-SHA-to-current upgrade.
- SQL baru dengan `DROP TABLE/COLUMN/TYPE/SCHEMA/DATABASE`, `TRUNCATE`, reset, atau down behavior
  ditolak.
- Build/preflight failure tidak mengubah runtime aktif.
- Migration failure tidak mencoba down migration. Code lama dipulihkan bila tersedia, tetapi schema
  yang sudah berubah sebagian/selesai tetap tidak dipulihkan.
- Gunakan expand/contract lintas release untuk perubahan schema. Jangan mengandalkan rollback code
  untuk migration yang tidak backward-compatible.

Mengganti `POSTGRES_PASSWORD` di GitHub **tidak** merotasi password role PostgreSQL yang sudah ada;
official Postgres image hanya memakai value bootstrap pada cluster baru. Rotasi memerlukan
perubahan role terkoordinasi di database, GitHub secret, dan runtime env dengan rencana rollback.

## 11. Secret Rotation

- SSH key: tambahkan public key baru ke `authorized_keys`, verifikasi login, ganti dua SSH secrets,
  deploy, lalu hapus key lama.
- Session/CSRF dan throttle secret: ganti environment secret lalu deploy; rencanakan invalidasi
  session sesuai perilaku aplikasi.
- Bootstrap admin recovery: ubah bootstrap username/display/password secret, deploy agar env current
  memuat nilai baru, lalu jalankan:

  ```bash
  cd /opt/supplier-henkaten/staging/current
  docker compose --env-file .runtime.env \
    -f deploy/compose/docker-compose.remote.yml \
    --profile operations run --rm bootstrap-admin \
    node dist/cli/admin.js recover
  ```

  Recovery merotasi password protected administrator dan mencabut session aktif.
- Caddy email: ganti secret dan deploy; state certificate tetap berada di shared Caddy path.
- Database password: ikuti prosedur terkoordinasi pada bagian migration, bukan secret-only rotation.
  Ingat bahwa selama `POSTGRES_APP_PASSWORD` belum diisi, password role runtime diturunkan dari
  `POSTGRES_PASSWORD`, jadi rotasi superuser juga mengubah password runtime pada deploy berikutnya.
  Snapshot `.runtime.env` rilis lama tetap menyimpan `POSTGRES_PASSWORD` lama, sehingga rollback ke rilis
  sebelum rotasi akan gagal di `--provision-role-only` setelah Caddy dihentikan; rencanakan rotasi
  superuser sebagai perubahan yang memutus jalur rollback ke rilis sebelumnya.
- Role runtime (`POSTGRES_APP_PASSWORD`, termasuk beralih dari password turunan HMAC ke secret
  independen): `migrate` menjalankan `ALTER ROLE` sebelum `api` diganti, sehingga mengganti password
  role yang sama menimbulkan jeda autentikasi untuk `api` lama. Pilih salah satu:
  1. maintenance window singkat; atau
  2. switchover dua role: isi `POSTGRES_APP_USER` dengan nama role baru (contoh
     `supplier_henkaten_app_v2`) bersama `POSTGRES_APP_PASSWORD` independen, deploy (`api` lama tetap
     memakai role lama sampai diganti), lalu hapus role lama setelah tidak ada snapshot rollback yang
     mereferensikannya.

Jangan mencetak secret di terminal bersama, workflow log, issue, atau pull request.

## 12. Diagnostics

Login ke VM, lalu:

```bash
BASE=/opt/supplier-henkaten/staging
cd "$BASE/current"

cat "$BASE/current_release"
docker compose --env-file .runtime.env \
  -f deploy/compose/docker-compose.remote.yml ps

docker compose --env-file .runtime.env \
  -f deploy/compose/docker-compose.remote.yml logs --tail 200 api caddy

docker compose --env-file .runtime.env \
  -f deploy/compose/docker-compose.remote.yml logs --tail 200 postgres

df -h "$BASE"
sudo ufw status verbose
docker version
docker compose version
```

Jangan menampilkan atau mengirim `.runtime.env`. Untuk melihat deployment state tanpa secret:

```bash
ls -la /opt/supplier-henkaten/staging/releases
cat /opt/supplier-henkaten/staging/shared/deployment-state/highest_seen_run
readlink /opt/supplier-henkaten/staging/current
```

Common failures:

- **stale candidate:** head `staging` sudah berubah; biarkan candidate terbaru berjalan;
- **lock contention:** deployment/rollback lain aktif; jangan menghapus lock file, tunggu prosesnya;
- **DNS preflight:** perbaiki record/propagasi DNS atau `VM_HOST`;
- **ACME/TLS:** pastikan DNS benar dan port 80/443 publik;
- **disk preflight:** tambah disk atau bersihkan artefak non-shared dengan review operator; jangan
  hapus PostgreSQL/foto/Caddy state;
- **migration:** hentikan release, simpan log, dan review compatibility; jangan menjalankan reset
  atau down migration;
- **smoke/rollback failure:** runtime dianggap gagal walau schema mungkin sudah maju; inspect log
  API/Caddy/PostgreSQL dan current pointer sebelum tindakan berikutnya.

## 13. Acceptance Setelah Bootstrap

Phase 15.9 dan 15.11 baru dapat ditandai `done` setelah evidence berikut tersimpan:

1. first deployment exact SHA dan tiga HTTPS domain sukses;
2. protected bootstrap admin login dan password change/recovery terbukti;
3. release kedua membuktikan upgrade migration;
4. dua candidate berdekatan tidak menghasilkan out-of-order activation;
5. controlled failed smoke melakukan code rollback;
6. database dan foto bertahan setelah restart dan rollback;
7. GitHub environment deployment dan seluruh security/quality job hijau.

Caller `main` dan GitHub Environment `production` sudah disiapkan. Deployment production baru boleh
diklaim berhasil setelah semua prerequisite pada rencana production terpenuhi dan workflow push
`main` menunjukkan deploy serta smoke tiga domain hijau untuk SHA yang sama.
