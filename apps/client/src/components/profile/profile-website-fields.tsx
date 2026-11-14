import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useFormState } from 'react-hook-form';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { PROFILE_WEBSITES_MAX } from '../../../common-lib/profile/profile-input-rules.ts';
import type { ProfileEditFormApi } from './profile-edit-form-types.ts';
import { WEBSITE_ADD_LABEL, WEBSITES_LEGEND } from './profile-form-messages.ts';
import { EMPTY_WEBSITE_ROW } from './profile-form-schema.ts';
import { ProfileWebsiteRow } from './profile-website-row.tsx';

export interface ProfileWebsiteFieldsProps {
  readonly form: ProfileEditFormApi;
  readonly disabled: boolean;
}

export function ProfileWebsiteFields({
  form,
  disabled,
}: ProfileWebsiteFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'websites',
  });
  const { errors } = useFormState({ control: form.control, name: 'websites' });
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // 押した「削除」は消えるため、削除の後の描画で追加のボタンへフォーカスを移す。10件の時は追加のボタンが無効で、削除の後の描画で有効に戻る
  const [removalCount, setRemovalCount] = useState(0);
  const listError = errors.websites?.root?.message ?? errors.websites?.message;

  useEffect(() => {
    if (removalCount > 0) {
      addButtonRef.current?.focus();
    }
  }, [removalCount]);

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 text-sm leading-none font-medium">
        {WEBSITES_LEGEND}
      </legend>
      {fields.length === 0 ? null : (
        <ul className="flex flex-col gap-4">
          {fields.map((item, index) => (
            <li key={item.id}>
              <ProfileWebsiteRow
                form={form}
                index={index}
                disabled={disabled}
                onRemove={() => {
                  remove(index);
                  setRemovalCount((count) => count + 1);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {listError === undefined ? null : <FormMessage>{listError}</FormMessage>}
      <Button
        ref={addButtonRef}
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || fields.length >= PROFILE_WEBSITES_MAX}
        onClick={() => {
          append(EMPTY_WEBSITE_ROW);
        }}
      >
        {WEBSITE_ADD_LABEL}
      </Button>
    </fieldset>
  );
}
