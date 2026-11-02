import { RocketIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { loginHrefFor } from '../auth/login-href.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { PathLink } from '../navigation/path-link.tsx';
import { LAUNCH_LABEL, NEW_PRODUCT_HREF } from './site-links.ts';

export function LaunchAction() {
  const viewer = useViewer();
  const href =
    viewer === null ? loginHrefFor(NEW_PRODUCT_HREF) : NEW_PRODUCT_HREF;

  return (
    <Button asChild size="sm">
      <PathLink href={href}>
        <RocketIcon aria-hidden="true" />
        {LAUNCH_LABEL}
      </PathLink>
    </Button>
  );
}
