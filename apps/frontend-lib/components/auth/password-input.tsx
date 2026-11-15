import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { type ComponentProps, useState } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { SHOW_PASSWORD_LABEL } from '../../utilities/messages/auth-messages.ts';
import { Button } from '../ui/button/button.tsx';
import { Input } from '../ui/input/input.tsx';

export type PasswordAutoComplete = 'current-password' | 'new-password';

export interface PasswordInputProps extends Omit<
  ComponentProps<'input'>,
  'type' | 'autoComplete'
> {
  readonly autoComplete: PasswordAutoComplete;
}

export function PasswordInput({
  className,
  disabled,
  id,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      data-slot="password-input"
      className={cn('relative min-w-0', className)}
    >
      <Input
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className="pr-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={SHOW_PASSWORD_LABEL}
        aria-pressed={visible}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
      >
        {visible ? (
          <EyeOffIcon aria-hidden="true" />
        ) : (
          <EyeIcon aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
