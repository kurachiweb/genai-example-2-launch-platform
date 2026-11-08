import { BIO_MAX_GRAPHEMES } from '../../../common-lib/profile/profile-input-rules.ts';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { MarkdownEditor } from '../../../lib/components/markdown-editor/markdown-editor.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import type { ProfileEditFormApi } from './profile-edit-form-types.ts';
import { BIO_FIELD_LABEL, BIO_PLACEHOLDER } from './profile-form-messages.ts';

export interface ProfileBioFieldProps {
  readonly form: ProfileEditFormApi;
  readonly disabled: boolean;
}

export function ProfileBioField({ form, disabled }: ProfileBioFieldProps) {
  // 公開プロフィールの自己紹介と同じ指定で描き、本文の識別子だけ入力欄の中と分ける
  const preview = useMarkdownOptions({
    externalLinkRel: ['noopener', 'ugc'],
    sameOriginLinkRel: ['ugc'],
    idScope: 'preview',
  });

  return (
    <FormField
      control={form.control}
      name="bio"
      label={BIO_FIELD_LABEL}
      disabled={disabled}
    >
      {(control) => (
        <MarkdownEditor
          value={control.value}
          onValueChange={control.onChange}
          onBlur={control.onBlur}
          ref={control.ref}
          labelId={control.labelId}
          describedById={control['aria-describedby']}
          invalid={control['aria-invalid'] === true}
          disabled={control.disabled === true}
          maxGraphemes={BIO_MAX_GRAPHEMES}
          placeholder={BIO_PLACEHOLDER}
          preview={preview}
        />
      )}
    </FormField>
  );
}
