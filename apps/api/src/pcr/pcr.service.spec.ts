import { describe, expect, it } from 'vitest';

import { PCR_SYSTEM_PROMPT } from './pcr-prompt.js';
import { decidePcrStatus, pcrInputHash, pcrModelOutputSchema } from './pcr.service.js';

describe('PCR screening boundary', () => {
  it('routes low confidence, invalid output and missing inference to human review', () => {
    const positive = pcrModelOutputSchema.parse({
      needsPcr: true,
      confidence: 0.74,
      matchedControlItems: [20],
      assessment: 'A process method changed.',
    });
    const negative = pcrModelOutputSchema.parse({
      needsPcr: false,
      confidence: 0.75,
      matchedControlItems: [],
      assessment: null,
    });
    expect(decidePcrStatus(positive, 0.75)).toBe('REVIEW');
    expect(decidePcrStatus(negative, 0.75)).toBe('NO_PCR');
    expect(decidePcrStatus({ ...positive, confidence: 0.75 }, 0.75)).toBe('PCR');
    expect(decidePcrStatus(null, 0.75)).toBe('REVIEW');
    expect(
      pcrModelOutputSchema.safeParse({
        needsPcr: false,
        confidence: 0.9,
        matchedControlItems: [],
        assessment: 'should not appear',
      }).success,
    ).toBe(false);
    expect(
      pcrModelOutputSchema.safeParse({
        needsPcr: true,
        confidence: 1.2,
        matchedControlItems: [20],
        assessment: 'wrong',
      }).success,
    ).toBe(false);
  });

  it('keeps Indonesian evidence distinct and instructs the model on both sides of the matrix', () => {
    expect(
      pcrInputHash({
        category: 'MATERIAL',
        cause: 'Pergantian lot sesuai FIFO',
        detail: 'Spesifikasi tetap',
      }),
    ).not.toBe(
      pcrInputHash({
        category: 'MATERIAL',
        cause: 'Pergantian spesifikasi material',
        detail: 'Grade berubah',
      }),
    );
    expect(PCR_SYSTEM_PROMPT).toContain('Indonesian');
    expect(PCR_SYSTEM_PROMPT).toContain('untrusted record data');
    expect(PCR_SYSTEM_PROMPT).toContain('Routine replacement of a material LOT');
    expect(PCR_SYSTEM_PROMPT).toContain('Change of manufacturing method');
    expect(PCR_SYSTEM_PROMPT).toContain('Safety, R means Regulations, and E means Emissions');
    expect(PCR_SYSTEM_PROMPT).toContain('100-150 words');
  });
});
