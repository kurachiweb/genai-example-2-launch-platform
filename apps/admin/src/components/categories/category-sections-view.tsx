import { type ReactNode, useId } from 'react';

import type { CategorySection } from '../../composition/category-sections.ts';
import { RecoverableSlot } from '../layout/recoverable-slot.tsx';

export interface CategorySectionsViewProps {
  readonly sections: readonly CategorySection[];
}

// 区画の部品はCategoryMasterEditorで自分の見出しを描くため、見出しは部品が描けない読み込み中と失敗の間だけここで描く
function SectionFallback({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
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
