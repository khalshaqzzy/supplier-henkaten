import ExcelJS from 'exceljs';
import {
  MEMBER_IMPORT_EXAMPLES,
  SETUP_SHEETS,
  SETUP_WORKBOOK_VERSION,
} from '@tmmin-henkaten/contracts';

export async function createMemberTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Supplier Henkaten';
  const guide = workbook.addWorksheet('Panduan', { views: [{ state: 'frozen', ySplit: 2 }] });
  guide.columns = [{ width: 28 }, { width: 108 }];
  const sections = new Set<number>();
  const section = (title: string) => {
    sections.add(guide.addRow([title, '']).number);
  };
  const entry = (label: string, text: string) => guide.addRow([label, text]);
  entry('Template Member & Akun', 'Panduan pengisian dan pemeriksaan file');
  entry('Versi format', SETUP_WORKBOOK_VERSION);
  section('Sebelum mengisi');
  entry(
    'Mulai dari contoh',
    'Sheet Member berisi 20 contoh. Ganti dengan data supplier Anda dan hapus contoh yang tidak dipakai. Setiap baris yang tersisa akan ikut diperiksa untuk import.',
  );
  entry(
    'Format dan batas',
    'Gunakan .xlsx atau CSV UTF-8, maksimal 50 MB dan 300 baris data per file. Jumlah member aktif setelah import maksimal 300, termasuk member yang sudah ada. File .xls tidak didukung.',
  );
  entry(
    'Susunan file',
    'Letakkan judul kolom pada baris pertama. Urutan kolom boleh berubah; kolom tambahan diabaikan. Isi data Excel pada sheet Member. Jika nama sheet berbeda, hanya boleh ada satu sheet data selain Panduan.',
  );
  entry(
    'Sheet lain',
    'Import Member & Akun hanya membaca data member. Sheet lain diabaikan. Foto, Tanoko, line, job, shift, assignment dan checklist tidak diubah melalui import ini.',
  );
  section('Memahami Kode member');
  entry(
    'Fungsi kode',
    'Kode member menghubungkan satu orang di file dengan member yang sama di aplikasi pada import berikutnya. Nama bisa sama atau berubah, sehingga aplikasi tidak mencocokkan orang berdasarkan nama.',
  );
  entry(
    'Memilih kode',
    'Isi kode tetap dari supplier, misalnya kode karyawan KRY-0007. Jika belum ada, buat kode unik dan simpan daftar kodenya. Kode wajib untuk MP, Supervisor, Line Leader dan QC, maksimal 100 karakter.',
  );
  entry(
    'Keunikan kode',
    'Dalam satu supplier, satu kode hanya boleh dipakai oleh satu orang, termasuk member arsip. Huruf besar dan kecil dianggap sama saat pencocokan. Supplier berbeda boleh memakai kode yang sama.',
  );
  entry(
    'Kode tetap dipakai',
    'Gunakan kode yang sama saat nama, username atau role berubah. Kode yang sudah terikat tidak dapat diganti melalui import. Jangan gunakan ulang kode member arsip untuk orang lain.',
  );
  entry(
    'Kode dan identitas lain',
    'Kode member adalah identitas import. Nomor registrasi adalah identitas registrasi Supervisor, LL dan QC; username dipakai untuk login. Aplikasi menyimpan ID internal tersendiri untuk relasi dan riwayat. MP tetap memerlukan kode walaupun tidak memiliki registrasi atau akun.',
  );
  entry(
    'Contoh pembaruan',
    'KRY-0007 dengan nama Budi Santoso sudah diimport. Pada file berikutnya, KRY-0007 dengan nama Budi S. dikenali sebagai orang yang sama. Mengganti kodenya menjadi KRY-0099 tidak otomatis menghubungkannya berdasarkan nama.',
  );
  entry(
    'Awalan kode',
    'SPV-, LL-, QC- dan MP- pada contoh hanya pola penamaan. Role mengikuti kolom Role. Pola netral seperti KRY-0007 tetap mudah dipakai jika jabatan berubah.',
  );
  entry(
    'Referensi assignment',
    'Pada workbook Import Data, Kode Supervisor, Kode LL dan Kode MP merujuk ke Kode member. Import Member & Akun tidak membuat assignment; atur melalui Line Setup atau workbook Import Data.',
  );
  section('Mengisi setiap kolom');
  entry(
    'Kode member',
    'Wajib. Isi satu kode tetap dan unik per orang. Format sel sebagai Text sebelum mengetik atau menempelkan kode, terutama yang memiliki nol di depan.',
  );
  entry(
    'Nama',
    'Wajib, maksimal 150 karakter. Isi nama yang ingin ditampilkan di aplikasi. Nama yang sama boleh dimiliki orang berbeda; bedakan melalui Kode member.',
  );
  entry(
    'Role',
    'Wajib. Pilih SUPERVISOR, LINE_LEADER, QC atau MP. Supplier Admin dan akun TMMIN tidak dapat diimport. Untuk member lama, gunakan role yang saat ini tersimpan. Perubahan role dilakukan melalui Ubah role pada Member & Akun.',
  );
  entry(
    'Nomor registrasi',
    'Wajib untuk Supervisor, Line Leader dan QC, termasuk saat memperbarui data. Maksimal 100 karakter dan unik dalam supplier. Kosongkan untuk MP. Simpan sebagai teks agar 001001 tetap 001001.',
  );
  entry(
    'Username',
    'Wajib untuk Supervisor, Line Leader dan QC, termasuk saat memperbarui data. Maksimal 100 karakter dan unik dalam supplier, termasuk akun yang sudah nonaktif. Kosongkan untuk MP.',
  );
  entry(
    'Password awal',
    'Wajib hanya untuk akun baru Supervisor, Line Leader dan QC. Isi teks sepanjang 12 sampai 128 karakter; spasi ikut dihitung. Pengguna harus mengganti password pada login pertama. Kosongkan untuk MP.',
  );
  entry(
    'Password contoh',
    'MemberAwal01 berisi tepat 12 karakter dan hanya untuk contoh. Ganti dengan password awal masing-masing akun sebelum digunakan. Untuk akun lama, aplikasi mengabaikan kolom ini dan mempertahankan password yang tersimpan.',
  );
  section('Menghubungkan member yang sudah ada');
  entry(
    'Pencocokan otomatis',
    'Aplikasi mencari Kode member terlebih dahulu. Untuk Supervisor, LL dan QC yang belum berkode, nomor registrasi atau username dapat menghubungkan baris ke member lama jika hasilnya merujuk satu orang.',
  );
  entry(
    'MP lama tanpa kode',
    'Pada tahap Periksa data, pilih MP lama yang sesuai melalui Hubungkan MP existing. Jika tidak dihubungkan, baris dianggap member baru. Periksa pilihan ini agar tidak membuat orang yang sama dua kali.',
  );
  entry(
    'Identitas bertentangan',
    'Jika nomor registrasi dan username merujuk orang berbeda, perbaiki file. Jika member sudah mempunyai kode, gunakan kode tersebut. Dua baris tidak boleh merujuk member yang sama.',
  );
  section('Memeriksa dan menyimpan');
  entry(
    'Periksa data',
    'Upload file, lalu periksa jumlah Baru, Berubah dan Sesuai. Jika ada kesalahan, baca baris, kolom dan penyebabnya. Perbaiki file di perangkat lalu pilih Ganti file. Download error tersedia untuk daftar perbaikan.',
  );
  entry(
    'Update atau Skip',
    'Untuk data yang berubah, pilih Update untuk memakai isi baris atau Skip untuk mempertahankan data lama. Member yang tidak tercantum dalam file tetap tersimpan. Kolom wajib tetap perlu diisi saat memperbarui data.',
  );
  entry(
    'Member arsip',
    'Pilih Pulihkan dan update untuk memulihkan member arsip. Akun yang nonaktif tetap nonaktif. Setelah member pulih, aktifkan akunnya secara terpisah dari detail member bila diperlukan.',
  );
  entry(
    'Username berubah',
    'Pembaruan username mengakhiri sesi akun tersebut. Pengguna perlu login kembali dengan username baru. Password lama tetap berlaku.',
  );
  entry(
    'Data berubah saat review',
    'Jika data supplier berubah sebelum import selesai, periksa data kembali. Pilihan Update, Skip atau Pulihkan perlu ditinjau ulang sebelum menyimpan.',
  );
  entry(
    'Hasil belum pasti',
    'Jika koneksi terputus saat menyimpan, gunakan Periksa hasil. Tunggu hasil import sebelum mengirim file yang sama lagi.',
  );
  section('Mengatasi kesalahan file');
  entry(
    'Header atau kolom hilang',
    'Gunakan judul kolom dari template pada baris pertama. Kode member, Nama dan Role wajib tersedia. Jangan menulis judul kolom yang sama dua kali.',
  );
  entry(
    'Kode ganda',
    'Gunakan satu baris per orang. Periksa kode yang sama, termasuk perbedaan huruf besar dan kecil. Untuk dua orang berbeda, berikan kode yang berbeda.',
  );
  entry(
    'Angka dan nol di depan',
    'Format kode dan nomor registrasi sebagai Text sebelum mengisi. Mengubah format setelah nol terhapus tidak mengembalikan nilainya. Ketik ulang dari sumber asli jika angka berubah atau dibulatkan oleh Excel.',
  );
  entry(
    'CSV dan tanda kutip',
    'Simpan sebagai CSV UTF-8 dengan pemisah koma atau titik koma. Nilai yang mengandung pemisah atau baris baru harus diapit tanda kutip ganda. Gunakan jumlah kolom yang sama dengan header pada setiap baris.',
  );
  entry(
    'File tidak terbaca',
    'Buka file di Excel atau aplikasi spreadsheet, lalu simpan ulang sebagai .xlsx atau CSV UTF-8. Jangan hanya mengganti ekstensi. Hapus proteksi password file sebelum upload.',
  );
  entry(
    'Batas terlampaui',
    'Jika file berisi lebih dari 300 baris, pecah menjadi beberapa file. Memecah file tidak menambah kapasitas 300 member aktif. Arsipkan member yang tidak lagi digunakan bila kapasitas supplier penuh.',
  );
  guide.eachRow((row) => {
    row.font = { name: 'Calibri', size: 11, color: { argb: 'FF29384A' } };
    row.height = Math.max(32, Math.ceil(row.getCell(2).text.length / 96) * 16 + 12);
    if (sections.has(row.number)) {
      guide.mergeCells(row.number, 1, row.number, 2);
      row.height = 28;
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF3' } };
      row.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF29384A' } };
    } else row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
  });
  guide.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:2',
  };
  const spec = SETUP_SHEETS.find((sheet) => sheet.name === 'Member')!;
  const sheet = workbook.addWorksheet('Member', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = spec.columns.map((column) => ({
    header: column.label,
    width: column.key === 'name' ? 32 : 25,
    ...(column.text ? { style: { numFmt: '@' } } : {}),
  }));
  sheet.addRows(MEMBER_IMPORT_EXAMPLES.map((row) => [...row]));
  const notes = [
    'Wajib, unik per supplier, maksimal 100 karakter. Gunakan kode yang sama pada import berikutnya. Simpan sebagai teks; kode yang sudah terikat tidak dapat diganti.',
    'Wajib, maksimal 150 karakter. Nama tidak digunakan untuk mencocokkan member lama.',
    'Pilih SUPERVISOR, LINE_LEADER, QC atau MP. Ubah role member lama melalui aksi Ubah role.',
    'Wajib untuk Supervisor, LL dan QC; kosong untuk MP. Unik per supplier, maksimal 100 karakter. Simpan sebagai teks agar nol di depan tetap ada.',
    'Wajib untuk Supervisor, LL dan QC; kosong untuk MP. Unik per supplier, maksimal 100 karakter.',
    'Akun baru: teks 12 sampai 128 karakter. Ganti password contoh sebelum digunakan. Kosong untuk MP; akun lama tetap memakai password yang tersimpan.',
  ];
  spec.columns.forEach((column, index) => {
    sheet.getCell(1, index + 1).note = `${column.label}. ${notes[index]} Lihat sheet Panduan.`;
  });
  for (let row = 2; row <= 301; row++)
    sheet.getCell(row, 3).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"SUPERVISOR,LINE_LEADER,QC,MP"'],
      showErrorMessage: true,
      errorTitle: 'Role tidak valid',
      error: 'Pilih role dari daftar.',
    };
  sheet.autoFilter = 'A1:F21';
  sheet.eachRow((row) => {
    row.height = 30;
    row.font = { name: 'Calibri', size: 11 };
  });
  for (const tab of [guide, sheet]) {
    tab.getRow(1).height = 30;
    tab.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF29384A' } };
      cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    });
    tab.eachRow((row) => {
      row.alignment = { vertical: 'middle', wrapText: true };
    });
  }
  return workbook.xlsx.writeBuffer();
}
