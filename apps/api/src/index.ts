import { CONTRACT_SCHEMA_VERSION, healthResponseSchema } from '@tmmin-henkaten/contracts';

export const apiWorkspaceDescriptor = Object.freeze({
  name: '@tmmin-henkaten/api',
  runtime: 'compile-only',
  contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
});

export function validateFoundationHealth(value: unknown): void {
  healthResponseSchema.parse(value);
}
