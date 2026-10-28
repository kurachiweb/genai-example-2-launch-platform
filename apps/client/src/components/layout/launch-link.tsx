import { RocketIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LAUNCH_LINK } from './site-links.ts';

export function LaunchLink() {
  return (
    <Button asChild size="sm">
      <a href={LAUNCH_LINK.href}>
        <RocketIcon aria-hidden="true" />
        {LAUNCH_LINK.label}
      </a>
    </Button>
  );
}
