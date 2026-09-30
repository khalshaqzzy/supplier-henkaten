import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import archiver from 'archiver';
import unzipper from 'unzipper';

export type ExportChart = {
  title: string;
  direction: 'bar' | 'column';
  labels: string[];
  values: number[];
  labelColumn: string;
  valueColumn: string;
  firstRow: number;
  from: { column: number; row: number };
  to: { column: number; row: number };
  color: string;
  pointColors?: string[];
  grouping?: 'clustered' | 'stacked';
  series?: Array<{ name: string; valueColumn: string; values: number[]; color: string }>;
};

const chartUri = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const relUri = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelUri = 'http://schemas.openxmlformats.org/package/2006/relationships';

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function chartXml(chart: ExportChart, index: number): string {
  const lastRow = chart.firstRow + chart.labels.length - 1;
  const labelRef = `Ringkasan!$${chart.labelColumn}$${chart.firstRow}:$${chart.labelColumn}$${lastRow}`;
  const labels = chart.labels
    .map((value, point) => `<c:pt idx="${point}"><c:v>${escapeXml(value)}</c:v></c:pt>`)
    .join('');
  const points =
    chart.pointColors
      ?.map(
        (color, point) =>
          `<c:dPt><c:idx val="${point}"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:dPt>`,
      )
      .join('') ?? '';
  const axisCategory = 50010000 + index * 2 + 1;
  const axisValue = axisCategory + 1;
  const barDir = chart.direction === 'bar' ? 'bar' : 'col';
  const categoryPosition = chart.direction === 'bar' ? 'l' : 'b';
  const valuePosition = chart.direction === 'bar' ? 'b' : 'l';
  const axisText = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr baseline="0"><a:solidFill><a:srgbClr val="17243A"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr>`;
  const series = chart.series ?? [
    { name: chart.title, valueColumn: chart.valueColumn, values: chart.values, color: chart.color },
  ];
  const seriesXml = series
    .map((item, seriesIndex) => {
      const valueRef = `Ringkasan!$${item.valueColumn}$${chart.firstRow}:$${item.valueColumn}$${lastRow}`;
      const values = item.values
        .map((value, point) => `<c:pt idx="${point}"><c:v>${value}</c:v></c:pt>`)
        .join('');
      return (
        `<c:ser><c:idx val="${seriesIndex}"/><c:order val="${seriesIndex}"/><c:tx><c:v>${escapeXml(item.name)}</c:v></c:tx>` +
        (seriesIndex === 0 ? points : '') +
        `<c:spPr><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill></c:spPr>` +
        (series.length === 1
          ? `<c:dLbls>${axisText}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
          : '') +
        `<c:cat><c:strRef><c:f>${labelRef}</c:f><c:strCache><c:ptCount val="${chart.labels.length}"/>${labels}</c:strCache></c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${valueRef}</c:f><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="${item.values.length}"/>${values}</c:numCache></c:numRef></c:val></c:ser>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${chartUri}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relUri}">` +
    `<c:lang val="id-ID"/><c:chart><c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="${barDir}"/><c:grouping val="${chart.grouping ?? 'clustered'}"/><c:varyColors val="0"/>` +
    `${seriesXml}${chart.grouping === 'stacked' ? '<c:overlap val="100"/>' : ''}<c:axId val="${axisCategory}"/><c:axId val="${axisValue}"/></c:barChart>` +
    `<c:catAx><c:axId val="${axisCategory}"/><c:scaling><c:orientation val="${chart.direction === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:axPos val="${categoryPosition}"/><c:tickLblPos val="nextTo"/>${axisText}<c:crossAx val="${axisValue}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>` +
    `<c:valAx><c:axId val="${axisValue}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="${valuePosition}"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/>${axisText}<c:crossAx val="${axisCategory}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
    `</c:plotArea>${series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:layout/></c:legend>' : ''}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  );
}

function drawingXml(charts: ExportChart[]): string {
  const anchors = charts
    .map((chart, index) => {
      const marker = (name: 'from' | 'to', position: { column: number; row: number }) =>
        `<xdr:${name}><xdr:col>${position.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${position.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`;
      return (
        `<xdr:twoCellAnchor>${marker('from', chart.from)}${marker('to', chart.to)}` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="${escapeXml(chart.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="${chartUri}"><c:chart xmlns:c="${chartUri}" xmlns:r="${relUri}" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`
  );
}

export async function addEditableCharts(
  input: string,
  output: string,
  charts: ExportChart[],
): Promise<void> {
  if (!charts.length) throw new Error('Chart definitions are required');
  const directory = await unzipper.Open.file(input);
  const names = new Set(directory.files.map((entry) => entry.path));
  if (names.has('xl/drawings/drawing1.xml') || names.has('xl/worksheets/_rels/sheet1.xml.rels')) {
    throw new Error('Summary sheet already contains drawings or relationships');
  }
  const archive = archiver('zip', { zlib: { level: 6 } });
  const completion = pipeline(archive, createWriteStream(output, { mode: 0o600 }));
  try {
    for (const entry of directory.files) {
      if (entry.type === 'Directory') continue;
      if (entry.path === '[Content_Types].xml') {
        const original = (await entry.buffer()).toString('utf8');
        const overrides = [
          `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
          ...charts.map(
            (_, index) =>
              `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
          ),
        ].join('');
        archive.append(original.replace('</Types>', `${overrides}</Types>`), { name: entry.path });
      } else if (entry.path === 'xl/worksheets/sheet1.xml') {
        let original = (await entry.buffer()).toString('utf8');
        if (!original.includes('xmlns:r=')) {
          original = original.replace('<worksheet ', `<worksheet xmlns:r="${relUri}" `);
        }
        archive.append(original.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'), {
          name: entry.path,
        });
      } else {
        archive.append(entry.stream(), { name: entry.path });
      }
    }
    archive.append(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${packageRelUri}"><Relationship Id="rId1" Type="${relUri}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      { name: 'xl/worksheets/_rels/sheet1.xml.rels' },
    );
    archive.append(drawingXml(charts), { name: 'xl/drawings/drawing1.xml' });
    archive.append(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${packageRelUri}">${charts.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${relUri}/chart" Target="../charts/chart${index + 1}.xml"/>`).join('')}</Relationships>`,
      { name: 'xl/drawings/_rels/drawing1.xml.rels' },
    );
    charts.forEach((chart, index) =>
      archive.append(chartXml(chart, index), { name: `xl/charts/chart${index + 1}.xml` }),
    );
    await archive.finalize();
    await completion;
  } catch (error) {
    archive.abort();
    await completion.catch(() => undefined);
    throw error;
  }
}
