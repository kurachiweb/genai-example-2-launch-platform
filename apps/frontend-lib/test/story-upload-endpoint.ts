import { UPLOAD_RELAY_PREFIX } from '../../common-lib/media/upload-protocol.ts';

export type StoryUploadOutcome =
  'success' | 'unavailable' | 'rejected' | 'unexpected';

const RESPONSE_DELAY_MS = 800;

const ERROR_BODIES: Readonly<
  Record<Exclude<StoryUploadOutcome, 'success'>, readonly [number, string]>
> = {
  unavailable: [503, 'storage_unavailable'],
  rejected: [422, 'image_unreadable'],
  unexpected: [500, 'internal_error'],
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const delay = async (signal: AbortSignal | null | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, RESPONSE_DELAY_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('中断しました。', 'AbortError'),
      );
    });
  });

const fileNameOf = (init: RequestInit | undefined): string => {
  const encoded = new Headers(init?.headers).get('x-upload-file-name') ?? '';
  return decodeURIComponent(encoded);
};

let uploadCount = 0;

// カタログのアップロードの入力欄が外部へ送らないよう、アップロードの中継の経路への要求だけを偽の応答にする。戻り値で元のfetchへ戻す
export function installStoryUploadEndpoint(
  outcome: StoryUploadOutcome,
): () => void {
  const original = globalThis.fetch;
  const fakeFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(UPLOAD_RELAY_PREFIX)) {
      return original(input, init);
    }
    await delay(init?.signal);
    if (outcome !== 'success') {
      const [status, code] = ERROR_BODIES[outcome];
      return jsonResponse(status, { error: { code, message: code } });
    }
    uploadCount += 1;
    const body = init?.body;
    return jsonResponse(201, {
      data: {
        fileId: `story-file-${String(uploadCount)}`,
        originalFileName: fileNameOf(init),
        contentType: new Headers(init?.headers).get('content-type'),
        byteSize: body instanceof Blob ? body.size : 0,
        width: null,
        height: null,
        objectKey: null,
      },
    });
  };
  // 実行環境ごとにfetchの型が持つ付属の関数が異なるため、型の一致を求めずに差し替える
  Reflect.set(globalThis, 'fetch', fakeFetch);
  return () => {
    Reflect.set(globalThis, 'fetch', original);
  };
}
