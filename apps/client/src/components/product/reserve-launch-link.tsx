import { Link } from '@tanstack/react-router';
import { RocketIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ButtonSize } from '../../../lib/components/ui/button/button-variants.ts';
import { NEW_PRODUCT_HREF } from '../layout/site-links.ts';
import {
  RESERVE_LAUNCH_GUEST_LABEL,
  RESERVE_LAUNCH_LABEL,
} from './launch-messages.ts';

export interface ReserveLaunchLinkProps {
  readonly signedIn: boolean;
  readonly size?: ButtonSize;
  readonly className?: string;
}

// 遷移先は共通ヘッダーの「ローンチする」と同じく、未ログインはプロダクト登録を戻り先にしたログイン、ログイン中はプロダクト登録
export function ReserveLaunchLink({
  signedIn,
  size,
  className,
}: ReserveLaunchLinkProps) {
  const content = (
    <>
      <RocketIcon aria-hidden="true" />
      {signedIn ? RESERVE_LAUNCH_LABEL : RESERVE_LAUNCH_GUEST_LABEL}
    </>
  );
  return (
    <Button asChild size={size} className={className}>
      {signedIn ? (
        <PathLink href={NEW_PRODUCT_HREF}>{content}</PathLink>
      ) : (
        <Link to="/auth/login" search={{ redirect: NEW_PRODUCT_HREF }}>
          {content}
        </Link>
      )}
    </Button>
  );
}
