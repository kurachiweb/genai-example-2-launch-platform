import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import type { AdminViewer } from '../../graphql/admin-viewer.ts';
import { AdminUpdateProfileDocument } from '../../graphql/generated/graphql.ts';
import {
  ADMIN_PROFILE_FORM_SCHEMA,
  type AdminProfileFormInput,
} from '../admins/admin-account-form-schemas.ts';
import {
  PROFILE_SAVED_MESSAGE,
  PROFILE_SUBMIT_LABEL,
} from '../admins/admin-accounts-messages.ts';
import { AdminProfileFields } from '../admins/admin-profile-fields.tsx';
import { useAdminViewerRefresh } from '../auth/use-admin-viewer-refresh.ts';
import {
  PROFILE_SECTION_DESCRIPTION,
  PROFILE_SECTION_TITLE,
} from './account-messages.ts';
import { AccountSection } from './account-section.tsx';
import { useSubmitFailure } from './use-submit-failure.ts';

export interface ProfileSectionProps {
  readonly viewer: AdminViewer;
}

interface SavedProfile {
  readonly count: number;
  readonly values: AdminProfileFormInput;
}

const profileValuesOf = ({
  nickname,
  title,
  avatar,
}: {
  readonly nickname: string | null;
  readonly title: string | null;
  readonly avatar: { readonly id: string } | null;
}): AdminProfileFormInput => ({
  nickname: nickname ?? '',
  title: title ?? '',
  avatarFileId: avatar?.id ?? null,
});

export function ProfileSection({ viewer }: ProfileSectionProps) {
  const form = useAppForm(ADMIN_PROFILE_FORM_SCHEMA, {
    defaultValues: profileValuesOf(viewer),
  });
  const updateProfile = useMutation(
    graphqlMutationOptions(AdminUpdateProfileDocument),
  );
  const refreshViewer = useAdminViewerRefresh();
  const { failure, clearFailure, onSubmitError } = useSubmitFailure();
  const [saved, setSaved] = useState<SavedProfile>();
  const { reset } = form;

  // 送信の処理の中で値を戻すと送信の完了の状態の更新と重なるため、保存できた後に保存した値(前後の空白を除いた値)へ戻す
  useEffect(() => {
    if (saved !== undefined) {
      reset(saved.values);
    }
  }, [saved, reset]);

  return (
    <AccountSection
      title={PROFILE_SECTION_TITLE}
      description={PROFILE_SECTION_DESCRIPTION}
    >
      <AppForm
        form={form}
        aria-label={PROFILE_SECTION_TITLE}
        onSubmit={async (values) => {
          clearFailure();
          const { updateAdminProfile } = await updateProfile.mutateAsync({
            variables: { id: viewer.id, ...values },
          });
          notify.success(PROFILE_SAVED_MESSAGE);
          // ヘッダーのニックネームと画像、この区画の登録済みの画像を新しい値で描き直させる
          await refreshViewer();
          setSaved((current) => ({
            count: (current?.count ?? 0) + 1,
            values: profileValuesOf(updateAdminProfile),
          }));
        }}
        onSubmitError={onSubmitError}
        className="flex flex-col gap-5"
      >
        {failure === undefined ? null : (
          <FormMessage role="alert">{failure}</FormMessage>
        )}
        <AdminProfileFields
          control={form.control}
          currentAvatar={viewer.avatar}
          nickname={viewer.nickname}
          avatarSession={saved?.count ?? 0}
        />
        <SubmitButton className="self-start">
          {PROFILE_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
    </AccountSection>
  );
}
