import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { CATEGORY_SECTIONS } from '../../composition/category-sections.ts';
import {
  CATEGORIES_DESCRIPTION,
  CATEGORIES_TITLE,
} from '../categories/categories-messages.ts';
import { CategorySectionsView } from '../categories/category-sections-view.tsx';

export function CategoriesPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={CATEGORIES_TITLE}
        description={CATEGORIES_DESCRIPTION}
      />
      <CategorySectionsView sections={CATEGORY_SECTIONS} />
    </div>
  );
}
