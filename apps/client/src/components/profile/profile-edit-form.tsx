import { useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import {
  type TurnstileTokenController,
  useTurnstileToken,
} from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { PROFILE_BOT_ACTIONS } from './bot-actions.ts';
import type { MyProfileView } from './my-profile-view.ts';
import { ProfileAvatarField } from './profile-avatar-field.tsx';
import { ProfileBioField } from './profile-bio-field.tsx';
import { ProfileEditSuspendedNotice } from './profile-edit-suspended-notice.tsx';
import {
  AVATAR_FIELD_LABEL,
  HEADLINE_FIELD_LABEL,
  NICKNAME_FIELD_LABEL,
  PROFILE_FORM_LABEL,
  PROFILE_SAVE_LABEL,
} from './profile-form-messages.ts';
import { profileFormDefaultsOf } from './profile-form-defaults.ts';
import {
  PROFILE_FORM_SCHEMA,
  type ProfileFormInput,
  type ProfileFormValues,
} from './profile-form-schema.ts';
import { ProfileHandleField } from './profile-handle-field.tsx';
import { ProfileWebsiteFields } from './profile-website-fields.tsx';

export interface ProfileEditFormProps {
  // フォームは初期値として読み込んだ時点の値を使う。取得し直した値は、呼び出し側がフォームを作り直して反映する
  readonly profile: MyProfileView;
  // 保存の送信。bot対策のトークンは、呼び出し側が`sendWithTurnstile`で取り出して送る
  readonly onSave: (
    values: ProfileFormValues,
    turnstile: TurnstileTokenController,
  ) => Promise<void>;
}

export function ProfileEditForm({ profile, onSave }: ProfileEditFormProps) {
  const [defaultValues] = useState(() => profileFormDefaultsOf(profile));
  const form = useAppForm<ProfileFormInput, ProfileFormValues>(
    PROFILE_FORM_SCHEMA,
    { defaultValues },
  );
  const turnstile = useTurnstileToken();
  const [submitError, setSubmitError] = useState<string>();
  const { suspended } = profile;

  return (
    <AppForm
      form={form}
      aria-label={PROFILE_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await onSave(values, turnstile);
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-6"
    >
      {suspended ? <ProfileEditSuspendedNotice /> : null}
      <FormField
        control={form.control}
        name="avatarFileId"
        label={AVATAR_FIELD_LABEL}
        disabled={suspended}
      >
        {(control) => (
          <ProfileAvatarField
            value={control.value}
            onChange={control.onChange}
            current={profile.avatar}
            nickname={profile.nickname}
            handle={profile.handle}
            disabled={control.disabled === true}
            fieldRef={control.ref}
            aria-labelledby={control.labelId}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
          />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="nickname"
        label={NICKNAME_FIELD_LABEL}
        disabled={suspended}
      >
        {(control) => <Input {...control} aria-required />}
      </FormField>
      <ProfileHandleField
        form={form}
        currentHandle={profile.handle}
        previousHandle={profile.previousHandle}
        disabled={suspended}
      />
      <FormField
        control={form.control}
        name="headline"
        label={HEADLINE_FIELD_LABEL}
        disabled={suspended}
      >
        {(control) => <Input {...control} />}
      </FormField>
      <ProfileBioField form={form} disabled={suspended} />
      <ProfileWebsiteFields form={form} disabled={suspended} />
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={PROFILE_BOT_ACTIONS.update}
      />
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <SubmitButton className="self-start" disabled={suspended}>
        {PROFILE_SAVE_LABEL}
      </SubmitButton>
    </AppForm>
  );
}
