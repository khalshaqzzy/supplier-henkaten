import readXlsxFile from 'read-excel-file/web-worker';
import { inspectSetupWorkbook } from './setupWorkbook';
import { parseMemberCsv, parseMemberSheets } from './memberImport';

self.onmessage = async (event: MessageEvent<File>) => {
  if (event.origin !== '' || event.source !== null || !(event.data instanceof File)) return;
  try {
    const file = event.data;
    if (!file.size)
      throw new Error('File kosong. Isi data member pada template, simpan, lalu upload kembali.');
    if (file.size > 50 * 1024 * 1024) throw new Error('Ukuran file maksimal 50 MB.');
    self.postMessage({ stage: 'READING' });
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (extension !== 'csv' && extension !== 'xlsx')
      throw new Error(
        'Format file belum didukung. Pilih CSV atau Excel (.xlsx). Untuk .xls, buka di Excel lalu simpan ulang sebagai .xlsx; jangan hanya mengganti ekstensi.',
      );
    if (extension === 'xlsx') await inspectSetupWorkbook(file);
    let source;
    try {
      source = extension === 'csv' ? await file.text() : await readXlsxFile(file);
    } catch {
      throw new Error(
        'Isi file tidak dapat dibaca. File mungkin rusak, dilindungi password atau tidak sesuai formatnya. Buka di aplikasi spreadsheet, hapus proteksi password jika ada, lalu simpan ulang sebagai CSV UTF-8 atau .xlsx.',
      );
    }
    self.postMessage({ stage: 'VALIDATING' });
    const result = typeof source === 'string' ? parseMemberCsv(source) : parseMemberSheets(source);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'File tidak dapat dibaca.',
    });
  } finally {
    self.close();
  }
};
