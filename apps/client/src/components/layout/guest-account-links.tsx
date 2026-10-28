import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LOGIN_LINK, REGISTER_LINK } from './site-links.ts';

export function GuestAccountLinks() {
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <a href={LOGIN_LINK.href}>{LOGIN_LINK.label}</a>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <a href={REGISTER_LINK.href}>{REGISTER_LINK.label}</a>
      </Button>
    </>
  );
}
