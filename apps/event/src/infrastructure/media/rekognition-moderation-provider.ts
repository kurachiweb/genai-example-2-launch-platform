import { AwsClient } from 'aws4fetch';
import { z } from 'zod';

import type {
  ModerationImage,
  ModerationLabel,
  ModerationOutcome,
  ModerationProvider,
} from '../../application/media/ports.ts';

export interface RekognitionModerationProviderOptions {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly fetcher: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SERVICE = 'rekognition';
const TARGET = 'RekognitionService.DetectModerationLabels';
const CONTENT_TYPE = 'application/x-amz-json-1.1';
const ERROR_TYPE_HEADER = 'x-amzn-errortype';
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_MIN = 500;

type FailureOutcome = Exclude<ModerationOutcome, { kind: 'labels' }>;

const THROTTLED: FailureOutcome = { kind: 'transient', reason: 'throttled' };
const SERVICE_ERROR: FailureOutcome = {
  kind: 'transient',
  reason: 'service-error',
};
const MISCONFIGURED: FailureOutcome = {
  kind: 'transient',
  reason: 'misconfigured',
};

// 種類の名前の無い失敗や未知の種類は状態コードで分類し、資格情報・権限・署名の誤りは設定の誤りとして再試行と通知に回す
const OUTCOME_BY_ERROR_TYPE: ReadonlyMap<string, FailureOutcome> = new Map<
  string,
  FailureOutcome
>([
  ['ThrottlingException', THROTTLED],
  ['ProvisionedThroughputExceededException', THROTTLED],
  ['LimitExceededException', THROTTLED],
  ['InternalServerError', SERVICE_ERROR],
  ['ImageTooLargeException', { kind: 'rejected', reason: 'too-large' }],
  [
    'InvalidImageFormatException',
    { kind: 'rejected', reason: 'invalid-image' },
  ],
  [
    'InvalidParameterException',
    { kind: 'rejected', reason: 'invalid-parameter' },
  ],
  ['AccessDeniedException', MISCONFIGURED],
  ['UnrecognizedClientException', MISCONFIGURED],
  ['InvalidSignatureException', MISCONFIGURED],
]);

const moderationLabelSchema = z.object({
  Name: z.string().min(1),
  ParentName: z.string().optional(),
  Confidence: z.number().min(0).max(100),
  TaxonomyLevel: z.number().int().positive(),
});

// 判定サービスは検出が無い時も空の一覧を返すため、一覧の欠けた応答は不正とみなして検出なし(公開のまま)に倒さない
const detectModerationLabelsResponseSchema = z.object({
  ModerationLabels: z.array(moderationLabelSchema),
});

const errorBodySchema = z.object({
  __type: z.string().optional(),
  code: z.string().optional(),
});

function rekognitionEndpointOf(region: string): string {
  return `https://${SERVICE}.${region}.amazonaws.com/`;
}

// 本文がJSONでなくても状態コードとヘッダーで分類できるよう、解析の失敗は本文なしとして扱う。読み取り中の通信の失敗と打ち切りは呼び出し側へ伝える
async function readJsonBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

// 種類の名前は「名前空間#名前」や「名前:URI」の形でも返るため、名前の部分だけを取り出す
function errorTypeOf(response: Response, body: unknown): string | undefined {
  const parsed = errorBodySchema.safeParse(body);
  const raw =
    response.headers.get(ERROR_TYPE_HEADER) ??
    (parsed.success ? (parsed.data.__type ?? parsed.data.code) : undefined);
  if (raw === undefined) {
    return undefined;
  }
  const [withoutUri = ''] = raw.split(':');
  return withoutUri.slice(withoutUri.lastIndexOf('#') + 1);
}

function classifyFailure(response: Response, body: unknown): FailureOutcome {
  const type = errorTypeOf(response, body);
  const known =
    type === undefined ? undefined : OUTCOME_BY_ERROR_TYPE.get(type);
  if (known !== undefined) {
    return known;
  }
  if (response.status === TOO_MANY_REQUESTS) {
    return THROTTLED;
  }
  return response.status >= SERVER_ERROR_MIN ? SERVICE_ERROR : MISCONFIGURED;
}

function toLabels(body: unknown): ModerationOutcome {
  const parsed = detectModerationLabelsResponseSchema.safeParse(body);
  if (!parsed.success) {
    return SERVICE_ERROR;
  }
  const labels = parsed.data.ModerationLabels.map((label): ModerationLabel => ({
    name: label.Name,
    parentName: label.ParentName ?? '',
    confidence: label.Confidence,
    taxonomyLevel: label.TaxonomyLevel,
  }));
  return { kind: 'labels', labels };
}

function interpretResponse(
  response: Response,
  body: unknown,
): ModerationOutcome {
  return response.ok ? toLabels(body) : classifyFailure(response, body);
}

export class RekognitionModerationProvider implements ModerationProvider {
  readonly #client: AwsClient;
  readonly #endpoint: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: RekognitionModerationProviderOptions) {
    // AwsClient.fetchは大域のfetchで最大10回まで自前で再試行するため、署名だけに使い、再試行はメッセージの再試行の方針に任せる
    this.#client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: SERVICE,
      region: options.region,
      retries: 0,
    });
    this.#endpoint = rekognitionEndpointOf(options.region);
    this.#fetcher = options.fetcher;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async detect(
    image: ModerationImage,
    minConfidence: number,
  ): Promise<ModerationOutcome> {
    const request = await this.#client.sign(this.#endpoint, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE, 'x-amz-target': TARGET },
      body: JSON.stringify({
        Image: { Bytes: image.bytes.toBase64() },
        MinConfidence: minConfidence,
      }),
    });
    // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、変数に取り出して呼ぶ
    const fetcher = this.#fetcher;
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await fetcher(request, { signal });
      const body = await readJsonBody(response);
      return interpretResponse(response, body);
    } catch {
      // 例外の内容は署名した要求の情報を含み得るため、結果には失敗の種類だけを残す
      return {
        kind: 'transient',
        reason: signal.aborted ? 'timeout' : 'network',
      };
    }
  }
}
