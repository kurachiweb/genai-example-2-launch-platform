import { inject, injectable } from 'inversify';

import {
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import {
  type AttachmentCandidate,
  checkAttachmentSelection,
} from '../../domain/inquiry/attachment-selection.ts';
import { inquiryAttachmentsInvalidError } from './inquiry-errors.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type { InquiryIncidentReporter } from './ports.ts';

export interface InquiryAttachmentBinder {
  // 重複を除いた要求の順のIDを返す。違反はinquiry_attachments_invalidで、どのファイルも紐付けない
  bind(userId: string, fileIds: readonly string[]): Promise<readonly string[]>;
  // メッセージの保存に失敗した時に、紐付けたファイルを日次の物理削除へ回す。失敗は報告だけにする
  release(fileIds: readonly string[]): Promise<void>;
}

const candidateOf = (file: MediaFileView): AttachmentCandidate => ({
  id: file.id,
  purpose: file.purpose,
  ownerKind: file.owner.kind,
  ownerId: file.owner.kind === 'system' ? null : file.owner.id,
  stored: file.stored,
  deleted: file.deletedAt !== null || file.eraseRequested,
  attached: file.attached,
  byteSize: file.byteSize,
});

const candidatesOf = (
  files: ReadonlyMap<string, MediaFileView>,
): ReadonlyMap<string, AttachmentCandidate> =>
  new Map([...files].map(([id, file]) => [id, candidateOf(file)]));

@injectable()
export class MediaInquiryAttachmentBinder implements InquiryAttachmentBinder {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(INQUIRY_TYPES.InquiryIncidentReporter)
    private readonly incidents: InquiryIncidentReporter,
  ) {}

  async bind(
    userId: string,
    fileIds: readonly string[],
  ): Promise<readonly string[]> {
    const uniqueIds = [...new Set(fileIds)];
    if (uniqueIds.length === 0) {
      return [];
    }
    // 上限を超える件数の照会をファイル管理へ渡さないため、件数だけは照会の前に判定する
    if (uniqueIds.length > INQUIRY_ATTACHMENT_LIMITS.maxCount) {
      throw inquiryAttachmentsInvalidError({ kind: 'too-many' }, fileIds);
    }
    const found = await this.media.findMany(uniqueIds);
    const violation = checkAttachmentSelection(
      uniqueIds,
      candidatesOf(found),
      userId,
    );
    if (violation !== undefined) {
      throw inquiryAttachmentsInvalidError(violation, fileIds);
    }
    const claimed = await this.media.claim({
      fileIds: uniqueIds,
      purpose: INQUIRY_ATTACHMENT_PURPOSE,
      owner: { kind: 'user', id: userId },
    });
    if (!claimed.ok) {
      throw inquiryAttachmentsInvalidError(
        {
          kind: 'invalid',
          fileIds: claimed.failures.map((failure) => failure.fileId),
        },
        fileIds,
      );
    }
    return uniqueIds;
  }

  async release(fileIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(fileIds)];
    if (uniqueIds.length === 0) {
      return;
    }
    try {
      await this.media.markDeleted(uniqueIds);
    } catch (error: unknown) {
      // 解放できなかったファイルは紐付け済みのまま残りどのメッセージからも参照されないが、送信者が選び直せば送信できるため、保存の失敗の応答を優先する
      this.incidents.report('attachment-release-failed', error, {});
    }
  }
}
