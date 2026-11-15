import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  IMAGE_STORAGE_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  type MediaType,
} from '../../../common-lib/media/media-types.ts';

export type MediaStorage = 'images' | 'files';

export type UploaderKind = 'user' | 'admin';

export interface UploadPurpose {
  readonly name: string;
  readonly storage: MediaStorage;
  readonly uploaderKinds: readonly UploaderKind[];
  readonly allowedTypes: readonly MediaType[];
  readonly maxBytes: number;
}

export interface UploadPurposeRegistry {
  find(name: string): UploadPurpose | undefined;
  list(): readonly UploadPurpose[];
}

export class UploadPurposeError extends Error {
  override readonly name = 'UploadPurposeError';
}

const UPLOAD_PURPOSE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u;

const ALLOWED_TYPES_BY_STORAGE: Readonly<
  Record<MediaStorage, ReadonlySet<MediaType>>
> = Object.freeze({
  images: new Set<MediaType>(IMAGE_MEDIA_TYPES),
  files: new Set<MediaType>(ATTACHMENT_MEDIA_TYPES),
});

const MAX_BYTES_BY_STORAGE: Readonly<Record<MediaStorage, number>> =
  Object.freeze({
    images: IMAGE_STORAGE_MAX_BYTES,
    files: MAX_UPLOAD_BYTES,
  });

const UPLOADER_KINDS: ReadonlySet<string> = new Set<UploaderKind>([
  'user',
  'admin',
]);

const isMediaStorage = (storage: string): storage is MediaStorage =>
  Object.hasOwn(ALLOWED_TYPES_BY_STORAGE, storage);

const fail = (name: string, reason: string): never => {
  throw new UploadPurposeError(
    `アップロードの用途${JSON.stringify(name)}の定義が不正です: ${reason}`,
  );
};

const assertName = (name: string): void => {
  if (!UPLOAD_PURPOSE_NAME_PATTERN.test(name)) {
    fail(name, '名前はハイフンで区切った小文字の英数字にしてください');
  }
};

const assertUploaderKinds = (purpose: UploadPurpose): void => {
  if (purpose.uploaderKinds.length === 0) {
    fail(purpose.name, 'アップロードできる主体の種類を1つ以上指定してください');
  }
  const unknownKind = purpose.uploaderKinds.find(
    (kind) => !UPLOADER_KINDS.has(kind),
  );
  if (unknownKind !== undefined) {
    fail(purpose.name, `未知の主体の種類です: ${JSON.stringify(unknownKind)}`);
  }
};

const assertAllowedTypes = (
  purpose: UploadPurpose,
  storage: MediaStorage,
): void => {
  if (purpose.allowedTypes.length === 0) {
    fail(purpose.name, '許可する形式を1つ以上指定してください');
  }
  const allowedRange = ALLOWED_TYPES_BY_STORAGE[storage];
  const outOfRange = purpose.allowedTypes.find(
    (type) => !allowedRange.has(type),
  );
  if (outOfRange !== undefined) {
    fail(
      purpose.name,
      `保存先${storage}で許可できない形式です: ${JSON.stringify(outOfRange)}`,
    );
  }
};

const assertMaxBytes = (
  purpose: UploadPurpose,
  storage: MediaStorage,
): void => {
  const limit = MAX_BYTES_BY_STORAGE[storage];
  if (
    !Number.isSafeInteger(purpose.maxBytes) ||
    purpose.maxBytes < 1 ||
    purpose.maxBytes > limit
  ) {
    fail(
      purpose.name,
      `上限サイズは1〜${String(limit)}バイトの整数にしてください: ${String(purpose.maxBytes)}`,
    );
  }
};

const freezePurpose = (purpose: UploadPurpose): UploadPurpose =>
  Object.freeze({
    name: purpose.name,
    storage: purpose.storage,
    uploaderKinds: Object.freeze([...purpose.uploaderKinds]),
    allowedTypes: Object.freeze([...purpose.allowedTypes]),
    maxBytes: purpose.maxBytes,
  });

export function defineUploadPurpose(purpose: UploadPurpose): UploadPurpose {
  assertName(purpose.name);
  if (!isMediaStorage(purpose.storage)) {
    return fail(
      purpose.name,
      `未知の保存先です: ${JSON.stringify(purpose.storage)}`,
    );
  }
  assertUploaderKinds(purpose);
  assertAllowedTypes(purpose, purpose.storage);
  assertMaxBytes(purpose, purpose.storage);
  return freezePurpose(purpose);
}

export function createUploadPurposeRegistry(
  purposes: readonly UploadPurpose[],
): UploadPurposeRegistry {
  const byName = new Map<string, UploadPurpose>();
  for (const purpose of purposes) {
    if (byName.has(purpose.name)) {
      fail(purpose.name, '同じ名前の用途が既に登録されています');
    }
    byName.set(purpose.name, purpose);
  }
  const list = Object.freeze([...purposes]);
  return Object.freeze({
    find: (name: string): UploadPurpose | undefined => byName.get(name),
    list: (): readonly UploadPurpose[] => list,
  });
}

// 動作確認の経路は利用者・管理者のどちらのセッションも持たずトークンで呼ぶため、主体の種類を空にして登録表の外に置く
export const MEDIA_SMOKE_PURPOSE: UploadPurpose = freezePurpose({
  name: 'media-smoke',
  storage: 'images',
  uploaderKinds: [],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 5_242_880,
});
