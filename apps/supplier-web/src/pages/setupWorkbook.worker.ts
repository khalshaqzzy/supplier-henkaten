import readXlsxFile from 'read-excel-file/web-worker';
import { inspectSetupWorkbook, parseSetupSheets } from './setupWorkbook';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    await inspectSetupWorkbook(event.data);
    self.postMessage({ stage: 'READING' });
    const sheets = await readXlsxFile(event.data);
    self.postMessage({ stage: 'VALIDATING' });
    self.postMessage({ result: parseSetupSheets(sheets) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'File tidak dapat dibaca.',
    });
  }
};
