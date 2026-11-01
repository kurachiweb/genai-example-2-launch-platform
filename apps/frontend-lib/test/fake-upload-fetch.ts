import { expect, vi } from 'vitest';

import { parseMediaType } from '../../common-lib/media/media-types.ts';
import type { UploadedFile } from '../../common-lib/media/upload-protocol.ts';

export type UploadReply =
  | { readonly status: number; readonly body: unknown }
  | { readonly networkError: true };

export interface RecordedUpload {
  readonly path: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly fileNameHeader: string | null;
  readonly body: Blob;
  readonly signal: AbortSignal | undefined;
}

export interface UploadFetchStub {
  readonly calls: readonly RecordedUpload[];
  // 最も古い未応答の要求に応える。要求が届くまで待つ
  readonly reply: (reply: UploadReply) => Promise<void>;
  readonly pendingCount: () => number;
}

interface PendingRequest {
  readonly resolve: (response: Response) => void;
  readonly reject: (reason: unknown) => void;
}

export const uploadedReply = (
  file: File,
  fileId: string,
  size: { readonly width: number; readonly height: number } | null = null,
): UploadReply => ({
  status: 201,
  body: { data: uploadedFileOf(file, fileId, size) },
});

export const errorReply = (status: number, code: string): UploadReply => ({
  status,
  body: { error: { code, message: code } },
});

const bodyOf = (init: RequestInit): Blob => {
  if (!(init.body instanceof Blob)) {
    throw new TypeError('アップロードの本文がBlobではありません。');
  }
  return init.body;
};

// 画面の部品が呼ぶ大域のfetchを差し替え、要求を記録して、テストが応答を返すまで待たせる
export function stubUploadFetch(): UploadFetchStub {
  const calls: RecordedUpload[] = [];
  const pending: PendingRequest[] = [];
  const fakeFetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        const headers = new Headers(init.headers);
        const signal = init.signal ?? undefined;
        calls.push({
          path: input instanceof Request ? input.url : input.toString(),
          method: init.method,
          contentType: headers.get('content-type'),
          fileNameHeader: headers.get('x-upload-file-name'),
          body: bodyOf(init),
          signal,
        });
        const request: PendingRequest = { resolve, reject };
        pending.push(request);
        signal?.addEventListener('abort', () => {
          pending.splice(pending.indexOf(request), 1);
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException('中断しました。', 'AbortError'),
          );
        });
      }),
  );
  vi.stubGlobal('fetch', fakeFetch);
  return {
    calls,
    pendingCount: () => pending.length,
    reply: async (reply) => {
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      const request = pending.shift();
      if (request === undefined) {
        throw new Error('応える要求がありません。');
      }
      if ('networkError' in reply) {
        request.reject(new TypeError('Failed to fetch'));
        return;
      }
      request.resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

export const uploadedFileOf = (
  file: File,
  fileId: string,
  size: { readonly width: number; readonly height: number } | null = null,
): UploadedFile => {
  const contentType = parseMediaType(file.type);
  if (contentType === undefined) {
    throw new TypeError(`許可形式でないファイルです: ${file.type}`);
  }
  return {
    fileId,
    originalFileName: file.name,
    contentType,
    byteSize: file.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
    objectKey: null,
  };
};
