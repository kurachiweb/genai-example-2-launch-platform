import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderHome } from '../components/pages/placeholder-home.tsx';
import { buildAdminPageHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/')({
  head: () => buildAdminPageHead({ title: '' }),
  component: PlaceholderHome,
});
