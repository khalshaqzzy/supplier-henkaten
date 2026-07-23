export class TenantScope {
  readonly supplierId: string;

  constructor(supplierId: string) {
    this.supplierId = supplierId;
    Object.freeze(this);
  }
}

export class TmminScope {
  readonly kind = 'TMMIN';
  private constructor() {}
  static readonly instance = new TmminScope();
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const CLOCK = Symbol('CLOCK');
