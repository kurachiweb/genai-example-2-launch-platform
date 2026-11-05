import { INQUIRY_ATTACHMENT_LIMITS } from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import {
  ATTACHMENT_MEDIA_TYPES,
  MEDIA_TYPE_LABELS,
} from '../../../common-lib/media/media-types.ts';
import { formatFileSize } from '../../../lib/utilities/media/file-size-label.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

export const ATTACHMENTS_LABEL = '添付ファイル';

export const ATTACHMENTS_SELECT_LABEL = 'ファイルを選択';

export const ATTACHMENTS_DESCRIPTION = `${ATTACHMENT_MEDIA_TYPES.map((type) => MEDIA_TYPE_LABELS[type]).join('・')}のファイルを、${countFormat.format(INQUIRY_ATTACHMENT_LIMITS.maxCount)}個まで合計${formatFileSize(INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes)}以内で添付できます(任意)。`;

export const ATTACHED_FILES_LABEL = '添付するファイル';

export const REMOVE_ATTACHMENT_LABEL = '削除';

// 見えている文言を含めたまま、どのファイルの削除かを名前で示す
export const removeAttachmentLabel = (fileName: string): string =>
  `${fileName}を${REMOVE_ATTACHMENT_LABEL}`;

export const removedAttachmentAnnouncement = (fileName: string): string =>
  `${fileName}を添付するファイルから削除しました。`;

export const INVALID_ATTACHMENT_STATUS =
  'このファイルは添付できません。削除してから送信してください。';
