import { type Ref, useRef, useState } from 'react';

import { parseMediaType } from '../../../common-lib/media/media-types.ts';
import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import type { ImageEditOptions } from '../../utilities/media/crop-geometry.ts';
import {
  checkSelection,
  EDITED_IMAGE_TYPES,
  selectionConstraintsOf,
  type UploadConstraints,
} from '../../utilities/media/upload-constraints.ts';
import { selectionMessagesOf } from '../../utilities/media/upload-messages.ts';
import { ImageCropDialog } from './image-crop-dialog.tsx';
import {
  type UploadFieldAriaProps,
  UploadFieldFrame,
} from './upload-field-frame.tsx';
import { useFileUpload } from './use-file-upload.ts';

export interface ImageUploadFieldProps extends UploadFieldAriaProps {
  // 選択のボタンの文言
  readonly label: string;
  readonly constraints: UploadConstraints;
  readonly edit: ImageEditOptions;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  // 問い合わせの画面への導線を持つか。利用者側はCLIENT_PROFILE.contactAvailable、管理者側はADMIN_PROFILE.contactAvailableを渡す
  readonly contactAvailable: boolean;
  readonly onUploaded: (files: readonly UploadedFile[]) => void;
  // 選択のボタンの要素(FormFieldのcontrol.ref)
  readonly ref?: Ref<HTMLButtonElement>;
  readonly className?: string;
}

interface PreparedFile {
  readonly file: File;
  readonly edited: boolean;
}

// 選んだ順に、SVGはそのまま、それ以外の画像は1枚ずつ編集して作り直したファイルを並べる
interface Editing {
  readonly current: File;
  readonly rest: readonly File[];
  readonly prepared: readonly PreparedFile[];
}

const isEditedImage = (file: File): boolean => {
  const type = parseMediaType(file.type);
  return type !== undefined && EDITED_IMAGE_TYPES.includes(type);
};

export function ImageUploadField({
  label,
  constraints,
  edit,
  multiple = false,
  disabled = false,
  contactAvailable,
  onUploaded,
  ref,
  className,
  ...aria
}: ImageUploadFieldProps) {
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<readonly File[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<Editing>();
  const upload = useFileUpload({ constraints, contactAvailable, onUploaded });
  const limits = selectionConstraintsOf(constraints, multiple);

  const reject = (files: readonly File[], messages: readonly string[]) => {
    upload.reset();
    setItems(files);
    setSelectionErrors(messages);
  };

  // 作り直した画像は選んだ時点でサイズを判定していないため、送る直前に作り直した後のサイズと合計で判定し直す
  const send = (prepared: readonly PreparedFile[]) => {
    const files = prepared.map(({ file }) => file);
    const editedNames = new Set(
      prepared.filter(({ edited }) => edited).map(({ file }) => file.name),
    );
    const messages = selectionMessagesOf(
      checkSelection(files, limits),
      limits,
      editedNames,
    );
    if (messages.length > 0) {
      reject(files, messages);
      return;
    }
    upload.reset();
    setItems(files);
    setSelectionErrors([]);
    upload.start(files);
  };

  const advance = (
    remaining: readonly File[],
    prepared: readonly PreparedFile[],
  ) => {
    const nextIndex = remaining.findIndex(isEditedImage);
    const skipped = (
      nextIndex === -1 ? remaining : remaining.slice(0, nextIndex)
    ).map((file) => ({ file, edited: false }));
    const current = nextIndex === -1 ? undefined : remaining[nextIndex];
    if (current === undefined) {
      setEditing(undefined);
      const files = [...prepared, ...skipped];
      // 全ての画像の編集を取り消した選択は何も加えず、前の結果の表示を残す
      if (files.length > 0) {
        send(files);
      }
      return;
    }
    setEditing({
      current,
      rest: remaining.slice(nextIndex + 1),
      prepared: [...prepared, ...skipped],
    });
  };

  const handleSelect = (files: readonly File[]) => {
    if (disabled || upload.state.status === 'uploading') {
      return;
    }
    const messages = selectionMessagesOf(
      checkSelection(files, limits, { editedTypes: EDITED_IMAGE_TYPES }),
      limits,
    );
    if (messages.length > 0) {
      reject(files, messages);
      return;
    }
    advance(files, []);
  };

  return (
    <>
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
      <ImageCropDialog
        file={editing?.current}
        edit={edit}
        returnFocusRef={selectButtonRef}
        onConfirm={(encoded) => {
          if (editing === undefined) {
            return;
          }
          advance(editing.rest, [
            ...editing.prepared,
            { file: encoded, edited: true },
          ]);
        }}
        onCancel={() => {
          if (editing === undefined) {
            return;
          }
          advance(editing.rest, editing.prepared);
        }}
      />
    </>
  );
}
