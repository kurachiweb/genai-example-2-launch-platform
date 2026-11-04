import { useEffect, useRef, useState } from 'react';

import { IMAGE_MEDIA_TYPES } from '../../../common-lib/media/media-types.ts';
import { AdminAvatar } from '../../../lib/components/admin/admin-avatar.tsx';
import { ImageUploadField } from '../../../lib/components/media/image-upload-field.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ImageEditOptions } from '../../../lib/utilities/media/crop-geometry.ts';
import type { UploadConstraints } from '../../../lib/utilities/media/upload-constraints.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { AdminAccountAvatar } from '../../graphql/admin-accounts.ts';
import {
  AVATAR_REMOVE_LABEL,
  AVATAR_REMOVED_NOTICE,
  AVATAR_SELECT_LABEL,
  AVATAR_SUBJECT_LABEL,
} from './admin-accounts-messages.ts';

// APIサーバーのアップロードの用途admin-avatarと同じ形式と上限
const ADMIN_AVATAR_UPLOAD: UploadConstraints = Object.freeze({
  purpose: 'admin-avatar',
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 512_000,
  subjectLabel: AVATAR_SUBJECT_LABEL,
});

// 最も大きい128pxの表示の2倍のバリアントまでを賄う寸法に切り取る
const ADMIN_AVATAR_EDIT: ImageEditOptions = Object.freeze({
  aspect: 1,
  maxLongSide: 256,
  cropShape: 'round',
});

export interface AdminAvatarFieldProps {
  // 識別子。nullは画像を取り除いた状態
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly current: AdminAccountAvatar | null;
  readonly nickname: string;
  readonly fieldRef: (element: HTMLButtonElement | null) => void;
  readonly 'aria-labelledby': string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
}

export function AdminAvatarField({
  value,
  onChange,
  current,
  nickname,
  fieldRef,
  ...aria
}: AdminAvatarFieldProps) {
  const selectButtonRef = useRef<HTMLButtonElement | null>(null);
  // 取り除いた後に前のアップロードの結果を残さないよう入力欄を作り直す。押した「画像を取り除く」は消えるため、作り直した選択のボタンへフォーカスを移す
  const [session, setSession] = useState(0);
  const focusAfterResetRef = useRef(false);

  useEffect(() => {
    if (focusAfterResetRef.current) {
      focusAfterResetRef.current = false;
      selectButtonRef.current?.focus();
    }
  }, [session]);

  // 新しくアップロードした画像は入力欄の一覧が縮小画像で示すため、登録済みの画像か既定のアイコンだけを示す
  const preview = (() => {
    if (value === null) {
      return null;
    }
    return value === current?.id ? current : undefined;
  })();

  return (
    <div className="flex flex-wrap items-start gap-4">
      {preview === undefined ? null : (
        <AdminAvatar image={preview} nickname={nickname} size={64} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ImageUploadField
          key={session}
          ref={(element) => {
            selectButtonRef.current = element;
            fieldRef(element);
          }}
          label={AVATAR_SELECT_LABEL}
          constraints={ADMIN_AVATAR_UPLOAD}
          edit={ADMIN_AVATAR_EDIT}
          contactAvailable={ADMIN_PROFILE.contactAvailable}
          onUploaded={([uploaded]) => {
            if (uploaded !== undefined) {
              onChange(uploaded.fileId);
            }
          }}
          {...aria}
        />
        {value === null ? (
          <p className="text-sm text-muted-foreground">
            {AVATAR_REMOVED_NOTICE}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
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
