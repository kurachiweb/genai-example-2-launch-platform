import {
  MEDIA_TYPE_LABELS,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import { cn } from '../../utilities/class-names.ts';
import { INQUIRY_ATTACHMENTS_LABEL } from '../../utilities/messages/inquiry-display-messages.ts';
import { UNKNOWN_FILE_TYPE_LABEL } from '../../utilities/messages/media-selection-messages.ts';
import { PrivateFileLink } from '../media/private-file-link.tsx';

export interface InquiryAttachmentView {
  readonly id: string;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly byteSize: number;
}

export interface InquiryAttachmentListProps {
  readonly attachments: readonly InquiryAttachmentView[];
  readonly className?: string;
}

const typeLabelOf = (contentType: string): string => {
  const type = parseMediaType(contentType);
  return type === undefined ? UNKNOWN_FILE_TYPE_LABEL : MEDIA_TYPE_LABELS[type];
};

export function InquiryAttachmentList({
  attachments,
  className,
}: InquiryAttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ul
      data-slot="inquiry-attachment-list"
      aria-label={INQUIRY_ATTACHMENTS_LABEL}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      {attachments.map(({ id, originalFileName, contentType, byteSize }) => (
        <li
          key={id}
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
        >
          <PrivateFileLink
            fileId={id}
            fileName={originalFileName}
            byteSize={byteSize}
          />
          <span className="text-xs text-muted-foreground">
            {typeLabelOf(contentType)}
          </span>
        </li>
      ))}
    </ul>
  );
}
