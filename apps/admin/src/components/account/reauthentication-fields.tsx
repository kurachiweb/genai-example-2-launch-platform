import { useEffect, useRef } from 'react';
import {
  type Control,
  type FieldPath,
  type FieldValues,
  useFormContext,
} from 'react-hook-form';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import {
  RECOVERY_CODE_DESCRIPTION,
  RECOVERY_CODE_LABEL,
  REQUIRED_SUFFIX,
  TOTP_CODE_DESCRIPTION,
  TOTP_CODE_LABEL,
  USE_RECOVERY_CODE_LABEL,
  USE_TOTP_CODE_LABEL,
} from '../auth/admin-auth-messages.ts';
import type { ReauthenticationMode } from './account-form-schemas.ts';
import {
  CURRENT_PASSWORD_LABEL,
  REAUTHENTICATION_LEGEND,
} from './account-messages.ts';

export interface ReauthenticationFieldNames<TFieldValues extends FieldValues> {
  readonly current: FieldPath<TFieldValues>;
  readonly totpCode: FieldPath<TFieldValues>;
  readonly recoveryCode: FieldPath<TFieldValues>;
}

export interface ReauthenticationFieldsProps<
  TFieldValues extends FieldValues,
  TTransformedValues,
> {
  readonly control: Control<TFieldValues, unknown, TTransformedValues>;
  readonly names: ReauthenticationFieldNames<TFieldValues>;
  readonly mode: ReauthenticationMode;
  readonly onToggleSecondFactor: () => void;
}

export function ReauthenticationFields<
  TFieldValues extends FieldValues,
  TTransformedValues,
>({
  control,
  names,
  mode,
  onToggleSecondFactor,
}: ReauthenticationFieldsProps<TFieldValues, TTransformedValues>) {
  const { setFocus } = useFormContext<TFieldValues>();
  const previousModeRef = useRef(mode);

  // 切り替えの前の欄は描かれなくなるため、切り替えた時だけ描いた第2要素の欄へフォーカスを移す
  useEffect(() => {
    if (previousModeRef.current === mode) {
      return;
    }
    previousModeRef.current = mode;
    setFocus(mode === 'totp' ? names.totpCode : names.recoveryCode);
  }, [mode, names.totpCode, names.recoveryCode, setFocus]);

  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="mb-3 text-sm font-bold">
        {REAUTHENTICATION_LEGEND}
      </legend>
      <FormField
        control={control}
        name={names.current}
        label={`${CURRENT_PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
      >
        {(field) => (
          <PasswordInput
            {...field}
            autoComplete="current-password"
            aria-required
          />
        )}
      </FormField>
      {mode === 'totp' ? (
        <FormField
          key={mode}
          control={control}
          name={names.totpCode}
          label={`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`}
          description={TOTP_CODE_DESCRIPTION}
        >
          {(field) => (
            <Input
              {...field}
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-required
            />
          )}
        </FormField>
      ) : (
        <FormField
          key={mode}
          control={control}
          name={names.recoveryCode}
          label={`${RECOVERY_CODE_LABEL}${REQUIRED_SUFFIX}`}
          description={RECOVERY_CODE_DESCRIPTION}
        >
          {(field) => (
            <Input {...field} autoComplete="off" translate="no" aria-required />
          )}
        </FormField>
      )}
      <Button
        type="button"
        variant="link"
        className="self-start px-0"
        // 押した時に入力欄からフォーカスが外れると、未入力のエラーが切り替えのボタンの上に出てボタンが押している間に動き、押した操作が失われるため、押下ではフォーカスを移さない
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onToggleSecondFactor}
      >
        {mode === 'totp' ? USE_RECOVERY_CODE_LABEL : USE_TOTP_CODE_LABEL}
      </Button>
    </fieldset>
  );
}
