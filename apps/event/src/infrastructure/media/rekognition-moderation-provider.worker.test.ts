import { AwsV4Signer } from 'aws4fetch';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  ModerationImage,
  ModerationOutcome,
} from '../../application/media/ports.ts';
import { RekognitionModerationProvider } from './rekognition-moderation-provider.ts';

// シークレット検出の誤検知を避けるため、資格情報の形をした値を直書きせずに組み立てる
const ACCESS_KEY_ID = ['test', 'rekognition', 'access', 'id'].join('-');
const SECRET_ACCESS_KEY = [
  'test',
  'rekognition',
  'secret',
  'must',
  'not',
  'leak',
].join('-');
const REGION = 'us-east-1';
const ENDPOINT = 'https://rekognition.us-east-1.amazonaws.com/';
const MIN_CONFIDENCE = 60;

const IMAGE: ModerationImage = {
  bytes: Uint8Array.from([1, 2, 3, 250, 251, 252]),
  format: 'png',
};
const IMAGE_BASE64 = 'AQID+vv8';

type FetcherImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function createFetcher(respond: FetcherImplementation) {
  const spy = vi.fn<FetcherImplementation>(respond);
  return { fetcher: spy as typeof spy & typeof fetch, spy };
}

function respondWith(response: () => Response) {
  return createFetcher(() => Promise.resolve(response()));
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/x-amz-json-1.1', ...headers },
  });
}

function awsError(type: string, status: number, message = 'error'): Response {
  return jsonResponse({ __type: type, Message: message }, status);
}

