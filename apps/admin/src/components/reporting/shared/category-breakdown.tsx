import type { ReportCategoryCountView } from '../../../graphql/admin-reporting-cases.ts';
import { categoryCountLabel } from './report-messages.ts';

export interface CategoryBreakdownProps {
  readonly counts: readonly ReportCategoryCountView[];
}

// カテゴリごとに1行で、カテゴリ名と件数を示す
export function CategoryBreakdown({ counts }: CategoryBreakdownProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {counts.map(({ categoryId, name, count }) => (
        <li key={categoryId}>{categoryCountLabel(name, count)}</li>
      ))}
    </ul>
  );
}
