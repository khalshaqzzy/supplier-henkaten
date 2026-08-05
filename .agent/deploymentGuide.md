# Deployment Guide — Staging

Dokumen ini adalah runbook operator untuk Phase 15. Scope aktif hanya staging. Push ke `main`,
`workflow_dispatch`, dan deployment production sengaja tidak dikonfigurasi.

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

Jangan menjalankan bootstrap production; script saat ini sengaja menolak environment selain
`staging`.

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
migration, tidak menghapus volume, dan tidak mengembalikan schema/data.

Rollback operator ke SHA yang masih retained:

```bash
ssh -p 22 henkaten-deploy@VM_HOST
/opt/supplier-henkaten/staging/current/deploy/scripts/remote-rollback.sh \
  staging PREVIOUS_40_CHARACTER_SHA /opt/supplier-henkaten/staging
```

Sesudah minimal dua release sukses, rehearsal staging yang confirmation-gated:

```bash
/opt/supplier-henkaten/staging/current/deploy/scripts/rehearse-staging.sh \
  PREVIOUS_40_CHARACTER_SHA CURRENT_40_CHARACTER_SHA \
  /opt/supplier-henkaten/staging VM_HOST I_ACCEPT_STAGING_INTERRUPTION
```

Rehearsal mengganti code ke previous release, menjalankan current release dengan forced smoke
failure, membuktikan automatic rollback, memvalidasi identitas cluster PostgreSQL dan sentinel foto,
lalu mengembalikan release terbaru. Jalankan hanya dalam maintenance window staging. Mekanisme
`DEPLOY_FORCE_SMOKE_FAILURE` tetap internal pada controlled direct-VM rehearsal; jangan menambahkan
bypass/dispatch publik ke workflow.

## 10. Migration

- Hosted deployment hanya menjalankan `prisma migrate deploy`.
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

Reusable workflow sudah production-capable, tetapi activation production tetap deferred: tidak ada
trigger `main`, manual dispatch, production environment wiring, atau klaim deployment production.
