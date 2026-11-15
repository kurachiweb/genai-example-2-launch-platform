import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type { CategorySection } from '../../composition/category-sections.ts';
import { SectionFallback } from '../layout/section-fallback.tsx';

export interface CategorySectionsViewProps {
  readonly sections: readonly CategorySection[];
}

// 各specが登録したカテゴリマスタの区画を順序どおりに並べ、1つの区画の描画や取得の失敗はその区画の位置に留めて他の区画の表示を続ける
export function CategorySectionsView({ sections }: CategorySectionsViewProps) {
  return (
    <div className="flex flex-col gap-10">
      {sections
        .toSorted((a, b) => a.order - b.order)
        .map(({ id, title, component: Section }) => (
          <RecoverableSlot
            key={id}
            className="rounded-sm"
            contactAvailable={ADMIN_PROFILE.contactAvailable}
            frame={(content) => (
              <SectionFallback title={title}>{content}</SectionFallback>
            )}
          >
            <Section />
          </RecoverableSlot>
        ))}
    </div>
  );
}
