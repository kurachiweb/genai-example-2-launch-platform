import { useEffect, useRef, useState } from 'react';

import { IMAGE_MEDIA_TYPES } from '../../../common-lib/media/media-types.ts';
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_PURPOSE,
} from '../../../common-lib/profile/profile-input-rules.ts';
import { ImageUploadField } from '../../../lib/components/media/image-upload-field.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ImageEditOptions } from '../../../lib/utilities/media/crop-geometry.ts';
import type { UploadConstraints } from '../../../lib/utilities/media/upload-constraints.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { MyProfileView } from './my-profile-view.ts';
import {
  AVATAR_REMOVE_LABEL,
  AVATAR_SELECT_LABEL,
  AVATAR_SUBJECT_LABEL,
} from './profile-form-messages.ts';
import { UserAvatar } from './user-avatar.tsx';

// APIサーバーのアップロードの用途と同じ形式
const USER_AVATAR_UPLOAD: UploadConstraints = Object.freeze({
  purpose: USER_AVATAR_PURPOSE,
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: USER_AVATAR_MAX_BYTES,
  subjectLabel: AVATAR_SUBJECT_LABEL,
});

const USER_AVATAR_EDIT: ImageEditOptions = Object.freeze({
  aspect: 1,
  maxLongSide: 512,
  cropShape: 'round',
});

const PREVIEW_SIZE = 64;

export interface ProfileAvatarFieldProps {
  // 識別子。nullは画像が無い状態
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly current: MyProfileView['avatar'];
  readonly nickname: string;
  readonly handle: string;
  readonly disabled: boolean;
  readonly fieldRef: (element: HTMLButtonElement | null) => void;
  readonly 'aria-labelledby': string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
}

export function ProfileAvatarField({
  value,
  onChange,
  current,
  nickname,
  handle,
  disabled,
  fieldRef,
  ...aria
}: ProfileAvatarFieldProps) {
  const selectButtonRef = useRef<HTMLButtonElement | null>(null);
  // 削除した後に前のアップロードの結果を残さないよう入力欄を作り直す。押した「画像を削除」は消えるため、作り直した選択のボタンへフォーカスを移す
  const [session, setSession] = useState(0);
  const focusAfterResetRef = useRef(false);

  useEffect(() => {
    if (focusAfterResetRef.current) {
      focusAfterResetRef.current = false;
      selectButtonRef.current?.focus();
    }
  }, [session]);

  // 新しくアップロードした画像は入力欄の一覧が縮小画像で示すため、登録済みの画像か頭文字のプレースホルダーだけを示す
  const preview = (() => {
    if (value === null) {
      return null;
    }
    return value === current?.id ? current : undefined;
  })();

  return (
    <div className="flex flex-wrap items-start gap-4">
      {preview === undefined ? null : (
        <UserAvatar
          user={{ handle, nickname, avatar: preview }}
          size={PREVIEW_SIZE}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ImageUploadField
          key={session}
          ref={(element) => {
            selectButtonRef.current = element;
            fieldRef(element);
          }}
          label={AVATAR_SELECT_LABEL}
          constraints={USER_AVATAR_UPLOAD}
          edit={USER_AVATAR_EDIT}
          contactAvailable={CLIENT_PROFILE.contactAvailable}
          disabled={disabled}
          onUploaded={([uploaded]) => {
            if (uploaded !== undefined) {
              onChange(uploaded.fileId);
            }
          }}
          {...aria}
        />
        {value === null ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() => {
              focusAfterResetRef.current = true;
              onChange(null);
              setSession((count) => count + 1);
            }}
          >
            {AVATAR_REMOVE_LABEL}
          </Button>
        )}
      </div>
    </div>
  );
}
