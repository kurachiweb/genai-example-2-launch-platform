import { FileIcon, Trash2Icon } from 'lucide-react';
import { type Ref, useCallback, useEffect, useRef, useState } from 'react';

import {
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import {
  ATTACHMENT_MEDIA_TYPES,
  MEDIA_TYPE_LABELS,
} from '../../../common-lib/media/media-types.ts';
import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import { AttachmentUploadField } from '../../../lib/components/media/attachment-upload-field.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatFileSize } from '../../../lib/utilities/media/file-size-label.ts';
import type { UploadConstraints } from '../../../lib/utilities/media/upload-constraints.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ATTACHED_FILES_LABEL,
  ATTACHMENTS_LABEL,
  ATTACHMENTS_SELECT_LABEL,
  INVALID_ATTACHMENT_STATUS,
  REMOVE_ATTACHMENT_LABEL,
  removeAttachmentLabel,
  removedAttachmentAnnouncement,
} from './inquiry-attachment-messages.ts';

export interface InquiryAttachmentInputProps {
  // 送るファイルのIDの並び(フォームの値)
  readonly value: readonly string[];
  readonly onChange: (fileIds: string[]) => void;
  // サーバーが添付できないと返したファイル
  readonly invalidFileIds: ReadonlySet<string>;
  // 選択のボタンの要素(FormFieldのcontrol.ref)
  readonly ref?: Ref<HTMLButtonElement>;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}

type FocusTarget =
  | { readonly kind: 'remove'; readonly fileId: string }
  | { readonly kind: 'select' };

const constraintsOf = (
  attached: readonly UploadedFile[],
): UploadConstraints => ({
  purpose: INQUIRY_ATTACHMENT_PURPOSE,
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: INQUIRY_ATTACHMENT_LIMITS.maxFileBytes,
  subjectLabel: ATTACHMENTS_LABEL,
  maxCount: INQUIRY_ATTACHMENT_LIMITS.maxCount,
  maxTotalBytes: INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes,
  existingCount: attached.length,
  existingTotalBytes: attached.reduce((sum, file) => sum + file.byteSize, 0),
});

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref !== undefined && ref !== null) {
    ref.current = value;
  }
};

// 共通の添付の入力欄は選ぶたびに前のアップロードへ足していき、最新の選択だけを示すため、積み上がった全件の一覧と削除をここで受け持つ
export function InquiryAttachmentInput({
  value,
  onChange,
  invalidFileIds,
  ref,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: InquiryAttachmentInputProps) {
  const [uploadedById, setUploadedById] = useState<
    ReadonlyMap<string, UploadedFile>
  >(() => new Map());
  // 削除したファイルが最新の選択の一覧に残らないよう、入力欄を作り直す
  const [fieldKey, setFieldKey] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const selectButtonRef = useRef<HTMLButtonElement | null>(null);
  const removeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusTargetRef = useRef<FocusTarget | undefined>(undefined);
  const attached = value.flatMap((fileId) => {
    const file = uploadedById.get(fileId);
    return file === undefined ? [] : [file];
  });

  // 押した削除のボタンは消えるため、描き直した後に次の項目の削除のボタンか選択のボタンへフォーカスを移す
  useEffect(() => {
    const target = focusTargetRef.current;
    if (target === undefined) {
      return;
    }
    focusTargetRef.current = undefined;
    const element =
      target.kind === 'select'
        ? selectButtonRef.current
        : removeButtonsRef.current.get(target.fileId);
    element?.focus();
  });

  const attachSelectButton = useCallback(
    (node: HTMLButtonElement | null) => {
      selectButtonRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const handleUploaded = (files: readonly UploadedFile[]): void => {
    setUploadedById((current) => {
      const next = new Map(current);
      for (const file of files) {
        next.set(file.fileId, file);
      }
      return next;
    });
    onChange([...value, ...files.map(({ fileId }) => fileId)]);
  };

  const handleRemove = (removed: UploadedFile): void => {
    const index = attached.findIndex(({ fileId }) => fileId === removed.fileId);
    const next = attached[index + 1];
    focusTargetRef.current =
      next === undefined
        ? { kind: 'select' }
        : { kind: 'remove', fileId: next.fileId };
    // 送信中の入力欄を作り直すとアップロードが中断されるため、送信中は最新の選択の一覧を残す
    if (selectButtonRef.current?.getAttribute('aria-busy') !== 'true') {
      setFieldKey((key) => key + 1);
    }
    setAnnouncement(removedAttachmentAnnouncement(removed.originalFileName));
    onChange(value.filter((fileId) => fileId !== removed.fileId));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AttachmentUploadField
        key={fieldKey}
        ref={attachSelectButton}
        label={ATTACHMENTS_SELECT_LABEL}
        constraints={constraintsOf(attached)}
        multiple
        contactAvailable={CLIENT_PROFILE.contactAvailable}
        onUploaded={handleUploaded}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
      {attached.length === 0 ? null : (
        <ul aria-label={ATTACHED_FILES_LABEL} className="flex flex-col gap-2">
          {attached.map((file) => {
            const rejected = invalidFileIds.has(file.fileId);
            return (
              <li
                key={file.fileId}
                className={cn(
                  'flex min-w-0 items-center gap-3 rounded-md border bg-card p-2 text-card-foreground',
                  rejected ? 'border-destructive' : 'border-border',
                )}
              >
                <FileIcon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-medium break-all">
                    {file.originalFileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {MEDIA_TYPE_LABELS[file.contentType]}・
                    {formatFileSize(file.byteSize)}
                  </p>
                  {rejected ? (
                    <p className="text-xs text-destructive">
                      {INVALID_ATTACHMENT_STATUS}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  aria-label={removeAttachmentLabel(file.originalFileName)}
                  variant="ghost"
                  size="sm"
                  ref={(node) => {
                    if (node === null) {
                      removeButtonsRef.current.delete(file.fileId);
                    } else {
                      removeButtonsRef.current.set(file.fileId, node);
                    }
                  }}
                  onClick={() => {
                    handleRemove(file);
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                  {REMOVE_ATTACHMENT_LABEL}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
