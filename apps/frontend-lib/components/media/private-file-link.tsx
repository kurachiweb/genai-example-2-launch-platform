import { FileIcon } from 'lucide-react';

import { downloadPathOf } from '../../../common-lib/media/upload-protocol.ts';
import { cn } from '../../utilities/class-names.ts';
import { privateFileSizeNote } from '../../utilities/messages/media-display-messages.ts';

export interface PrivateFileLinkProps {
  readonly fileId: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly className?: string;
}

// 保存のファイル名とインライン表示の禁止はサーバーのContent-Dispositionに任せるため、download属性を付けない
export function PrivateFileLink({
  fileId,
  fileName,
  byteSize,
  className,
}: PrivateFileLinkProps) {
  return (
    <a
      data-slot="private-file-link"
      href={downloadPathOf(fileId)}
      className={cn(
        'inline-flex max-w-full min-w-0 items-start gap-1.5 text-sm text-primary underline underline-offset-2',
        className,
      )}
    >
      <FileIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-all">
        {fileName}
        {privateFileSizeNote(byteSize)}
      </span>
    </a>
  );
}
