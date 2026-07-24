import '@testing-library/jest-dom/vitest';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
});

Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
  value: () => false,
  configurable: true,
});

Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  value: () => undefined,
  configurable: true,
});

Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
  value: () => undefined,
  configurable: true,
});
