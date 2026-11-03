import { ApiProblemError } from '@tmmin-henkaten/api-client';
import { SETUP_SHEETS, type SetupIssue } from '@tmmin-henkaten/contracts';

/** Describe the rule and the correction, without echoing any imported cell values. */
export function memberImportIssue(issue: SetupIssue): SetupIssue {
  const column =
    SETUP_SHEETS.find((sheet) => sheet.name === 'Member')?.columns.find(
      (column) => column.key === issue.column || column.label === issue.column,
    )?.label ?? issue.column;
  const messages: Record<string, string> = {
    'Wajib diisi.': `Isi ${column.toLocaleLowerCase('id-ID')} pada baris ini.`,
    'Kolom wajib tidak ditemukan.': `Tambahkan kolom ${column} pada baris pertama. Gunakan judul dari template.`,
    'Header muncul lebih dari sekali.': `Judul kolom ${column} muncul lebih dari sekali. Sisakan satu kolom.`,
    'Pilih SUPERVISOR, LINE_LEADER, QC, MP.':
      'Role belum sesuai. Pilih SUPERVISOR, LINE_LEADER, QC atau MP seperti pada template.',
    'MP tidak menggunakan registrasi atau akun.':
      'Untuk MP, kosongkan Nomor registrasi, Username dan Password awal.',
    'Wajib untuk Supervisor, LL, dan QC.': `Isi ${column.toLocaleLowerCase('id-ID')} untuk Supervisor, Line Leader dan QC. Kosongkan hanya untuk MP.`,
    'Akun baru memerlukan password awal 12–128 karakter.':
      'Isi password awal sepanjang 12 sampai 128 karakter untuk akun baru ini.',
    'Gunakan 12–128 karakter.': 'Isi password awal sepanjang 12 sampai 128 karakter.',
    'Data yang dipilih tidak tersedia.':
      'Member yang dihubungkan tidak tersedia. Pilih kembali member lama yang sesuai atau periksa data ulang.',
    'Kode sudah digunakan data lain.':
      'Kode member sudah terikat ke orang lain. Gunakan kode milik member yang dipilih.',
    'Kode import existing tidak dapat diganti.':
      'Member ini sudah memiliki kode. Gunakan kode yang tersimpan; import tidak dapat menggantinya.',
    'Identitas existing sudah mempunyai kode berbeda.':
      'Member ini sudah memiliki kode berbeda. Gunakan kode yang tersimpan untuk orang tersebut.',
    'Registrasi dan username merujuk member berbeda.':
      'Nomor registrasi dan username merujuk dua member berbeda. Perbaiki keduanya agar merujuk orang yang sama.',
    'Dua baris merujuk data existing yang sama.':
      'Dua baris merujuk member yang sama. Sisakan satu baris untuk orang tersebut.',
    'Ubah role member existing melalui aksi Ubah role pada Member & Akun.':
      'Role berbeda dari data member saat ini. Gunakan role yang tersimpan; ubah jabatan melalui Ubah role pada Member & Akun.',
    'Nilai sudah digunakan data lain.': `${column} sudah digunakan member lain, termasuk member arsip. Gunakan identitas yang sesuai atau nilai lain untuk orang baru.`,
    'Username sudah digunakan akun supplier lain.':
      'Username sudah digunakan akun lain dalam supplier ini. Pilih username berbeda untuk member ini.',
    'Kapasitas aktif maksimal 300.':
      'Import ini membuat jumlah member aktif melebihi 300. Kurangi member baru atau arsipkan member yang tidak lagi digunakan.',
  };
  const duplicate = /^Duplikat dengan baris (\d+)\.$/.exec(issue.message);
  return {
    ...issue,
    column: duplicate ? 'Kode member' : column,
    message: duplicate
      ? `Kode member sama dengan baris ${duplicate[1]}. Sisakan satu baris per orang; gunakan kode berbeda untuk orang yang berbeda.`
      : (messages[issue.message] ?? issue.message),
  };
}

export function memberImportFailure(error: unknown): string {
  if (error instanceof ApiProblemError) {
    const { status, detail } = error.problem;
    if (status === 401) return 'Sesi Anda berakhir. Login kembali, lalu buka import Member & Akun.';
    if (status === 403)
      return 'Anda tidak memiliki akses untuk import member saat ini. Periksa akun dan akses supplier Anda.';
    if (status === 413)
      return 'Data import terlalu besar. Kurangi jumlah baris atau kolom, lalu upload kembali.';
    if (status === 429)
      return 'Terlalu banyak permintaan. Tunggu sebentar, lalu periksa data kembali.';
    if (status >= 500)
      return 'Server belum dapat memproses permintaan. Coba kembali setelah beberapa saat. Jika sedang menyimpan, gunakan Periksa hasil.';
    return detail;
  }
  return 'Koneksi ke server terputus atau respons belum dapat dibaca. Periksa koneksi, lalu coba kembali. Jika sedang menyimpan, gunakan Periksa hasil.';
}
