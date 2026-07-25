import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Alert,
  Button,
  Field,
  FourMIndicator,
  HenkatenStatus,
  Input,
  Pagination,
  Select,
  SourceModeBadge,
  Tabs,
} from './index';

afterEach(cleanup);

describe('representative accessibility scan', () => {
  it('has no blocking axe violations across forms, navigation, and status semantics', async () => {
    const { container } = render(
      <main>
        <h1>Henkaten form specimen</h1>
        <Alert tone="warning" title="Assignment perlu diperbarui">
          Pilih member aktif sebelum menjalankan preflight kembali.
        </Alert>
        <Field
          label="Nomor registrasi"
          htmlFor="registration-number"
          helperText="Gunakan nomor yang tercatat pada supplier."
        >
          <Input id="registration-number" />
        </Field>
        <Select
          label="Line"
          defaultValue="sr-cs"
          options={[
            { value: 'sr-cs', label: 'SR CS Line' },
            { value: 'sr-ds', label: 'SR DS Line' },
          ]}
        />
        <Tabs
          label="Detail Henkaten"
          defaultValue="detail"
          items={[
            { value: 'detail', label: 'Detail', content: 'Detail perubahan' },
            { value: 'history', label: 'Riwayat', content: 'Riwayat keputusan' },
          ]}
        />
        <section aria-label="Status operasional">
          <FourMIndicator category="MAN" />
          <SourceModeBadge mode="HOSTED" />
          <HenkatenStatus status="OPEN" />
        </section>
        <Pagination page={1} pageCount={3} onPageChange={() => undefined} />
        <Button>Simpan perubahan</Button>
      </main>,
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
