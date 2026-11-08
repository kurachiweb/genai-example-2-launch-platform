import { useLocation } from '@tanstack/react-router';
import { UserPlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LoginRequiredDialog } from '../auth/login-required-dialog.tsx';
import type { FollowButtonSize } from './follow-button-types.ts';
import {
  FOLLOW_LABEL,
  FOLLOW_LOGIN_REQUIRED_DESCRIPTION,
  FOLLOW_LOGIN_REQUIRED_TITLE,
} from './profile-messages.ts';

export interface FollowLoginButtonProps {
  readonly size: FollowButtonSize;
  readonly className?: string | undefined;
}

export function FollowLoginButton({ size, className }: FollowLoginButtonProps) {
  const [open, setOpen] = useState(false);
  const returnTo = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className={className}
        onClick={() => {
          setOpen(true);
        }}
      >
        <UserPlusIcon aria-hidden="true" />
        {FOLLOW_LABEL}
      </Button>
      <LoginRequiredDialog
        open={open}
        onOpenChange={setOpen}
        title={FOLLOW_LOGIN_REQUIRED_TITLE}
        description={FOLLOW_LOGIN_REQUIRED_DESCRIPTION}
        returnTo={returnTo}
      />
    </>
  );
}