// 打ち切りの信号を受けるまで応答せず、信号の理由で失敗する通信を再現する
function waitForAbort(_input: RequestInfo | URL, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

function createProvider(fetcher: typeof fetch, timeoutMs?: number) {
  return new RekognitionModerationProvider({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    region: REGION,
    fetcher,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function detectWith(
  fetcher: typeof fetch,
  timeoutMs?: number,
): Promise<ModerationOutcome> {
  return createProvider(fetcher, timeoutMs).detect(IMAGE, MIN_CONFIDENCE);
}

function sentRequestOf(spy: ReturnType<typeof createFetcher>['spy']): Request {
  const [input, init] = spy.mock.calls[0] ?? [];
  return new Request(input ?? '', init);
}

const EMPTY_LABELS = () =>
  jsonResponse({ ModerationLabels: [], ModerationModelVersion: '7.0' }, 200);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RekognitionModerationProviderの要求', () => {
  test('リージョンのエンドポイントへ、DetectModerationLabelsの対象とJSONの形式を指定して送る', async () => {
    const { fetcher, spy } = respondWith(EMPTY_LABELS);

    await detectWith(fetcher);

    expect(spy).toHaveBeenCalledTimes(1);
    const request = sentRequestOf(spy);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(ENDPOINT);
    expect(request.headers.get('content-type')).toBe(
      'application/x-amz-json-1.1',
    );
    expect(request.headers.get('x-amz-target')).toBe(
      'RekognitionService.DetectModerationLabels',
    );
  });

  test('本文はbase64の判定用画像と閾値だけで、ファイル名・主体などを含まない', async () => {
    const { fetcher, spy } = respondWith(EMPTY_LABELS);

    await detectWith(fetcher);

    expect(await sentRequestOf(spy).json()).toStrictEqual({
      Image: { Bytes: IMAGE_BASE64 },
      MinConfidence: MIN_CONFIDENCE,
    });
  });

  test('サービスrekognitionとリージョンの資格情報の範囲で、対象のヘッダーと送った本文にSigV4の署名を付ける', async () => {
    const { fetcher, spy } = respondWith(EMPTY_LABELS);

    await detectWith(fetcher);

    const request = sentRequestOf(spy);
    const datetime = request.headers.get('x-amz-date') ?? '';
    expect(datetime).toMatch(/^\d{8}T\d{6}Z$/);
    const authorization = request.headers.get('authorization') ?? '';
    expect(authorization).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${datetime.slice(0, 8)}/us-east-1/rekognition/aws4_request, SignedHeaders=host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$`,
      ),
    );
    const expected = await new AwsV4Signer({
      method: 'POST',
      url: ENDPOINT,
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'RekognitionService.DetectModerationLabels',
      },
      body: await request.text(),
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      service: 'rekognition',
      region: REGION,
      datetime,
    }).authHeader();
    expect(authorization).toBe(expected);
  });

  test('秘密のアクセスキーをURL・ヘッダー・本文のどこにも含めない', async () => {
    const { fetcher, spy } = respondWith(EMPTY_LABELS);

    await detectWith(fetcher);

    const request = sentRequestOf(spy);
    expect(request.url).not.toContain(SECRET_ACCESS_KEY);
    for (const [, value] of request.headers) {
      expect(value).not.toContain(SECRET_ACCESS_KEY);
    }
    expect(await request.text()).not.toContain(SECRET_ACCESS_KEY);
  });

  test('受け取ったfetchを1回だけ、別のオブジェクトのメソッドとしてではなく呼び、打ち切りの信号を渡す', async () => {
    const { fetcher, spy } = respondWith(() =>
      awsError('ThrottlingException', 400),
    );

    await detectWith(fetcher);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts).toEqual([undefined]);
    expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('打ち切りの時間の既定は10秒である', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetcher } = respondWith(EMPTY_LABELS);

    await detectWith(fetcher);

    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});

describe('RekognitionModerationProviderのラベルの応答の変換', () => {
  test('ラベルの名前・親の名前・信頼度・階層を変換し、他の項目を捨てる', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse(
        {
          ModerationLabels: [
            {
              Confidence: 97.5,
              Name: 'Explicit',
              ParentName: '',
              TaxonomyLevel: 1,
            },
            {
              Confidence: 96.25,
              Name: 'Explicit Nudity',
              ParentName: 'Explicit',
              TaxonomyLevel: 2,
            },
            {
              Confidence: 90,
              Name: 'Exposed Male Genitalia',
              ParentName: 'Explicit Nudity',
              TaxonomyLevel: 3,
            },
          ],
          ModerationModelVersion: '7.0',
          ContentTypes: [{ Confidence: 80, Name: 'Animated' }],
        },
        200,
      ),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'labels',
      labels: [
        {
          name: 'Explicit',
          parentName: '',
          confidence: 97.5,
          taxonomyLevel: 1,
        },
        {
          name: 'Explicit Nudity',
          parentName: 'Explicit',
          confidence: 96.25,
          taxonomyLevel: 2,
        },
        {
          name: 'Exposed Male Genitalia',
          parentName: 'Explicit Nudity',
          confidence: 90,
          taxonomyLevel: 3,
        },
      ],
    });
  });

  test('親の名前が無いラベルは最上位として空文字にする', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse(
        {
          ModerationLabels: [
            { Confidence: 70, Name: 'Gambling', TaxonomyLevel: 1 },
          ],
        },
        200,
      ),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'labels',
      labels: [
        {
          name: 'Gambling',
          parentName: '',
          confidence: 70,
          taxonomyLevel: 1,
        },
      ],
    });
  });

  test('空のラベルの一覧は検出なしにする', async () => {
    const { fetcher } = respondWith(EMPTY_LABELS);

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'labels',
      labels: [],
    });
  });

  // 判定サービスは検出が無い時も空の一覧を返すため、一覧の欠けた応答を検出なしとして公開側へ倒さない
  test.each<[string, () => Response]>([
    [
      'ラベルの一覧が無い本文',
      () => jsonResponse({ ModerationModelVersion: '7.0' }, 200),
    ],
    ['JSONでない本文', () => new Response('<html>ok</html>', { status: 200 })],
    ['オブジェクトでない本文', () => jsonResponse([], 200)],
    [
      '配列でないラベルの一覧',
      () => jsonResponse({ ModerationLabels: 'Explicit' }, 200),
    ],
    [
      '名前の無いラベル',
      () =>
        jsonResponse(
          { ModerationLabels: [{ Confidence: 99, TaxonomyLevel: 1 }] },
          200,
        ),
    ],
    [
      '信頼度が数値でないラベル',
      () =>
        jsonResponse(
          {
            ModerationLabels: [
              { Confidence: '99', Name: 'Explicit', TaxonomyLevel: 1 },
            ],
          },
          200,
        ),
    ],
    [
      '信頼度が0〜100の外のラベル',
      () =>
        jsonResponse(
          {
            ModerationLabels: [
              { Confidence: 101, Name: 'Explicit', TaxonomyLevel: 1 },
            ],
          },
          200,
        ),
    ],
    [
      '親の名前が文字列でないラベル',
      () =>
        jsonResponse(
          {
            ModerationLabels: [
              {
                Confidence: 99,
                Name: 'Explicit Nudity',
                ParentName: 1,
                TaxonomyLevel: 2,
              },
            ],
          },
          200,
        ),
    ],
    [
      '階層が無いラベル',
      () =>
        jsonResponse(
          { ModerationLabels: [{ Confidence: 99, Name: 'Explicit' }] },
          200,
        ),
    ],
  ])(
    '200で%sの応答は判定サービスの一時的な失敗にする',
    async (_label, response) => {
      const { fetcher } = respondWith(response);

      expect(await detectWith(fetcher)).toStrictEqual({
        kind: 'transient',
        reason: 'service-error',
      });
    },
  );
});

describe('RekognitionModerationProviderのエラーの分類', () => {
  test.each<[string, number, ModerationOutcome]>([
    ['ThrottlingException', 400, { kind: 'transient', reason: 'throttled' }],
    [
      'ProvisionedThroughputExceededException',
      400,
      { kind: 'transient', reason: 'throttled' },
    ],
    ['LimitExceededException', 400, { kind: 'transient', reason: 'throttled' }],
    [
      'InternalServerError',
      500,
      { kind: 'transient', reason: 'service-error' },
    ],
    ['ImageTooLargeException', 400, { kind: 'rejected', reason: 'too-large' }],
    [
      'InvalidImageFormatException',
      400,
      { kind: 'rejected', reason: 'invalid-image' },
    ],
    [
      'InvalidParameterException',
      400,
      { kind: 'rejected', reason: 'invalid-parameter' },
    ],
    [
      'AccessDeniedException',
      400,
      { kind: 'transient', reason: 'misconfigured' },
    ],
    [
      'UnrecognizedClientException',
      400,
      { kind: 'transient', reason: 'misconfigured' },
    ],
    [
      'InvalidSignatureException',
      403,
      { kind: 'transient', reason: 'misconfigured' },
    ],
  ])('%s(%d)を分類する', async (type, status, expected) => {
    const { fetcher } = respondWith(() => awsError(type, status));

    expect(await detectWith(fetcher)).toStrictEqual(expected);
  });

  test('名前空間付きの種類の名前も分類する', async () => {
    const { fetcher } = respondWith(() =>
      awsError('com.amazonaws.rekognition#ImageTooLargeException', 400),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'rejected',
      reason: 'too-large',
    });
  });

  test('本文のcodeの種類の名前も分類する', async () => {
    const { fetcher } = respondWith(() =>
      jsonResponse({ code: 'InvalidImageFormatException' }, 400),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'rejected',
      reason: 'invalid-image',
    });
  });

  test('本文がJSONでなくても、ヘッダーの種類の名前で分類する', async () => {
    const { fetcher } = respondWith(
      () =>
        new Response('Rate exceeded', {
          status: 400,
          headers: {
            'x-amzn-ErrorType':
              'ThrottlingException:http://internal.amazon.com/coral/com.amazonaws.rekognition/',
          },
        }),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'transient',
      reason: 'throttled',
    });
  });

  test.each<[string, number, ModerationOutcome]>([
    [
      '種類の名前の無い503',
      503,
      { kind: 'transient', reason: 'service-error' },
    ],
    ['種類の名前の無い429', 429, { kind: 'transient', reason: 'throttled' }],
    [
      '種類の名前の無い404',
      404,
      { kind: 'transient', reason: 'misconfigured' },
    ],
    [
      '種類の名前の無い302',
      302,
      { kind: 'transient', reason: 'misconfigured' },
    ],
  ])('%sを状態コードで分類する', async (_label, status, expected) => {
    const { fetcher } = respondWith(
      () => new Response('Service Unavailable', { status }),
    );

    expect(await detectWith(fetcher)).toStrictEqual(expected);
  });

  test.each<[string, number, ModerationOutcome]>([
    ['未知の種類の400', 400, { kind: 'transient', reason: 'misconfigured' }],
    ['未知の種類の500', 500, { kind: 'transient', reason: 'service-error' }],
  ])('%sを状態コードで分類する', async (_label, status, expected) => {
    const { fetcher } = respondWith(() =>
      awsError('SomeFutureException', status),
    );

    expect(await detectWith(fetcher)).toStrictEqual(expected);
  });
});

describe('RekognitionModerationProviderの通信の失敗', () => {
  test('打ち切りの時間を過ぎた要求は時間切れの一時的な失敗にする', async () => {
    const { fetcher } = createFetcher(waitForAbort);

    expect(await detectWith(fetcher, 5)).toStrictEqual({
      kind: 'transient',
      reason: 'timeout',
    });
  });

  test('通信の例外は通信の一時的な失敗にする', async () => {
    const { fetcher } = createFetcher(() =>
      Promise.reject(new TypeError('Network connection lost.')),
    );

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'transient',
      reason: 'network',
    });
  });

  test('応答の本文を読む途中の失敗は通信の一時的な失敗にする', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('stream reset'));
      },
    });
    const { fetcher } = respondWith(() => new Response(body, { status: 200 }));

    expect(await detectWith(fetcher)).toStrictEqual({
      kind: 'transient',
      reason: 'network',
    });
  });
});

describe('RekognitionModerationProviderの資格情報の秘匿', () => {
  const consoleSpies = () => [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
  ];

  test('資格情報を含む通信の例外も、例外にせず資格情報を含まない結果にし、ログへ出さない', async () => {
    const spies = consoleSpies();
    const { fetcher } = createFetcher(() =>
      Promise.reject(
        new Error(`signing failed ${ACCESS_KEY_ID} ${SECRET_ACCESS_KEY}`),
      ),
    );

    const outcome = await detectWith(fetcher);

    expect(outcome).toStrictEqual({ kind: 'transient', reason: 'network' });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test('資格情報を含む誤りの応答も、資格情報を含まない結果にし、ログへ出さない', async () => {
    const spies = consoleSpies();
    const { fetcher } = respondWith(() =>
      awsError(
        'UnrecognizedClientException',
        400,
        `The security token ${ACCESS_KEY_ID} ${SECRET_ACCESS_KEY} is invalid.`,
      ),
    );

    const outcome = await detectWith(fetcher);

    expect(outcome).toStrictEqual({
      kind: 'transient',
      reason: 'misconfigured',
    });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test('実装のオブジェクトを文字列にしても資格情報が出ない', () => {
    const { fetcher } = respondWith(EMPTY_LABELS);

    const provider = createProvider(fetcher);

    const serialized = `${JSON.stringify(provider)} ${JSON.stringify(Object.entries(provider))}`;
    expect(serialized).not.toContain(ACCESS_KEY_ID);
    expect(serialized).not.toContain(SECRET_ACCESS_KEY);
  });
});
