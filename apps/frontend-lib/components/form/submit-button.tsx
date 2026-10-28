import { LoaderCircleIcon } from 'lucide-react';
import { useFormState } from 'react-hook-form';

import { Button, type ButtonProps } from '../ui/button/button.tsx';

export interface SubmitButtonProps extends Omit<
  ButtonProps,
  'type' | 'disabled' | 'asChild'
> {
  readonly pendingLabel?: string;
}

const DEFAULT_PENDING_LABEL = '送信中';

export function SubmitButton({
  pendingLabel = DEFAULT_PENDING_LABEL,
  children,
  ...props
}: SubmitButtonProps) {
  const { isValid, isSubmitting, errors } = useFormState();
  // setErrorで欄に付けたエラーは、別の欄の再検証でisValidがスキーマ全体の結果に戻った後も残るため、欄のエラーの有無を別に数える。rootは欄の再検証で消えず次の送信まで残るため数えない
  const hasFieldErrors = Object.keys(errors).some((name) => name !== 'root');

  // フォーカスのあるボタンをdisabledにするとフォーカスが文書の先頭へ失われるため、送信中はaria-disabledで示してフォーカスを保ち、重ねての送信はフォームの側で止める

  return (
    <Button
      type="submit"
      disabled={(!isValid || hasFieldErrors) && !isSubmitting}
      aria-disabled={isSubmitting ? true : undefined}
      aria-busy={isSubmitting ? true : undefined}
      {...props}
    >
      {isSubmitting ? (
        <>
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
