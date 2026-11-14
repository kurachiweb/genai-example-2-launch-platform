import {
  checkAttachmentTotals,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import type { MediaOwner } from '../../../lib/core/media/media-file.ts';

export interface AttachmentCandidate {
  readonly id: string;
  readonly purpose: string;
  readonly ownerKind: MediaOwner['kind'];
  readonly ownerId: string | null;
  readonly stored: boolean;
  readonly deleted: boolean;
  readonly attached: boolean;
  readonly byteSize: number;
}

export type AttachmentSelectionError =
  | { readonly kind: 'too-many' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'invalid'; readonly fileIds: readonly string[] };

// 紐付け済みのファイルを通すと、保存の失敗時の解放が先のメッセージの添付まで論理削除するため、1つのファイルは1つのメッセージにだけ紐付ける
const isSelectable = (
  file: AttachmentCandidate | undefined,
  userId: string,
): boolean =>
  file !== undefined &&
  file.stored &&
  !file.deleted &&
  !file.attached &&
  file.purpose === INQUIRY_ATTACHMENT_PURPOSE &&
  file.ownerKind === 'user' &&
  file.ownerId === userId;

// 件数→無効なID→合計の順に判定する。無効なIDが残る間は合計のサイズが定まらないため、合計の超過はすべて有効な時だけ返す
export const checkAttachmentSelection = (
  requestedIds: readonly string[],
  found: ReadonlyMap<string, AttachmentCandidate>,
  userId: string,
): AttachmentSelectionError | undefined => {
  const uniqueIds = [...new Set(requestedIds)];
  const totalsIssue = checkAttachmentTotals(
    uniqueIds.map((id) => found.get(id)?.byteSize ?? 0),
  );
  if (totalsIssue === 'too-many') {
    return { kind: 'too-many' };
  }
  const invalidIds = uniqueIds.filter(
    (id) => !isSelectable(found.get(id), userId),
  );
  if (invalidIds.length > 0) {
    return { kind: 'invalid', fileIds: invalidIds };
  }
  return totalsIssue === 'too-large' ? { kind: 'too-large' } : undefined;
};
