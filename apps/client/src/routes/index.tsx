import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderHome } from '../components/pages/placeholder-home.tsx';
import { buildSitePageHead } from '../head/page-heads.ts';

export const Route = createFileRoute('/')({
  head: () => buildSitePageHead({ title: '', canonicalUrl: '/' }),
  component: PlaceholderHome,
});
