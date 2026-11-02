import readXlsxFile from 'read-excel-file/web-worker';
import { inspectSetupWorkbook } from './setupWorkbook';
import { parseMemberCsv, parseMemberSheets } from './memberImport';

self.onmessage = async (event: MessageEvent<File>) => {
  if (event.origin !== '' || event.source !== null || !(event.data instanceof File)) return;
  try {
    const file = event.data;
    if (file.size > 50 * 1024 * 1024) throw new Error('Ukuran file maksimal 50 MB.');
    self.postMessage({ stage: 'READING' });
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (extension !== 'csv' && extension !== 'xlsx')
      throw new Error('Pilih file CSV atau Excel (.xlsx).');
    if (extension === 'xlsx') await inspectSetupWorkbook(file);
    const source = extension === 'csv' ? await file.text() : await readXlsxFile(file);
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
