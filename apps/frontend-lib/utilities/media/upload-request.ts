import {
  type MediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  UPLOAD_RELAY_PREFIX,
  type UploadedFile,
} from '../../../common-lib/media/upload-protocol.ts';
import { errorMessageOf } from '../graphql/graphql-result.ts';
import { z } from '../validation/zod.ts';
import type { UploadConstraints } from './upload-constraints.ts';
import {
  rejectionOf,
  UPLOAD_NETWORK_ERROR_MESSAGE,
  UPLOAD_RATE_LIMITED_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
} from './upload-messages.ts';

export interface UploadRequestInput {
  readonly purpose: string;
  readonly body: Blob;
  readonly contentType: MediaType;
  readonly fileName: string;
}

export interface UploadRequest {
  readonly path: string;
  readonly init: RequestInit;
}

export interface UploadResponseContext {
  readonly constraints: UploadConstraints;
  // 問い合わせの画面への導線を持つか。利用者側はCLIENT_PROFILE.contactAvailable、管理者側はADMIN_PROFILE.contactAvailableを渡す
  readonly contactAvailable: boolean;
}

export interface UploadSendOptions extends UploadResponseContext {
  readonly signal?: AbortSignal | undefined;
}

export interface UploadResponseInput {
  readonly status: number;
  readonly body: string;
}

export class UnexpectedUploadResponseError extends Error {
  override readonly name = 'UnexpectedUploadResponseError';
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined) {
    super(
      `アップロードの想定外の応答です(状態コード${String(status)}、エラーコード${code ?? 'なし'})。`,
    );
    this.status = status;
    this.code = code;
  }
}

export interface UploadFailure {
  readonly ok: false;
  readonly message: string;
  readonly retryable: boolean;
  // 想定外の応答の時だけ、エラートラッキングへ送れる例外を添える
  readonly unexpectedError: UnexpectedUploadResponseError | undefined;
}

export type UploadResult =
  { readonly ok: true; readonly file: UploadedFile } | UploadFailure;

export type UploadFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const CREATED = 201;

const TOO_MANY_REQUESTS = 429;

const SERVICE_UNAVAILABLE = 503;

const nullableNonNegativeInteger = z.number().int().nonnegative().nullable();

// 応答の形式は引数の無い許可形式の値だけを受け、画面の型(MediaType)と一致させる
const mediaTypeSchema = z.custom<MediaType>(
  (value) => typeof value === 'string' && parseMediaType(value) === value,
);

const uploadedSchema = z.object({
  data: z.object({
    fileId: z.string(),
    originalFileName: z.string(),
    contentType: mediaTypeSchema,
    byteSize: z.number().int().nonnegative(),
    width: nullableNonNegativeInteger,
    height: nullableNonNegativeInteger,
    objectKey: z.string().nullable(),
  }),
});

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string() }),
});

const decodeJson = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const failure = (message: string, retryable: boolean): UploadFailure => ({
  ok: false,
  message,
  retryable,
  unexpectedError: undefined,
});

// 想定外の応答の値はGraphQLClientErrorでないため、errorMessageOfが問い合わせの導線の有無で固定の文言を選ぶ
const unexpected = (
  status: number,
  code: string | undefined,
  contactAvailable: boolean,
): UploadFailure => {
  const error = new UnexpectedUploadResponseError(status, code);
  return {
    ok: false,
    message: errorMessageOf(error, contactAvailable),
    retryable: false,
    unexpectedError: error,
  };
};

export const buildUploadRequest = (
  input: UploadRequestInput,
): UploadRequest => ({
  path: `${UPLOAD_RELAY_PREFIX}${encodeURIComponent(input.purpose)}`,
  init: {
    method: 'POST',
    // 中継は引数付きの形式を受け付けない場合があるため、許可形式の値そのものを送り、本文のBlobの形式に任せない
    headers: new Headers({
      'content-type': input.contentType,
      [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader(input.fileName),
    }),
    body: input.body,
    credentials: 'same-origin',
  },
});

export const parseUploadResponse = (
  response: UploadResponseInput,
  context: UploadResponseContext,
): UploadResult => {
  const { status } = response;
  const body = decodeJson(response.body);
  if (status === CREATED) {
    const uploaded = uploadedSchema.safeParse(body);
    return uploaded.success
      ? { ok: true, file: uploaded.data.data }
      : unexpected(status, undefined, context.contactAvailable);
  }
  if (status === SERVICE_UNAVAILABLE) {
    return failure(UPLOAD_UNAVAILABLE_MESSAGE, true);
  }
  if (status === TOO_MANY_REQUESTS) {
    return failure(UPLOAD_RATE_LIMITED_MESSAGE, true);
  }
  const envelope = errorEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return unexpected(status, undefined, context.contactAvailable);
  }
  const { code } = envelope.data.error;
  const rejection = rejectionOf(code, context.constraints);
  return rejection === undefined
    ? unexpected(status, code, context.contactAvailable)
    : failure(rejection.message, rejection.retryable);
};

const receive = async (
  fetchFunction: UploadFetch,
  request: UploadRequest,
  signal: AbortSignal | undefined,
): Promise<UploadResponseInput> => {
  const response = await fetchFunction(request.path, {
    ...request.init,
    signal,
  });
  return { status: response.status, body: await response.text() };
};

export const sendUpload = async (
  fetchFunction: UploadFetch,
  input: UploadRequestInput,
  options: UploadSendOptions,
): Promise<UploadResult> => {
  const { signal } = options;
  let received: UploadResponseInput;
  try {
    received = await receive(fetchFunction, buildUploadRequest(input), signal);
  } catch {
    // 呼び出し元の中断は通信の失敗ではないため、再試行やエラーの表示の対象にしない
    if (signal?.aborted === true) {
      throw signal.reason;
    }
    return failure(UPLOAD_NETWORK_ERROR_MESSAGE, true);
  }
  return parseUploadResponse(received, options);
};
