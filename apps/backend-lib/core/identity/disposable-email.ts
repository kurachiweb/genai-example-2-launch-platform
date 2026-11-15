export type DisposableEmailStatus = 'disposable' | 'regular' | 'undetermined';

export const DISPOSABLE_CHECK_LOCAL_PART = 'dummy';

const SUCCESS_STATUS = 200;

export type DisifyOutcome =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly json: unknown;
    }
  | { readonly kind: 'network-error' }
  | { readonly kind: 'timeout' };

// application層(api・event)が受け取る契約。application層はworkersの部品を読み込めないため純粋な部品に置く
export interface DisposableEmailChecker {
  check(email: string): Promise<DisposableEmailStatus>;
}

// 判定サービスへローカル部を渡さないため、@が無い値はドメイン部を空にして送る
export function toDisposableCheckAddress(email: string): string {
  const separator = email.lastIndexOf('@');
  const domain = separator === -1 ? '' : email.slice(separator + 1);
  return `${DISPOSABLE_CHECK_LOCAL_PART}@${domain}`;
}

function readDisposable(json: unknown): boolean | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return undefined;
  }
  const body = json as Record<string, unknown>;
  if (body['format'] !== true || typeof body['disposable'] !== 'boolean') {
    return undefined;
  }
  return body['disposable'];
}

export function classifyDisifyOutcome(
  outcome: DisifyOutcome,
): DisposableEmailStatus {
  if (outcome.kind !== 'response' || outcome.status !== SUCCESS_STATUS) {
    return 'undetermined';
  }
  const disposable = readDisposable(outcome.json);
  if (disposable === undefined) {
    return 'undetermined';
  }
  return disposable ? 'disposable' : 'regular';
}
