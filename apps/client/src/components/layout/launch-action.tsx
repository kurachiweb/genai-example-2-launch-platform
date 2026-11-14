import { Link } from '@tanstack/react-router';
import { RocketIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { useViewer } from '../auth/use-viewer.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { LAUNCH_LABEL, NEW_PRODUCT_HREF } from './site-links.ts';

export function LaunchAction() {
  const viewer = useViewer();
  const content = (
    <>
      <RocketIcon aria-hidden="true" />
      {LAUNCH_LABEL}
    </>
  );

  return (
    <Button asChild size="sm">
      {viewer === null ? (
        <Link to="/auth/login" search={{ redirect: NEW_PRODUCT_HREF }}>
          {content}
        </Link>
      ) : (
        <PathLink href={NEW_PRODUCT_HREF}>{content}</PathLink>
      )}
    </Button>
  );
}
