import { UploadIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  useId,
  useRef,
  useState,
} from 'react';

import type { MediaType } from '../../../common-lib/media/media-types.ts';
import { cn } from '../../utilities/class-names.ts';
import {
  FILE_DROP_ACTIVE_HINT,
  FILE_DROP_HINT,
} from '../../utilities/messages/media-selection-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface FileDropZoneProps {
  readonly label: string;
  readonly accept: readonly MediaType[];
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: (files: readonly File[]) => void;
  // 欄のラベルの要素のID(FormFieldのlabelId)。ボタンの見えている文言と合わせて名前にする
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly className?: string;
}

const FILES_TRANSFER_TYPE = 'Files';

const carriesFiles = (event: DragEvent<HTMLElement>): boolean =>
  event.dataTransfer.types.includes(FILES_TRANSFER_TYPE);

export function FileDropZone({
  label,
  accept,
  multiple = false,
  disabled = false,
  onSelect,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  className,
}: FileDropZoneProps) {
  const labelTextId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // 子の要素へ入る度に外側の要素のdragleaveが起きるため、入った回数と出た回数の差でドラッグ中かを判定する
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const acceptsDrag = (event: DragEvent<HTMLElement>): boolean =>
    !disabled && carriesFiles(event);

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrag(event)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      onSelect(files);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // 値が残ると、拒否された後に同じファイルを選び直しても変更の通知が起きない
    input.value = '';
    if (files.length > 0) {
      onSelect(files);
    }
  };

  return (
    <div
      data-slot="file-drop-zone"
      data-dragging={dragging ? 'true' : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-input bg-card px-4 py-6 text-center transition-colors',
        dragging && 'border-primary bg-accent',
        className,
      )}
    >
      {/* 欄のラベルを<label for>で結ぶとボタンの見えている文言が名前から外れ、音声操作で見えている文言を言っても届かないため、両方を名前にする */}
      <Button
        type="button"
        variant="outline"
        aria-labelledby={
          labelledBy === undefined ? undefined : `${labelledBy} ${labelTextId}`
        }
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon aria-hidden="true" />
        <span id={labelTextId}>{label}</span>
      </Button>
      <p
        className={cn(
          'text-sm',
          dragging
            ? 'font-medium text-accent-foreground'
            : 'text-muted-foreground',
        )}
      >
        {dragging ? FILE_DROP_ACTIVE_HINT : FILE_DROP_HINT}
      </p>
      {/* 選択の画面はボタンから開くため、入力欄自体はフォーカスの順序と支援技術から外す */}
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple={multiple}
        disabled={disabled}
        hidden
        tabIndex={-1}
        onChange={handleChange}
      />
    </div>
  );
}
