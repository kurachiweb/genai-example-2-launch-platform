import {
  classifyDisifyOutcome,
  type DisifyOutcome,
  type DisposableEmailChecker,
  type DisposableEmailStatus,
  toDisposableCheckAddress,
} from '../../core/identity/disposable-email.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { HttpFetch } from '../bot-protection/turnstile-verifier.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface DisifyClientOptions {
  readonly appName: LoggingOptions['appName'];
  readonly fetch: HttpFetch;
  readonly apiKey: string | undefined;
  readonly timeoutMs?: number;
}

export const DISIFY_EMAIL_URL = 'https://disify.com/api/email';

const DEFAULT_TIMEOUT_MS = 3000;

type UndeterminedReason =
  'network-error' | 'timeout' | 'unexpected-status' | 'unexpected-body';

// 本文がJSONでなくても状態コードで分類できるよう、解析の失敗は本文なしとして扱う
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function requestDisify(
  options: DisifyClientOptions,
  email: string,
): Promise<DisifyOutcome> {
  // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、変数に取り出して呼ぶ
  const fetcher = options.fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = new Headers();
  if (options.apiKey !== undefined && options.apiKey !== '') {
    headers.set('X-Api-Key', options.apiKey);
  }
  try {
    const response = await fetcher(DISIFY_EMAIL_URL, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ email: toDisposableCheckAddress(email) }),
      signal,
    });
    const json = parseJson(await response.text());
    return { kind: 'response', status: response.status, json };
  } catch {
    // 例外の内容は要求の情報を含み得るため、失敗の種類だけを残す
    return signal.aborted ? { kind: 'timeout' } : { kind: 'network-error' };
  }
}

function undeterminedReason(outcome: DisifyOutcome): UndeterminedReason {
  if (outcome.kind !== 'response') {
    return outcome.kind;
  }
  return outcome.status === 200 ? 'unexpected-body' : 'unexpected-status';
}

export function createDisifyClient(
  options: DisifyClientOptions,
): DisposableEmailChecker {
  const logger = getAppLogger([
    options.appName,
    'identity',
    'disposable-email',
  ]);

  return {
    async check(email: string): Promise<DisposableEmailStatus> {
      const outcome = await requestDisify(options, email);
      const status = classifyDisifyOutcome(outcome);
      if (status === 'undetermined') {
        logger.warn('使い捨てメールアドレスを判定できませんでした', {
          reason: undeterminedReason(outcome),
          ...(outcome.kind === 'response' && { status: outcome.status }),
        });
      }
      return status;
    },
  };
}
