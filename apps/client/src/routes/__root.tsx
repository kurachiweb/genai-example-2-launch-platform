import { createRootRouteWithContext } from '@tanstack/react-router';

import { AppDocument } from '../../lib/components/app-shell/app-document.tsx';
import type { RouterContext } from '../../lib/start/router-context.ts';

export const Route = createRootRouteWithContext<RouterContext>()({
  shellComponent: AppDocument,
});
