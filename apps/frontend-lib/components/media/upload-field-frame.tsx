import { type Ref, type RefObject, useCallback, useId } from 'react';

import type { MediaType } from '../../../common-lib/media/media-types.ts';
import { cn } from '../../utilities/class-names.ts';
import {
  UPLOAD_RETRY_LABEL,
  UPLOAD_STATUS_SENDING,
  UPLOAD_STATUS_UPLOADED,
  UPLOAD_STATUS_WAITING,
  uploadedAnnouncement,
  uploadingAnnouncement,
} from '../../utilities/messages/media-upload-messages.ts';
import { FormMessage } from '../form/form-message.tsx';
import { Button } from '../ui/button/button.tsx';
import { FileDropZone } from './file-drop-zone.tsx';
import {
  type FileSelectionItem,
  FileSelectionList,
} from './file-selection-list.tsx';
import type { FileUploadState } from './use-file-upload.ts';

export interface UploadFieldAriaProps {
  // 欄のラベルの要素のID(FormFieldのlabelId)。ボタンの見えている文言と合わせて名前にする
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}

export interface UploadFieldFrameProps extends UploadFieldAriaProps {
  readonly label: string;
  readonly accept: readonly MediaType[];
  readonly multiple: boolean;
  readonly disabled: boolean;
  // 一覧に並べるファイル。送る前の検査で拒否した選択か、送る(送った)ファイル
  readonly items: readonly File[];
  readonly selectionErrors: readonly string[];
  readonly upload: FileUploadState;
  readonly onSelect: (files: readonly File[]) => void;
  readonly onRetry: () => void;
  readonly selectButtonRef: RefObject<HTMLButtonElement | null>;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
  readonly className?: string | undefined;
}

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref !== undefined && ref !== null) {
    ref.current = value;
  }
};

const statusOf = (
  index: number,
  upload: FileUploadState,
): string | undefined => {
  switch (upload.status) {
    case 'idle': {
      return undefined;
    }
    case 'uploaded': {
      return UPLOAD_STATUS_UPLOADED;
    }
    case 'uploading': {
      if (index < upload.completed) {
        return UPLOAD_STATUS_UPLOADED;
      }
      return index === upload.completed
        ? UPLOAD_STATUS_SENDING
        : UPLOAD_STATUS_WAITING;
    }
    case 'failed': {
      return index < upload.completed ? UPLOAD_STATUS_UPLOADED : undefined;
    }
  }
};

const errorsOf = (
  selectionErrors: readonly string[],
  upload: FileUploadState,
): readonly string[] => {
  if (selectionErrors.length > 0) {
    return selectionErrors;
  }
  return upload.status === 'failed' ? [upload.message] : [];
};

const progressOf = (upload: FileUploadState): string => {
  switch (upload.status) {
    case 'uploading': {
      return uploadingAnnouncement(upload.fileName);
    }
    case 'uploaded': {
      return uploadedAnnouncement(
        upload.files.map(({ originalFileName }) => originalFileName),
      );
    }
    default: {
      return '';
    }
  }
};

// 画像と添付の入力欄が共有する、選択の領域・一覧・エラー・再試行・送信の状態の読み上げの並び
export function UploadFieldFrame({
  label,
  accept,
  multiple,
  disabled,
  items,
  selectionErrors,
  upload,
  onSelect,
  onRetry,
  selectButtonRef,
  ref,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  className,
}: UploadFieldFrameProps) {
  const errorId = useId();
  const errors = errorsOf(selectionErrors, upload);
  const hasErrors = errors.length > 0;
  const retryable =
    selectionErrors.length === 0 &&
    upload.status === 'failed' &&
    upload.retryable;
  const listItems: readonly FileSelectionItem[] = items.map((file, index) => {
    const status = statusOf(index, upload);
    return status === undefined ? { file } : { file, status };
  });
  const describedByIds = [describedBy, hasErrors ? errorId : undefined]
    .filter((id) => id !== undefined)
    .join(' ');
  const attachSelectButton = useCallback(
    (node: HTMLButtonElement | null) => {
      selectButtonRef.current = node;
      assignRef(ref, node);
    },
    [selectButtonRef, ref],
  );

  return (
    <div
      data-slot="upload-field"
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <FileDropZone
        ref={attachSelectButton}
        label={label}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        pending={upload.status === 'uploading'}
        onSelect={onSelect}
        aria-labelledby={labelledBy}
        aria-describedby={describedByIds === '' ? undefined : describedByIds}
        aria-invalid={invalid === true || hasErrors ? true : undefined}
      />
      {/* 検査と送信の結果を読み上げるため、領域を最初から置き、エラーの文言と見えない進行の文言を入れ替える */}
      <div data-slot="upload-field-status" aria-live="polite">
        {hasErrors ? (
          <div id={errorId} className="flex flex-col gap-1">
            {errors.map((message) => (
              <FormMessage key={message}>{message}</FormMessage>
            ))}
          </div>
        ) : (
          <p className="sr-only">{progressOf(upload)}</p>
        )}
      </div>
      {retryable ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              // 押した再試行のボタンは送信中に消えるため、フォーカスを選択のボタンへ移して位置を失わせない
              selectButtonRef.current?.focus();
              onRetry();
            }}
          >
            {UPLOAD_RETRY_LABEL}
          </Button>
        </div>
      ) : null}
      <FileSelectionList items={listItems} />
    </div>
  );
}
