// ロックの競合はすぐに解けることが多いため、呼び出し元へ失敗を返す前に短い間隔でやり直す
export const TRANSIENT_D1_RETRY_DELAYS_MS = Object.freeze([100, 400, 1000]);

// どちらも文が実行されずに終わった失敗。後者はローカルのD1(miniflare)がロックの競合を内部エラーとして返す形で、書き込みの成否が分からない本番の内部エラーは含めない
const TRANSIENT_D1_MESSAGE_PATTERNS = Object.freeze([
  /SQLITE_BUSY/u,
  /Failed to parse body as JSON, got: Error: internal error; reference = /u,
]);

const MAX_CAUSE_DEPTH = 10;

export function isTransientD1Error(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) {
      return false;
    }
    const { message } = current;
    if (
      TRANSIENT_D1_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export interface TransientRetryOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  // やり直すたびに呼ぶ。ログの出力はアプリの側で行う
  readonly onRetry?: (error: unknown, delayMs: number) => void;
}

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function retrying<T>(
  run: () => Promise<T>,
  options: TransientRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? sleepFor;
  for (const delayMs of TRANSIENT_D1_RETRY_DELAYS_MS) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientD1Error(error)) {
        throw error;
      }
      options.onRetry?.(error, delayMs);
      await sleep(delayMs);
    }
  }
  return run();
}

// D1のbatchは元の文しか受け付けないため、包んだ文から元の文を引けるようにする
const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

const STATEMENT_QUERY_METHODS: ReadonlySet<PropertyKey> = new Set([
  'first',
  'run',
  'all',
  'raw',
]);

function wrapStatement(
  statement: D1PreparedStatement,
  options: TransientRetryOptions,
): D1PreparedStatement {
  const wrapped = new Proxy(statement, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'bind') {
        return (...values: unknown[]) =>
          wrapStatement(target.bind(...values), options);
      }
      if (STATEMENT_QUERY_METHODS.has(property)) {
        return (...args: unknown[]): Promise<unknown> =>
          retrying(
            () => Reflect.apply(value, target, args) as Promise<unknown>,
            options,
          );
      }
      return value;
    },
  });
  originals.set(wrapped, statement);
  return wrapped;
}

// ローカルでは複数のWorkerが同じD1のファイルを使い、ロックの競合で文が失敗することがある。失敗した文は実行されていないため、その文だけをやり直す
export function withTransientRetry(
  d1: D1Database,
  options: TransientRetryOptions = {},
): D1Database {
  const prepare = (query: string): D1PreparedStatement =>
    wrapStatement(d1.prepare(query), options);
  const batch = (statements: D1PreparedStatement[]): Promise<D1Result[]> =>
    retrying(
      () =>
        d1.batch(
          statements.map((statement) => originals.get(statement) ?? statement),
        ),
      options,
    );
  const exec = (query: string): Promise<D1ExecResult> =>
    retrying(() => d1.exec(query), options);
  const replaced: ReadonlyMap<PropertyKey, unknown> = new Map<
    PropertyKey,
    unknown
  >([
    ['prepare', prepare],
    ['batch', batch],
    ['exec', exec],
  ]);
  return new Proxy(d1, {
    get(target, property, receiver) {
      return replaced.has(property)
        ? replaced.get(property)
        : (Reflect.get(target, property, receiver) as unknown);
    },
  });
}
