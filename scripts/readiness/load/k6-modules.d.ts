declare module 'k6' {
  export function sleep(seconds: number): void;
}

declare module 'k6/http' {
  export interface Response {
    readonly status: number;
    readonly timings: { readonly duration: number };
  }
  export interface RequestParams {
    readonly tags?: Readonly<Record<string, string>>;
  }
  const http: {
    get(url: string, params?: RequestParams): Response;
  };
  export default http;
}

declare module 'k6/metrics' {
  export class Counter {
    constructor(name: string);
    add(value: number): void;
  }
  export class Rate {
    constructor(name: string);
    add(value: boolean): void;
  }
  export class Trend {
    constructor(name: string, isTime?: boolean);
    add(value: number): void;
  }
}

declare const __ENV: Readonly<Record<string, string | undefined>>;
declare const __VU: number;
