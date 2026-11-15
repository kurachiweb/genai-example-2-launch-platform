import { createFileRoute } from '@tanstack/react-router';

import { redirectToFirstSettings } from '../../../components/settings/redirect-to-first-settings.ts';

export const Route = createFileRoute('/_authenticated/settings/')({
  beforeLoad: redirectToFirstSettings,
});
