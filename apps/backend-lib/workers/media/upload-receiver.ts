import type { Logger } from '@logtape/logtape';
import { captureException, withScope } from '@sentry/cloudflare';

import type { UploadErrorCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  isImageMediaType,
  type MediaType,
} from '../../../common-lib/media/media-types.ts';
import {
  decodeFileNameHeader,
  type UploadedFile,
} from '../../../common-lib/media/upload-protocol.ts';
import { STATUS_BY_KIND } from '../../core/errors/app-error.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  attachmentDisposition,
  sanitizeFileName,
} from '../../core/media/file-name.ts';
import { detectSignature } from '../../core/media/file-signature.ts';
import {
  DEFAULT_PIXEL_LIMITS,
  DIMENSION_PREFIX_BYTES,
  exceedsPixelLimits,
  type PixelLimits,
  readImageDimensions,
} from '../../core/media/image-dimensions.ts';
import { MODERATE_IMAGE_MESSAGE } from '../../core/media/media-messages.ts';
import { generateObjectKey } from '../../core/media/object-key.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
  NewMediaFileRecord,
  StoredObjectMeta,
  UploadInput,
  UploadOutcome,
  UploadReceiver,
} from '../../core/media/ports.ts';
import { checkSvgSyntax } from '../../core/media/svg-syntax.ts';
import {
  createTextContentCheck,
  TextContentError,
} from '../../core/media/text-content-check.ts';
import {
  precheckUpload,
  UPLOAD_RESEND_MESSAGE,
  type UploadRejection,
} from '../../core/media/upload-precheck.ts';
import type { MediaStorage } from '../../core/media/upload-purpose.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';

export interface MediaUploadReceiverDependencies {
  readonly files: MediaFileStore;
  readonly objects: MediaObjectStore;
  readonly publisher: MessagePublisher;
  readonly ids: IdGenerator;
  readonly appName: LoggingOptions['appName'];
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly pixelLimits?: PixelLimits;
}

const STORAGE_RETRY_AFTER_SECONDS = 5;

const TEXT_MEDIA_TYPE = 'text/plain';

const STORED_TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const FILE_CACHE_CONTROL = 'private, no-store';

const UNREADABLE_MESSAGE =
  'ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。';

const SVG_DECLARATION_MESSAGE =
  'このSVGは読み込めません。編集ソフトでSVGとして書き出し直してから選択してください。';

const DIMENSIONS_EXCEEDED_MESSAGE =
  '画像の縦横の大きさが上限を超えています。小さくしてから選択してください。';

const STORAGE_UNAVAILABLE_MESSAGE =
  '現在ご利用いただけません。しばらく待ってから再度お試しください。';

const LENGTH_MISMATCH: UploadRejection = Object.freeze({
  kind: 'bad_request',
  code: 'content_length_mismatch',
  message: UPLOAD_RESEND_MESSAGE,
});

const STORAGE_UNAVAILABLE: UploadRejection = Object.freeze({
  kind: 'unavailable',
  code: 'storage_unavailable',
  message: STORAGE_UNAVAILABLE_MESSAGE,
  retryAfterSeconds: STORAGE_RETRY_AFTER_SECONDS,
});

const unprocessable = (
  code: UploadErrorCode,
  message: string = UNREADABLE_MESSAGE,
): UploadRejection => Object.freeze({ kind: 'unprocessable', code, message });

const INVALID_TEXT = unprocessable('invalid_text_file');

// オブジェクトストアは上流の例外をそのまま通すため、自前の例外で長さの不一致を保存先の障害と見分ける
class ContentLengthMismatchError extends Error {
  override readonly name = 'ContentLengthMismatchError';

  constructor() {
    super('本文の長さがContent-Lengthと一致しません');
  }
}

class ObjectKeyCollisionError extends Error {
  override readonly name = 'ObjectKeyCollisionError';
}

type Inspection =
  | {
      readonly ok: true;
      readonly width: number | null;
      readonly height: number | null;
    }
  | { readonly ok: false; readonly rejection: UploadRejection };

