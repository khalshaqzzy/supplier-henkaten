import { useCallback } from 'react';
import { HenkatenExportSheet } from '@tmmin-henkaten/ui';
import { supplierApi, supplierAssetUrl } from '../app/api';
import { useSession } from '../app/session';

export function SupplierHenkatenExport() {
  const { session } = useSession();
  const options = useCallback(async () => {
    const [lines, shifts] = await Promise.all([
      supplierApi.lines({ limit: 100, active: 'ALL' }),
      supplierApi.shiftTemplates({ limit: 100, active: 'ALL' }),
    ]);
    return {
      lines: lines.items.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}` })),
      shifts: shifts.items.map((s) => ({ id: s.id, label: s.name })),
    };
  }, []);
  const create = useCallback(
    (filters: Parameters<typeof supplierApi.createHenkatenExport>[0]) =>
      supplierApi.createHenkatenExport(filters),
    [],
  );
  const get = useCallback((id: string) => supplierApi.henkatenExport(id), []);
  const url = useCallback(
    (id: string) => supplierAssetUrl(`/api/v1/supplier/henkatens/exports/${id}/file`),
    [],
  );
  return (
    <HenkatenExportSheet
      loadOptions={options}
      createExport={create}
      getExport={get}
      downloadUrl={url}
      storageKey={`henkaten-export:supplier:${session!.principal.userId}:${session!.supplier!.id}`}
      supplierLabel={session!.supplier!.name}
      supplierTimezone={session!.supplier!.timezone}
    />
  );
}
