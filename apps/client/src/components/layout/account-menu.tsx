import { Link } from '@tanstack/react-router';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LOGIN_LABEL, REGISTER_LABEL } from '../auth/account-messages.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { UserMenu } from './user-menu.tsx';

export function AccountMenu() {
  const viewer = useViewer();

  if (viewer !== null) {
    return <UserMenu viewer={viewer} />;
  }
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link to="/auth/login">{LOGIN_LABEL}</Link>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link to="/auth/register">{REGISTER_LABEL}</Link>
      </Button>
    </>
  );
}
