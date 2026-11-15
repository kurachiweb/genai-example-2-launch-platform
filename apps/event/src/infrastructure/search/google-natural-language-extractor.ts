import {
  ANALYZE_ENTITIES_ENDPOINT,
  buildAnalyzeEntitiesRequest,
  interpretAnalyzeEntitiesResponse,
} from '../../../lib/core/search/natural-language-protocol.ts';
import type {
  KeywordExtractionOutcome,
  KeywordExtractor,
} from '../../../lib/core/search/ports.ts';

const DEFAULT_TIMEOUT_MS = 10_000;

// 本文がJSONでなくても状態コードで分類できるよう、解析の失敗は本文なしとして扱う。読み取り中の通信の失敗と打ち切りは呼び出し側へ伝える
async function readJsonBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export class GoogleNaturalLanguageExtractor implements KeywordExtractor {
  readonly #apiKey: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(
    apiKey: string,
    fetcher: typeof fetch,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.#apiKey = apiKey;
    this.#fetcher = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  async extract(text: string): Promise<KeywordExtractionOutcome> {
    // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、変数に取り出して呼ぶ
    const fetcher = this.#fetcher;
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await fetcher(ANALYZE_ENTITIES_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.#apiKey,
        },
        body: JSON.stringify(buildAnalyzeEntitiesRequest(text)),
        signal,
      });
      const body = await readJsonBody(response);
      return interpretAnalyzeEntitiesResponse(response.status, body);
    } catch {
      // 例外の内容は要求の情報を含み得るため、結果には失敗の種類だけを残す
      return {
        kind: 'temporary-failure',
        reason: signal.aborted ? 'timeout' : 'network',
      };
    }
  }
}
