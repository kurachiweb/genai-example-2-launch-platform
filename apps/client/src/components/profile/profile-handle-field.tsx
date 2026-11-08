import { useQueryClient } from '@tanstack/react-query';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { SERVER_FIELD_ERROR_TYPE } from '../../../lib/utilities/forms/server-field-errors.ts';
import { fetchHandleAvailability } from '../../graphql/handle-availability.ts';
import type { ProfileEditFormApi } from './profile-edit-form-types.ts';
import {
  HANDLE_FIELD_LABEL,
  PROFILE_FORM_MESSAGES,
  previousHandleGuidanceOf,
} from './profile-form-messages.ts';

export interface ProfileHandleFieldProps {
  readonly form: ProfileEditFormApi;
  // 読み込んだ時点のハンドル。サーバーが使用可として扱う値のため、問い合わせない
  readonly currentHandle: string;
  readonly previousHandle: string | null;
  readonly disabled: boolean;
}

export function ProfileHandleField({
  form,
  currentHandle,
  previousHandle,
  disabled,
}: ProfileHandleFieldProps) {
  const queryClient = useQueryClient();

  // 形式が正しい時だけ問い合わせ、応答を待つ間に値が変わっていれば古い応答を捨てる。肯定の表示は作らない
  const checkAvailability = async (handle: string): Promise<void> => {
    if (handle === currentHandle || !(await form.trigger('handle'))) {
      return;
    }
    const availability = await fetchHandleAvailability(queryClient, handle);
    if (availability !== 'UNAVAILABLE' || form.getValues('handle') !== handle) {
      return;
    }
    form.setError('handle', {
      type: SERVER_FIELD_ERROR_TYPE,
      message: PROFILE_FORM_MESSAGES.handleUnavailable,
    });
  };

  return (
    <FormField
      control={form.control}
      name="handle"
      label={HANDLE_FIELD_LABEL}
      description={
        previousHandle === null
          ? undefined
          : previousHandleGuidanceOf(previousHandle)
      }
      disabled={disabled}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <span
            data-slot="handle-prefix"
            aria-hidden="true"
            className="text-muted-foreground"
          >
            @
          </span>
          <Input
            {...control}
            onBlur={() => {
              control.onBlur();
              void checkAvailability(control.value);
            }}
            aria-required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      )}
    </FormField>
  );
}