type PreparedBody =
  | {
      readonly ok: true;
      readonly body: ReadableStream<Uint8Array>;
      readonly width: number | null;
      readonly height: number | null;
    }
  | { readonly ok: false; readonly rejection: UploadRejection };

interface HeadRead {
  readonly bytes: Uint8Array;
  readonly ended: boolean;
}

interface LogContext {
  readonly purpose: string;
  readonly mediaType?: MediaType;
  readonly byteSize?: number;
}

const NO_DIMENSIONS: Inspection = Object.freeze({
  ok: true,
  width: null,
  height: null,
});

const reject = (rejection: UploadRejection): UploadOutcome =>
  Object.freeze({ ok: false, rejection });

const concatChunks = (chunks: readonly Uint8Array[], length: number) => {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

async function readHead(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<HeadRead> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done) {
      return { bytes: concatChunks(chunks, length), ended: true };
    }
    chunks.push(value);
    length += value.length;
  }
  return { bytes: concatChunks(chunks, length), ended: false };
}

// 検査のために読んだ先頭を、まだ読んでいない残りの前に戻して1つの本文にする
function replayStream(
  head: Uint8Array,
  rest: ReadableStreamDefaultReader<Uint8Array> | undefined,
): ReadableStream<Uint8Array> {
  let headSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headSent) {
        headSent = true;
        controller.enqueue(head);
        return;
      }
      const next = rest === undefined ? undefined : await rest.read();
      if (next === undefined || next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel: async (reason: unknown) => rest?.cancel(reason),
  });
}

function lengthCheck(
  declaredLength: number,
): TransformStream<Uint8Array, Uint8Array> {
  let received = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length;
      if (received > declaredLength) {
        throw new ContentLengthMismatchError();
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== declaredLength) {
        throw new ContentLengthMismatchError();
      }
    },
  });
}

function inspectSvg(bytes: Uint8Array): Inspection {
  const syntax = checkSvgSyntax(bytes);
  if (!syntax.ok) {
    return {
      ok: false,
      rejection:
        syntax.code === 'svg_declaration_not_allowed'
          ? unprocessable(syntax.code, SVG_DECLARATION_MESSAGE)
          : unprocessable(syntax.code),
    };
  }
  const dimensions = readImageDimensions(bytes, 'image/svg+xml');
  return dimensions === undefined
    ? NO_DIMENSIONS
    : { ok: true, width: dimensions.width, height: dimensions.height };
}

function inspectHead(
  head: Uint8Array,
  mediaType: Exclude<MediaType, 'text/plain' | 'image/svg+xml'>,
  limits: PixelLimits,
): Inspection {
  if (detectSignature(head) !== mediaType) {
    return { ok: false, rejection: unprocessable('file_type_mismatch') };
  }
  if (!isImageMediaType(mediaType)) {
    return NO_DIMENSIONS;
  }
  const dimensions = readImageDimensions(head, mediaType);
  if (dimensions === undefined) {
    return { ok: false, rejection: unprocessable('image_unreadable') };
  }
  if (exceedsPixelLimits(dimensions, limits)) {
    return {
      ok: false,
      rejection: unprocessable(
        'image_dimensions_exceeded',
        DIMENSIONS_EXCEEDED_MESSAGE,
      ),
    };
  }
  return { ok: true, width: dimensions.width, height: dimensions.height };
}

