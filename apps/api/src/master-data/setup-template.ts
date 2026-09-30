import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { SETUP_SHEETS, SETUP_WORKBOOK_VERSION, type SetupSheet } from '@tmmin-henkaten/contracts';

export async function createSetupTemplate(timezone: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Supplier Henkaten';
  const guide = workbook.addWorksheet('Panduan', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { tabColor: { argb: 'FF52647D' } },
  });
  guide.columns = [{ width: 26 }, { width: 95 }];
  guide.addRows([
    ['Template setup supplier', ''],
    ['Versi format', SETUP_WORKBOOK_VERSION],
    ['Mulai', 'Ganti contoh dengan data supplier. Pertahankan nama sheet dan header.'],
    ['Kode', 'Gunakan kode tetap. Simpan kode dan nomor part sebagai teks.'],
    ['Member', 'MP tidak menggunakan registrasi, username atau password.'],
    ['Akun baru', 'Password awal 12–128 karakter; wajib diganti pada login pertama.'],
    ['Data existing', 'Review Update/Skip. Password existing tidak diganti.'],
    ['Checklist 4M', 'Isi seluruh pertanyaan untuk kategori yang diubah. Import langsung publish.'],
    ['Sheet kosong', 'Sheet kosong atau tidak disertakan tidak menghapus data existing.'],
    [
      'Tanoko, foto, Canvas',
      'Nilai Tanoko, foto member dan layout Canvas diatur manual melalui aplikasi.',
    ],
    [
      'Urutan pengisian',
      'Member → Line → Job → Part → Shift → Line Shift → Assignment MP → Checklist 4M.',
    ],
    [
      'Kode referensi',
      'Kode line/shift/job/member harus sama dengan kode pada sheet sumber atau setup existing.',
    ],
    [
      'Kode job',
      'Unik dalam satu line. Kode yang sama dapat dipakai pada line berbeda. Job existing tidak dapat dipindah line.',
    ],
    [
      'Supervisor dan LL',
      'Supervisor dapat mengisi beberapa Line Shift. Satu LL hanya boleh mengisi satu Line Shift aktif.',
    ],
    [
      'Assignment MP',
      'MP dapat digunakan pada beberapa job/shift. Kolom MP kosong mengosongkan assignment yang dipilih Update.',
    ],
    [
      'Jam shift',
      'Gunakan HH:mm, misalnya 07:00. 23:00–07:00 melewati tengah malam. Jam mulai dan selesai harus berbeda.',
    ],
    [
      'Timezone',
      `Gunakan nama IANA, misalnya ${timezone}. Samakan dengan jadwal operasional supplier.`,
    ],
    [
      'Urutan',
      'Bilangan bulat positif. Checklist diurutkan per kategori; line, job dan shift mengikuti urutan tampil.',
    ],
    ['Data arsip', 'Pilih Restore dan update pada review jika data lama ingin diaktifkan kembali.'],
    [
      'MP existing',
      'Jika belum memiliki kode import, hubungkan MP secara eksplisit di dialog; nama saja tidak menentukan identitas.',
    ],
    [
      'Partial import',
      'Boleh mengisi sebagian sheet. Referensi tetap harus tersedia dalam file atau setup existing yang aktif.',
    ],
    [
      'Checklist lengkap',
      'Kategori MAN/MACHINE/MATERIAL/METHOD yang disertakan menggantikan seluruh daftar pertanyaan kategori tersebut.',
    ],
    [
      'Perbaikan error',
      'Dialog menampilkan sheet, baris, kolom dan alasan. Perbaiki Excel lalu pilih file kembali.',
    ],
    [
      'Batas workbook',
      'Format .xlsx, maksimal 50 MB dan 60.000 baris data total; batas per sheet dicantumkan di bawah.',
    ],
    [
      'Dropdown',
      'Daftar kode mengambil sheet sumber. Untuk data existing yang tidak ditulis di file, ketik kode referensinya langsung.',
    ],
    [
      'Simpan file',
      'Simpan sebagai .xlsx. Jangan mengganti nama sheet/header atau menggabungkan sel data.',
    ],
    ['Contoh', 'Seluruh contoh di sheet data akan ikut diimport jika tidak diganti atau dihapus.'],
  ]);
  const samplePassword = () => randomBytes(15).toString('base64url');
  const examples: Record<SetupSheet, string[][]> = {
    Member: [
      ['GL-01', 'Supervisor contoh', 'SUPERVISOR', 'REG-GL-01', 'gl.contoh', samplePassword()],
      ['LL-01', 'Line Leader pagi', 'LINE_LEADER', 'REG-LL-01', 'll.pagi', samplePassword()],
      ['LL-02', 'Line Leader malam', 'LINE_LEADER', 'REG-LL-02', 'll.malam', samplePassword()],
      [
        'LL-03',
        'Line Leader machining pagi',
        'LINE_LEADER',
        'REG-LL-03',
        'll.machining.pagi',
        samplePassword(),
      ],
      [
        'LL-04',
        'Line Leader machining malam',
        'LINE_LEADER',
        'REG-LL-04',
        'll.machining.malam',
        samplePassword(),
      ],
      ['QC-01', 'QC contoh', 'QC', 'REG-QC-01', 'qc.contoh', samplePassword()],
      ['MP-01', 'Operator pertama', 'MP', '', '', ''],
      ['MP-02', 'Operator kedua', 'MP', '', '', ''],
      ['MP-03', 'Operator machining', 'MP', '', '', ''],
      ['MP-04', 'Operator packing', 'MP', '', '', ''],
    ],
    Line: [
      ['LINE-01', 'Line contoh', '1'],
      ['LINE-02', 'Line machining', '2'],
    ],
    Job: [
      ['LINE-01', 'JOB-01', 'Assembly', '1', 'MEDIUM'],
      ['LINE-01', 'JOB-02', 'Inspection', '2', 'HIGH'],
      ['LINE-02', 'JOB-01', 'Machining', '1', 'HIGH'],
      ['LINE-02', 'JOB-02', 'Packing', '2', 'LOW'],
    ],
    Part: [
      ['001234567890', 'Bracket contoh'],
      ['PART-002', 'Housing contoh'],
      ['PART-003', 'Shaft contoh'],
    ],
    Shift: [
      ['PAGI', 'Pagi', '07:00', '15:00', '1', timezone],
      ['MALAM', 'Malam', '23:00', '07:00', '2', timezone],
    ],
    'Line Shift': [
      ['LINE-01', 'PAGI', 'GL-01', 'LL-01'],
      ['LINE-01', 'MALAM', 'GL-01', 'LL-02'],
      ['LINE-02', 'PAGI', 'GL-01', 'LL-03'],
      ['LINE-02', 'MALAM', 'GL-01', 'LL-04'],
    ],
    'Assignment MP': [
      ['LINE-01', 'PAGI', 'JOB-01', 'MP-01'],
      ['LINE-01', 'PAGI', 'JOB-02', 'MP-02'],
      ['LINE-01', 'MALAM', 'JOB-01', 'MP-01'],
      ['LINE-01', 'MALAM', 'JOB-02', 'MP-02'],
      ['LINE-02', 'PAGI', 'JOB-01', 'MP-03'],
      ['LINE-02', 'PAGI', 'JOB-02', 'MP-04'],
      ['LINE-02', 'MALAM', 'JOB-01', 'MP-03'],
      ['LINE-02', 'MALAM', 'JOB-02', 'MP-04'],
    ],
    'Checklist 4M': [
      ['MAN', '1', 'Operator telah memahami perubahan pekerjaan.'],
      ['MACHINE', '1', 'Kondisi mesin telah diperiksa sebelum digunakan.'],
      ['MATERIAL', '1', 'Identitas dan kondisi material telah diperiksa.'],
      ['MAN', '2', 'Keterampilan operator sesuai dengan pekerjaan yang ditugaskan.'],
      ['MAN', '3', 'Serah terima pekerjaan telah dikonfirmasi oleh Line Leader.'],
      ['MACHINE', '2', 'Setting dan parameter mesin sesuai instruksi kerja.'],
      ['MACHINE', '3', 'Hasil pemeriksaan awal mesin telah dikonfirmasi.'],
      ['MATERIAL', '2', 'Nomor part dan lot material sesuai kebutuhan produksi.'],
      ['MATERIAL', '3', 'Material telah ditempatkan pada area yang ditentukan.'],
      ['METHOD', '1', 'Instruksi kerja terbaru telah dikonfirmasi.'],
      ['METHOD', '2', 'Urutan proses dan titik pemeriksaan dipahami operator.'],
      ['METHOD', '3', 'Dokumen perubahan metode tersedia di area kerja.'],
    ],
  };
  const columnHelp = (sheet: SetupSheet, key: string) => {
    const descriptions: Record<string, string> = {
      code:
        sheet === 'Part'
          ? 'Nomor part unik; simpan sebagai teks agar nol di depan dan nomor panjang tetap utuh.'
          : sheet === 'Job'
            ? 'Kode tetap, unik dalam satu line; simpan sebagai teks.'
            : 'Kode tetap dan unik pada sheet ini; gunakan kode yang sama pada import berikutnya.',
      name: 'Nama yang akan ditampilkan di aplikasi.',
      role: 'SUPERVISOR, LINE_LEADER, QC atau MP. Role member existing tidak dapat diubah.',
      registration: 'Wajib untuk Supervisor/LL/QC, unik per supplier. Kosong untuk MP.',
      username: 'Wajib untuk Supervisor/LL/QC, unik per supplier. Kosong untuk MP.',
      password:
        'Wajib untuk akun baru: 12–128 karakter. Password existing tidak diganti. Kosong untuk MP.',
      order: 'Bilangan bulat positif untuk urutan tampil; checklist diurutkan per kategori.',
      category:
        sheet === 'Job'
          ? 'HIGH, MEDIUM atau LOW; boleh kosong untuk diatur manual.'
          : 'MAN, MACHINE, MATERIAL atau METHOD.',
      line: 'Kode line pada sheet Line atau setup existing. Job selalu terkait pada line ini.',
      shift: 'Kode shift pada sheet Shift atau setup existing.',
      supervisor:
        'Kode member dengan role SUPERVISOR. Boleh kosong; lengkapi assignment melalui Line Setup.',
      leader:
        'Kode member dengan role LINE_LEADER. Satu LL hanya boleh berada pada satu Line Shift aktif.',
      job: 'Kode job pada sheet Job; harus berasal dari kode line pada baris yang sama.',
      mp: 'Kode member dengan role MP. Boleh kosong untuk mengosongkan assignment saat Update.',
      start: 'Jam mulai HH:mm, misalnya 07:00; teks atau sel jam Excel.',
      end: 'Jam selesai HH:mm, misalnya 15:00. Jam lebih kecil dari mulai berarti hari berikutnya.',
      timezone: `Nama timezone IANA, misalnya ${timezone}.`,
      question:
        'Pertanyaan checklist, satu per baris. Isi seluruh daftar untuk setiap kategori yang akan dipublish.',
    };
    return descriptions[key] ?? '';
  };
  const sections = new Set<number>();
  for (const spec of SETUP_SHEETS) {
    sections.add(guide.rowCount + 1);
    guide.addRow([
      spec.name,
      `Maksimal ${spec.limit.toLocaleString('id-ID')} baris data. ${examples[spec.name].length} baris contoh.`,
    ]);
    for (const column of spec.columns)
      guide.addRow([
        column.label,
        `${column.required ? 'Wajib' : ['registration', 'username', 'password'].includes(column.key) ? 'Kondisional' : 'Opsional'}. ${columnHelp(spec.name, column.key)}`,
      ]);
    guide.addRow(['', '']);
  }
  for (const spec of SETUP_SHEETS) {
    const sheet = workbook.addWorksheet(spec.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: 'FFF19A45' } },
    });
    sheet.columns = spec.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: c.key === 'question' ? 68 : c.key === 'name' ? 28 : c.key === 'password' ? 26 : 22,
      ...(c.text ? { style: { numFmt: '@' } } : {}),
    }));
    sheet.addRows(examples[spec.name]);
    sheet.autoFilter = {
      from: 'A1',
      to: { row: examples[spec.name].length + 1, column: spec.columns.length },
    };
    sheet.getRow(1).height = 30;
    for (const [index, column] of spec.columns.entries()) {
      const cell = sheet.getRow(1).getCell(index + 1);
      cell.note = `${column.required ? 'Wajib. ' : ''}${columnHelp(spec.name, column.key)}`;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: column.required ? 'FF17243A' : 'FF52647D' },
      };
      cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      if (column.values)
        for (let row = 2; row <= Math.min(spec.limit + 1, 2001); row++)
          sheet.getCell(row, index + 1).dataValidation = {
            type: 'list',
            allowBlank: !column.required,
            formulae: [`"${column.values.join(',')}"`],
            showErrorMessage: true,
            errorTitle: 'Nilai tidak sesuai',
            error: 'Pilih nilai dari daftar.',
          };
    }
    sheet.eachRow((row, index) => {
      if (index > 1) {
        row.height = 24;
        row.font = { name: 'Aptos', size: 11, color: { argb: 'FF17243A' } };
        row.alignment = { vertical: 'middle', wrapText: true };
      }
    });
  }
  workbook.definedNames.add("'Member'!$A$2:$A$301", 'MemberCodes');
  workbook.definedNames.add("'Line'!$A$2:$A$21", 'LineCodes');
  workbook.definedNames.add("'Job'!$B$2:$B$501", 'JobCodes');
  workbook.definedNames.add("'Shift'!$A$2:$A$101", 'ShiftCodes');
  for (const spec of SETUP_SHEETS) {
    const sheet = workbook.getWorksheet(spec.name)!;
    for (const [index, column] of spec.columns.entries()) {
      const list =
        column.key === 'line'
          ? 'LineCodes'
          : column.key === 'shift'
            ? 'ShiftCodes'
            : column.key === 'job'
              ? 'JobCodes'
              : ['supervisor', 'leader', 'mp'].includes(column.key)
                ? 'MemberCodes'
                : null;
      if (list)
        for (let row = 2; row <= Math.min(spec.limit + 1, 501); row++)
          sheet.getCell(row, index + 1).dataValidation = {
            type: 'list',
            allowBlank: !column.required,
            formulae: [list],
            showErrorMessage: false,
            showInputMessage: true,
            promptTitle: 'Kode referensi',
            prompt: 'Pilih dari sheet sumber atau ketik kode setup existing.',
            errorTitle: 'Kode tidak ditemukan',
            error: 'Gunakan kode dari sheet referensi.',
          };
    }
  }
  guide.getRow(1).font = { name: 'Aptos', size: 18, bold: true, color: { argb: 'FF17243A' } };
  guide.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = row.number === 1 ? 42 : 38;
    if (sections.has(row.number)) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17243A' } };
      row.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    } else if (row.number > 1) row.font = { name: 'Aptos', size: 11, color: { argb: 'FF17243A' } };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
