import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import type {
  MediaFileView,
  MediaLocation,
  MediaOwner,
  ModerationFinding,
  QuarantineReason,
} from './media-file.ts';
import type { UploadRejection } from './upload-precheck.ts';
import type {
  MediaStorage,
  UploaderKind,
  UploadPurpose,
} from './upload-purpose.ts';

export interface ClaimRequest {
  readonly fileIds: readonly string[];
  readonly purpose: string;
  readonly owner: { readonly kind: UploaderKind; readonly id: string };
}

export type ClaimFailureReason =
  | 'not_found'
  | 'not_stored'
  | 'deleted'
  | 'purpose_mismatch'
  | 'owner_mismatch';

export interface ClaimFailure {
  readonly fileId: string;
  readonly reason: ClaimFailureReason;
}

export type ClaimResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: readonly ClaimFailure[] };

export interface EraseSummary {
  readonly erased: number;
}

export interface MediaContent {
  readonly file: MediaFileView;
  readonly body: ReadableStream<Uint8Array>;
}

export interface OwnerRef {
  readonly kind: UploaderKind;
  readonly id: string;
}

export const OWNER_OPERATION_BATCH_LIMIT = 1000;

// hasMoreが真なら、呼び出し元が同じ操作を繰り返す。対象は呼び出しのたびにD1の状態から求め直すため、進み具合を持ち回らない
export interface OwnerBatchResult {
  readonly processed: number;
  readonly hasMore: boolean;
}

export const OWNER_ID_LIST_MAX_LIMIT = 500;

export interface OwnerIdListInput {
  readonly kind: UploaderKind;
  // 前の呼び出しのnext。この値を含まず、より後の識別子から返す
  readonly after: string | undefined;
  readonly limit: number;
}

export interface OwnerIdList {
  readonly ownerIds: readonly string[];
  readonly next: string | undefined;
}

