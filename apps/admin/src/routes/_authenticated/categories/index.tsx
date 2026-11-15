import { createFileRoute } from '@tanstack/react-router';

import { CATEGORIES_TITLE } from '../../../components/categories/categories-messages.ts';
import { CategoriesPage } from '../../../components/pages/categories-page.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/categories/')({
  head: () => buildAdminPageHead({ title: CATEGORIES_TITLE }),
  component: CategoriesPage,
});
