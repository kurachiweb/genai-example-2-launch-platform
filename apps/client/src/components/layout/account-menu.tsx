import { Button } from '../../../lib/components/ui/button/button.tsx';
import { useViewer } from '../auth/use-viewer.ts';
import { PathLink } from '../navigation/path-link.tsx';
import { LOGIN_LINK, REGISTER_LINK } from './site-links.ts';
import { UserMenu } from './user-menu.tsx';

export function AccountMenu() {
  const viewer = useViewer();

  if (viewer !== null) {
    return <UserMenu viewer={viewer} />;
  }
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <PathLink href={LOGIN_LINK.href}>{LOGIN_LINK.label}</PathLink>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <PathLink href={REGISTER_LINK.href}>{REGISTER_LINK.label}</PathLink>
      </Button>
    </>
  );
}