export interface MediaFiles {
  claim(request: ClaimRequest): Promise<ClaimResult>;
  // 論理削除済みのファイルは日時を変えない
  markDeleted(fileIds: readonly string[]): Promise<void>;
  // 先に削除待ちの印を付けるため、途中で失敗してAppError(unavailable)を投げても日次バッチが物理削除を完了させる
  eraseNow(fileIds: readonly string[]): Promise<EraseSummary>;
  // 保有者の全ファイル(全用途・隔離中を含む)を最大OWNER_OPERATION_BATCH_LIMIT件ずつ物理削除する
  eraseOwnedBy(owner: OwnerRef): Promise<OwnerBatchResult>;
  // ファイルの状態によらず重複の無い昇順で返し、limitが1〜OWNER_ID_LIST_MAX_LIMITの整数でなければAppError(bad_request)を投げる
  listOwnerIds(input: OwnerIdListInput): Promise<OwnerIdList>;
  findMany(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, MediaFileView>>;
  // 保存完了・未削除・削除待ちでない・隔離中でないファイルだけを読み出す
  openContent(fileId: string): Promise<MediaContent | undefined>;
}

export interface QuarantinedImage {
  readonly file: MediaFileView;
  readonly quarantinedAt: Date;
  readonly findings: readonly ModerationFinding[];
}

export const QUARANTINED_IMAGE_LIST_MAX_LIMIT = 100;

export interface QuarantinedImageListInput {
  readonly reason: QuarantineReason;
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface QuarantinedImageList {
  readonly items: readonly QuarantinedImage[];
  readonly nextCursor: string | undefined;
}

// 理由をD1に確定させてから移動を依頼し、依頼の送信に失敗したらAppError(unavailable)を投げる。呼び出し元は同じ操作を再実行できる
export interface MediaQuarantine {
  // 画像用の用途でないファイルを含むとAppError(bad_request)を投げる
  addReason(
    fileIds: readonly string[],
    reason: QuarantineReason,
  ): Promise<void>;
  removeReason(
    fileIds: readonly string[],
    reason: QuarantineReason,
  ): Promise<void>;
  addReasonForOwner(
    owner: OwnerRef,
    reason: QuarantineReason,
  ): Promise<OwnerBatchResult>;
  removeReasonForOwner(
    owner: OwnerRef,
    reason: QuarantineReason,
  ): Promise<OwnerBatchResult>;
  // limitが1〜QUARANTINED_IMAGE_LIST_MAX_LIMITの整数でなければAppError(bad_request)を投げる
  listByReason(input: QuarantinedImageListInput): Promise<QuarantinedImageList>;
}

export interface MediaEraser {
  erase(fileIds: readonly string[]): Promise<EraseSummary>;
}

export interface NewMediaFileRecord {
  readonly id: string;
  readonly objectKey: string;
  readonly purpose: string;
  readonly storage: MediaStorage;
  readonly owner: MediaOwner;
  readonly originalFileName: string;
  // テキストは文字コードの引数付きのtext/plain; charset=utf-8で記録する
  readonly contentType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly moderationStatus: 'not_required' | 'pending';
}

export type ModerationRecord =
  | { readonly verdict: 'passed' }
  | {
      readonly verdict: 'flagged';
      readonly findings: readonly ModerationFinding[];
    }
  | { readonly verdict: 'undetermined' };

export interface OwnedImageQuery {
  readonly owner: OwnerRef;
  readonly reason: QuarantineReason;
  // 偽は理由を持たない画像(削除待ちを除く)、真は理由を持つ画像
  readonly hasReason: boolean;
  readonly limit: number;
}

export interface EraseCandidateQuery {
  readonly deletedBefore: Date;
  readonly unattachedCreatedBefore: Date;
  readonly limit: number;
}

export interface ModerationRequeueQuery {
  readonly pendingCreatedBefore: Date;
  readonly limit: number;
}

export interface MediaFileStore {
  insertReceiving(record: NewMediaFileRecord): Promise<void>;
  markStored(id: string): Promise<void>;
  findViews(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, MediaFileView>>;
  attach(ids: readonly string[]): Promise<void>;
  markDeleted(ids: readonly string[]): Promise<void>;
  markEraseRequested(ids: readonly string[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  // 判定待ち・未判定のときだけ記録し、記録したかを返す。重複配信の2回目は変えない
  recordModeration(id: string, record: ModerationRecord): Promise<boolean>;
  addReasons(ids: readonly string[], reason: QuarantineReason): Promise<void>;
  removeReasons(
    ids: readonly string[],
    reason: QuarantineReason,
  ): Promise<void>;
  // 現在値がfromのときだけ更新し、更新したかを返す
  updateLocation(
    id: string,
    from: MediaLocation,
    to: MediaLocation,
  ): Promise<boolean>;
  findIdsOwnedBy(owner: OwnerRef, limit: number): Promise<readonly string[]>;
  findOwnerIds(input: OwnerIdListInput): Promise<readonly string[]>;
  findOwnedImageIdsByReason(input: OwnedImageQuery): Promise<readonly string[]>;
  findEraseCandidates(input: EraseCandidateQuery): Promise<readonly string[]>;
  findModerationRequeueCandidates(
    input: ModerationRequeueQuery,
  ): Promise<readonly string[]>;
  findLocationMismatches(limit: number): Promise<readonly string[]>;
  listQuarantined(
    input: QuarantinedImageListInput,
  ): Promise<QuarantinedImageList>;
}

export interface StoredObjectMeta {
  readonly contentType: string;
  readonly contentDisposition?: string;
  readonly cacheControl?: string;
}

export interface StoredObject {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly contentType: string | undefined;
}

export interface MediaObjectStore {
  // 同じキーのオブジェクトがあれば上書きせずexistsを返す
  putIfAbsent(
    location: MediaLocation,
    key: string,
    body: ReadableStream<Uint8Array>,
    length: number,
    meta: StoredObjectMeta,
  ): Promise<'stored' | 'exists'>;
  get(location: MediaLocation, key: string): Promise<StoredObject | undefined>;
  exists(location: MediaLocation, key: string): Promise<boolean>;
  delete(location: MediaLocation, keys: readonly string[]): Promise<void>;
  copy(
    from: MediaLocation,
    to: MediaLocation,
    key: string,
  ): Promise<'copied' | 'already-present' | 'source-missing'>;
}

export interface UploadInput {
  readonly purpose: UploadPurpose;
  readonly uploader: MediaOwner;
  readonly contentLength: string | null;
  readonly contentType: string | null;
  readonly fileNameHeader: string | null;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type UploadOutcome =
  | { readonly ok: true; readonly file: UploadedFile }
  | { readonly ok: false; readonly rejection: UploadRejection };

export interface UploadReceiver {
  receive(input: UploadInput): Promise<UploadOutcome>;
}
