export function frontendComposeArguments() {
  return ['up', '--detach', '--build', 'supplier-web', 'tmmin-web'];
}

export function localStackEndpoints({
  apiPort = '3000',
  supplierWebPort = '5173',
  tmminWebPort = '5174',
} = {}) {
  return [
    ['API readiness', `http://127.0.0.1:${apiPort}/ready`],
    ['Supplier web', `http://localhost:${supplierWebPort}`],
    ['TMMIN web', `http://localhost:${tmminWebPort}`],
  ];
}
