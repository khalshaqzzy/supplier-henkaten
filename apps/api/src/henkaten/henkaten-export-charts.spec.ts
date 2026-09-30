import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import { afterAll, expect, it } from 'vitest';

import { addEditableCharts } from './henkaten-export-charts.js';

const folders: string[] = [];
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

it('adds a native chart linked to summary cells without rewriting detail values', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'henkaten-chart-'));
  folders.push(folder);
  const source = join(folder, 'source.xlsx');
  const output = join(folder, 'output.xlsx');
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: createWriteStream(source),
    useStyles: true,
  });
  const summary = writer.addWorksheet('Ringkasan');
  summary.addRow(['Status', 'Jumlah']).commit();
  summary.addRow(['OPEN', 8]).commit();
  summary.addRow(['APPROVED', 66]).commit();
  summary.commit();
  const detail = writer.addWorksheet('Henkaten');
  detail.addRow(['ID']).commit();
  detail.addRow(['H-001']).commit();
  detail.commit();
  await writer.commit();

  await addEditableCharts(source, output, [
    {
      title: 'Status',
      direction: 'bar',
      labels: ['OPEN', 'APPROVED'],
      values: [8, 66],
      labelColumn: 'A',
      valueColumn: 'B',
      firstRow: 2,
      from: { column: 3, row: 1 },
      to: { column: 10, row: 15 },
      color: '4778D2',
    },
  ]);
  const directory = await unzipper.Open.file(output);
  const paths = directory.files.map((entry) => entry.path);
  expect(paths).toContain('xl/charts/chart1.xml');
  expect(paths).toContain('xl/drawings/drawing1.xml');
  const chart = await directory.files
    .find((entry) => entry.path === 'xl/charts/chart1.xml')!
    .buffer();
  expect(chart.toString()).toContain('Ringkasan!$A$2:$A$3');
  expect(chart.toString()).toContain('<c:pt idx="1"><c:v>66</c:v></c:pt>');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(output);
  expect(workbook.getWorksheet('Henkaten')!.getCell('A2').value).toBe('H-001');
});

it('writes editable stacked series with distinct source ranges', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'henkaten-stacked-chart-'));
  folders.push(folder);
  const source = join(folder, 'source.xlsx');
  const output = join(folder, 'output.xlsx');
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: createWriteStream(source) });
  const summary = writer.addWorksheet('Ringkasan');
  summary.addRow(['Bulan', 'MAN', 'MACHINE']).commit();
  summary.addRow(['2026-08', 2, 3]).commit();
  summary.addRow(['2026-09', 4, 5]).commit();
  summary.commit();
  await writer.commit();
  await addEditableCharts(source, output, [
    {
      title: 'Tren 4M',
      direction: 'column',
      labels: ['2026-08', '2026-09'],
      values: [5, 9],
      labelColumn: 'A',
      valueColumn: 'B',
      firstRow: 2,
      from: { column: 0, row: 4 },
      to: { column: 8, row: 20 },
      color: '4778D2',
      grouping: 'stacked',
      series: [
        { name: 'MAN', valueColumn: 'B', values: [2, 4], color: '4778D2' },
        { name: 'MACHINE', valueColumn: 'C', values: [3, 5], color: '20A694' },
      ],
    },
  ]);
  const directory = await unzipper.Open.file(output);
  const xml = (
    await directory.files.find((entry) => entry.path === 'xl/charts/chart1.xml')!.buffer()
  ).toString();
  expect(xml.match(/<c:ser>/g)).toHaveLength(2);
  expect(xml).toContain('<c:grouping val="stacked"/>');
  expect(xml).toContain('Ringkasan!$B$2:$B$3');
  expect(xml).toContain('Ringkasan!$C$2:$C$3');
});
