import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { SETUP_SHEETS, SETUP_WORKBOOK_VERSION } from '@tmmin-henkaten/contracts';

export async function createMemberTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Supplier Henkaten';
  const guide = workbook.addWorksheet('Panduan', { views: [{ state: 'frozen', ySplit: 2 }] });
  guide.columns = [{ width: 24 }, { width: 95 }];
  guide.addRows([
    ['Template Member & Akun', ''],
    ['Versi format', SETUP_WORKBOOK_VERSION],
    ['Mulai', 'Ganti atau hapus seluruh contoh pada sheet Member sebelum import.'],
    ['Batas', 'CSV atau .xlsx; maksimal 50 MB, 300 baris data dan 300 member aktif.'],
    [
      'Kode member',
      'Wajib, unik, tetap, maksimal 100 karakter. Format kode serta nomor registrasi sebagai teks.',
    ],
    ['Nama', 'Wajib, maksimal 150 karakter.'],
    ['Role', 'SUPERVISOR, LINE_LEADER, QC atau MP. Role existing diubah melalui Ubah role.'],
    [
      'Nomor registrasi',
      'Wajib untuk Supervisor, LL dan QC; kosong untuk MP. Maksimal 100 karakter.',
    ],
    ['Username', 'Wajib untuk Supervisor, LL dan QC; kosong untuk MP. Maksimal 100 karakter.'],
    [
      'Password awal',
      'Akun baru: teks 12–128 karakter, wajib diganti pada login pertama. Kosong untuk MP.',
    ],
    ['Akun existing', 'Password awal diabaikan; password dan status akun tetap dipertahankan.'],
    [
      'Data arsip',
      'Pilih Pulihkan dan update. Aktivasi akun dilakukan terpisah pada detail member.',
    ],
    [
      'MP existing',
      'Hubungkan MP tanpa kode secara eksplisit pada review; nama tidak menentukan identitas.',
    ],
    [
      'CSV',
      'Gunakan header yang sama; delimiter koma atau titik koma. Pertahankan teks dan nol di depan.',
    ],
  ]);
  guide.eachRow((row) => {
    row.height = 34;
  });
  const spec = SETUP_SHEETS.find((sheet) => sheet.name === 'Member')!;
  const sheet = workbook.addWorksheet('Member', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = spec.columns.map((column) => ({
    header: column.label,
    width: column.key === 'name' ? 32 : 25,
    ...(column.text ? { style: { numFmt: '@' } } : {}),
  }));
  sheet.addRows([
    [
      'SPV-01',
      'Supervisor contoh',
      'SUPERVISOR',
      '001001',
      'spv.contoh',
      randomBytes(15).toString('base64url'),
    ],
    [
      'LL-01',
      'Line Leader contoh',
      'LINE_LEADER',
      '001002',
      'll.contoh',
      randomBytes(15).toString('base64url'),
    ],
    ['QC-01', 'QC contoh', 'QC', '001003', 'qc.contoh', randomBytes(15).toString('base64url')],
    ['MP-01', 'Operator contoh', 'MP', '', '', ''],
  ]);
  spec.columns.forEach((column, index) => {
    sheet.getCell(1, index + 1).note =
      `${column.label}${column.required ? ' (wajib)' : ''}. Lihat Panduan untuk aturan pengisian.`;
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
  sheet.autoFilter = 'A1:F1';
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
