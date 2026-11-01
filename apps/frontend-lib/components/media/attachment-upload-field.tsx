import { type Ref, useRef, useState } from 'react';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import {
  checkSelection,
  selectionConstraintsOf,
  type UploadConstraints,
} from '../../utilities/media/upload-constraints.ts';
import { selectionMessagesOf } from '../../utilities/media/upload-messages.ts';
import {
  type UploadFieldAriaProps,
  UploadFieldFrame,
} from './upload-field-frame.tsx';
import { useFileUpload } from './use-file-upload.ts';

export interface AttachmentUploadFieldProps extends UploadFieldAriaProps {
  // 選択のボタンの文言
  readonly label: string;
  readonly constraints: UploadConstraints;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  // 問い合わせの画面への導線を持つか。利用者側はCLIENT_PROFILE.contactAvailable、管理者側はADMIN_PROFILE.contactAvailableを渡す
  readonly contactAvailable: boolean;
  readonly onUploaded: (files: readonly UploadedFile[]) => void;
  // 選択のボタンの要素(FormFieldのcontrol.ref)
  readonly ref?: Ref<HTMLButtonElement>;
  readonly className?: string;
}

// 編集ダイアログを出さず、選んだファイルのサイズで判定してそのまま送る
export function AttachmentUploadField({
  label,
  constraints,
  multiple = false,
  disabled = false,
  contactAvailable,
  onUploaded,
  ref,
  className,
  ...aria
}: AttachmentUploadFieldProps) {
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<readonly File[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<readonly string[]>([]);
  const upload = useFileUpload({ constraints, contactAvailable, onUploaded });
  const limits = selectionConstraintsOf(constraints, multiple);

  const handleSelect = (files: readonly File[]) => {
    if (disabled || upload.state.status === 'uploading') {
      return;
    }
    const messages = selectionMessagesOf(checkSelection(files, limits), limits);
    upload.reset();
    setItems(files);
    setSelectionErrors(messages);
    if (messages.length === 0) {
      upload.start(files);
    }
  };

  return (
    <UploadFieldFrame
      {...aria}
      label={label}
      accept={constraints.allowedTypes}
      multiple={multiple}
      disabled={disabled}
      items={items}
      selectionErrors={selectionErrors}
      upload={upload.state}
      onSelect={handleSelect}
      onRetry={upload.retry}
      selectButtonRef={selectButtonRef}
      ref={ref}
      className={className}
    />
  );
}
