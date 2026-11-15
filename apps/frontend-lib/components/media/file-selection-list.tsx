import { useState } from 'react';

import {
  MEDIA_TYPE_LABELS,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import { cn } from '../../utilities/class-names.ts';
import { formatFileSize } from '../../utilities/media/file-size-label.ts';
import {
  fileSelectionAnnouncement,
  SELECTED_FILES_LABEL,
  UNKNOWN_FILE_TYPE_LABEL,
} from '../../utilities/messages/media-selection-messages.ts';
import { FileThumbnail } from './file-thumbnail.tsx';

export interface FileSelectionItem {
  readonly file: File;
  readonly status?: string;
}

export interface FileSelectionListProps {
  readonly items: readonly FileSelectionItem[];
  readonly className?: string;
}

const typeLabelOf = (file: File): string => {
  const type = parseMediaType(file.type);
  return type === undefined ? UNKNOWN_FILE_TYPE_LABEL : MEDIA_TYPE_LABELS[type];
};

const identityOf = ({ name, size, type, lastModified }: File): string =>
  JSON.stringify([name, size, type, lastModified]);

const selectionKeyOf = (items: readonly FileSelectionItem[]): string =>
  JSON.stringify(items.map(({ file }) => identityOf(file)));

export function FileSelectionList({
  items,
  className,
}: FileSelectionListProps) {
  const selectionKey = selectionKeyOf(items);
  const [announcedKey, setAnnouncedKey] = useState(selectionKey);
  const [announcement, setAnnouncement] = useState('');

  // 表示した時点の選択は読み上げず、利用者が選び直した時だけ読み上げの文言を変える。同じ内容の配列を作り直しただけでは変えない
  if (selectionKey !== announcedKey) {
    setAnnouncedKey(selectionKey);
    setAnnouncement(
      fileSelectionAnnouncement(items.map(({ file }) => file.name)),
    );
  }

  return (
    <div data-slot="file-selection-list" className={cn('min-w-0', className)}>
      {items.length === 0 ? null : (
        <ul aria-label={SELECTED_FILES_LABEL} className="flex flex-col gap-2">
          {items.map(({ file, status }, index) => (
            <li
              // 同じファイルを2度選んでも並びの位置で区別する
              key={`${String(index)}:${identityOf(file)}`}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-2 text-card-foreground"
            >
              <FileThumbnail file={file} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium break-all">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {typeLabelOf(file)}・{formatFileSize(file.size)}
                </p>
                {status === undefined ? null : (
                  <p className="text-xs">{status}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