// SVGは構文の検査に全体が要り、テキストは保存しながら流して検査し、他の形式は先頭(最大1MiB)だけで判定できる
async function prepareBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: number,
  mediaType: MediaType,
  limits: PixelLimits,
): Promise<PreparedBody> {
  if (body === null) {
    return { ok: false, rejection: LENGTH_MISMATCH };
  }
  if (mediaType === TEXT_MEDIA_TYPE) {
    return {
      ok: true,
      body: body
        .pipeThrough(lengthCheck(declaredLength))
        .pipeThrough(createTextContentCheck()),
      width: null,
      height: null,
    };
  }
  const reader = body.getReader();
  // 宣言より1バイト多く読もうとすることで、先頭の範囲に収まる本文の超過を記録の作成の前に見分ける
  const limit =
    mediaType === 'image/svg+xml'
      ? declaredLength + 1
      : Math.min(DIMENSION_PREFIX_BYTES, declaredLength + 1);
  const head = await readHead(reader, limit);
  if (
    head.bytes.length > declaredLength ||
    (head.ended && head.bytes.length < declaredLength)
  ) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, rejection: LENGTH_MISMATCH };
  }
  const inspection =
    mediaType === 'image/svg+xml'
      ? inspectSvg(head.bytes)
      : inspectHead(head.bytes, mediaType, limits);
  if (!inspection.ok) {
    await reader.cancel().catch(() => undefined);
    return inspection;
  }
  return {
    ok: true,
    body: replayStream(head.bytes, head.ended ? undefined : reader).pipeThrough(
      lengthCheck(declaredLength),
    ),
    width: inspection.width,
    height: inspection.height,
  };
}

function storedMetaOf(
  storage: MediaStorage,
  contentType: string,
  fileName: string,
): StoredObjectMeta {
  return storage === 'files'
    ? {
        contentType,
        contentDisposition: attachmentDisposition(fileName),
        cacheControl: FILE_CACHE_CONTROL,
      }
    : { contentType };
}

const defaultRandomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));

export class MediaUploadReceiver implements UploadReceiver {
  private readonly files: MediaFileStore;
  private readonly objects: MediaObjectStore;
  private readonly publisher: MessagePublisher;
  private readonly ids: IdGenerator;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly pixelLimits: PixelLimits;
  private readonly logger: Logger;

  constructor(dependencies: MediaUploadReceiverDependencies) {
    this.files = dependencies.files;
    this.objects = dependencies.objects;
    this.publisher = dependencies.publisher;
    this.ids = dependencies.ids;
    this.randomBytes = dependencies.randomBytes ?? defaultRandomBytes;
    this.pixelLimits = dependencies.pixelLimits ?? DEFAULT_PIXEL_LIMITS;
    this.logger = getAppLogger([dependencies.appName, 'media', 'upload']);
  }

  async receive(input: UploadInput): Promise<UploadOutcome> {
    const { purpose } = input;
    const precheck = precheckUpload(purpose, input);
    if (!precheck.ok) {
      return this.rejected({ purpose: purpose.name }, precheck.rejection);
    }
    const { declaredLength, mediaType } = precheck;
    const context: LogContext = {
      purpose: purpose.name,
      mediaType,
      byteSize: declaredLength,
    };
    const prepared = await prepareBody(
      input.body,
      declaredLength,
      mediaType,
      this.pixelLimits,
    );
    if (!prepared.ok) {
      return this.rejected(context, prepared.rejection);
    }
    const objectKey = generateObjectKey(this.randomBytes);
    const fileName = sanitizeFileName(
      decodeFileNameHeader(input.fileNameHeader),
      mediaType,
    );
    const contentType =
      mediaType === TEXT_MEDIA_TYPE ? STORED_TEXT_CONTENT_TYPE : mediaType;
    const record: NewMediaFileRecord = {
      id: this.ids.generate(),
      objectKey,
      purpose: purpose.name,
      storage: purpose.storage,
      owner: input.uploader,
      originalFileName: fileName,
      contentType,
      byteSize: declaredLength,
      width: prepared.width,
      height: prepared.height,
      moderationStatus:
        purpose.storage === 'images' ? 'pending' : 'not_required',
    };
    try {
      await this.files.insertReceiving(record);
    } catch (error) {
      await prepared.body.cancel().catch(() => undefined);
      return this.unavailable(context, error);
    }
    const failure = await this.store(
      record,
      prepared.body,
      storedMetaOf(purpose.storage, contentType, fileName),
      context,
    );
    if (failure !== undefined) {
      return failure;
    }
    if (purpose.storage === 'images') {
      await this.requestModeration(record.id, context);
    }
    this.logger.info('ファイルのアップロードを受け付けました', {
      ...context,
      fileId: record.id,
      status: 201,
    });
    const file: UploadedFile = {
      fileId: record.id,
      originalFileName: fileName,
      contentType: mediaType,
      byteSize: declaredLength,
      width: prepared.width,
      height: prepared.height,
      objectKey: purpose.storage === 'images' ? objectKey : null,
    };
    return Object.freeze({ ok: true, file: Object.freeze(file) });
  }

