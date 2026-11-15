import type { Control } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import type { AdminAccountAvatar } from '../../graphql/admin-accounts.ts';
import type { AdminProfileFormInput } from './admin-account-form-schemas.ts';
import {
  ADMIN_TITLE_DESCRIPTION,
  ADMIN_TITLE_LABEL,
  AVATAR_DESCRIPTION,
  AVATAR_LABEL,
  NICKNAME_DESCRIPTION,
  NICKNAME_LABEL,
} from './admin-accounts-messages.ts';
import { AdminAvatarField } from './admin-avatar-field.tsx';

export interface AdminProfileFieldsProps<TTransformedValues> {
  readonly control: Control<AdminProfileFormInput, unknown, TTransformedValues>;
  // 登録済みの画像。nullは未登録
  readonly currentAvatar: AdminAccountAvatar | null;
  // 既定のアイコンの文字と配色の種
  readonly nickname: string;
  // 保存の後に前のアップロードの結果を残さないよう、変えると画像の入力欄を作り直す
  readonly avatarSession?: number;
}

// 自分のアカウントのプロフィールと、管理者アカウントのプロフィールの編集のダイアログが共有する入力欄
export function AdminProfileFields<TTransformedValues>({
  control,
  currentAvatar,
  nickname,
  avatarSession = 0,
}: AdminProfileFieldsProps<TTransformedValues>) {
  return (
    <>
      <FormField
        control={control}
        name="nickname"
        label={NICKNAME_LABEL}
        description={NICKNAME_DESCRIPTION}
      >
        {(field) => <Input {...field} autoComplete="off" aria-required />}
      </FormField>
      <FormField
        control={control}
        name="title"
        label={ADMIN_TITLE_LABEL}
        description={ADMIN_TITLE_DESCRIPTION}
      >
        {(field) => <Input {...field} autoComplete="off" />}
      </FormField>
      <FormField
        control={control}
        name="avatarFileId"
        label={AVATAR_LABEL}
        description={AVATAR_DESCRIPTION}
      >
        {(field) => (
          <AdminAvatarField
            key={avatarSession}
            value={field.value}
            onChange={field.onChange}
            current={currentAvatar}
            nickname={nickname}
            fieldRef={field.ref}
            aria-labelledby={field.labelId}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
          />
        )}
      </FormField>
    </>
  );
}