  private async store(
    record: NewMediaFileRecord,
    body: ReadableStream<Uint8Array>,
    meta: StoredObjectMeta,
    context: LogContext,
  ): Promise<UploadOutcome | undefined> {
    let result: 'stored' | 'exists';
    try {
      result = await this.objects.putIfAbsent(
        record.storage,
        record.objectKey,
        body,
        record.byteSize,
        meta,
      );
    } catch (error) {
      await this.discard(record, context);
      if (error instanceof ContentLengthMismatchError) {
        return this.rejected(context, LENGTH_MISMATCH);
      }
      if (error instanceof TextContentError) {
        return this.rejected(context, INVALID_TEXT);
      }
      return this.unavailable(context, error);
    }
    // 128ビットの乱数のキーの衝突は乱数源の故障を意味し、条件付きの書き込みの失敗で本文は読み切られて書き直せないため、採り直さずに想定外の例外にする。既にあるオブジェクトは他の記録のものであるため、記録だけを消す
    if (result === 'exists') {
      await this.removeRecord(record.id, context);
      throw new ObjectKeyCollisionError(
        '採番したオブジェクトキーが既存のオブジェクトと衝突しました',
      );
    }
    try {
      await this.files.markStored(record.id);
    } catch (error) {
      await this.discard(record, context);
      return this.unavailable(context, error);
    }
    return undefined;
  }

  // 日次の削除は記録から対象を求めるため、オブジェクトを消せなかった場合は記録を残して両方の削除を任せる
  private async discard(
    record: NewMediaFileRecord,
    context: LogContext,
  ): Promise<void> {
    try {
      await this.objects.delete(record.storage, [record.objectKey]);
    } catch (error) {
      this.logger.warn(
        '受け付けなかったファイルのオブジェクトを消せませんでした',
        {
          ...context,
          error,
          fileId: record.id,
        },
      );
      return;
    }
    await this.removeRecord(record.id, context);
  }

  private async removeRecord(id: string, context: LogContext): Promise<void> {
    try {
      await this.files.remove([id]);
    } catch (error) {
      this.logger.warn('受け付けなかったファイルの記録を消せませんでした', {
        ...context,
        error,
        fileId: id,
      });
    }
  }

  // 判定の依頼の失敗で保存済みのファイルを利用者に送り直させないよう、アップロードは成功させる。記録は判定待ちのまま残る
  private async requestModeration(
    fileId: string,
    context: LogContext,
  ): Promise<void> {
    try {
      await this.publisher.publish(MODERATE_IMAGE_MESSAGE, { fileId });
    } catch (error) {
      // 送信の一時的な失敗は日次の再依頼が依頼し直す。送信前の検証の失敗は呼び出し側の誤りで、日次の再依頼でも同じく失敗するため、運用者が直せるようerrorの水準で知らせる
      const misuse = error instanceof MessagePublishError;
      const attributes = { ...context, error, fileId };
      if (misuse) {
        this.logger.error('画像の判定の依頼を送れませんでした', attributes);
      } else {
        this.logger.warn('画像の判定の依頼を送れませんでした', attributes);
      }
      withScope((scope) => {
        scope.setLevel(misuse ? 'error' : 'warning');
        scope.setTag('media_purpose', context.purpose);
        captureException(error);
      });
    }
  }

  private unavailable(context: LogContext, error: unknown): UploadOutcome {
    this.logger.warn('ファイルの保存先が一時的に利用できません', {
      ...context,
      error,
    });
    return this.rejected(context, STORAGE_UNAVAILABLE);
  }

  private rejected(
    context: LogContext,
    rejection: UploadRejection,
  ): UploadOutcome {
    this.logger.info('ファイルのアップロードを拒否しました', {
      ...context,
      status: STATUS_BY_KIND[rejection.kind],
      code: rejection.code,
    });
    return reject(rejection);
  }
}
