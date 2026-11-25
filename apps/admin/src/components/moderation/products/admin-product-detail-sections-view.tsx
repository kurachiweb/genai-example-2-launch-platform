import { type ReactNode, useId } from 'react';

import { RecoverableSlot } from '../../../../lib/components/state/recoverable-slot.tsx';
import type {
  AdminProductDetailContext,
  AdminProductDetailSection,
} from '../../../composition/admin-product-detail-sections.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';

export interface AdminProductDetailSectionsViewProps {
  readonly sections: readonly AdminProductDetailSection[];
  readonly product: AdminProductDetailContext;
}

interface SectionFrameProps {
  readonly title: string;
  readonly children: ReactNode;
}

// 区画が見出しを描けない読み込み中と失敗の間だけ、登録の題名を見出しにして位置を示す
function SectionFrame({ title, children }: SectionFrameProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  );
}

// 後続specが登録した区画を順序どおりに並べ、1つの区画の描画や取得の失敗はその区画の位置に留めて詳細と他の区画の表示を続ける。登録が無ければ何も描かない
export function AdminProductDetailSectionsView({
  sections,
  product,
}: AdminProductDetailSectionsViewProps) {
  if (sections.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-8">
      {sections
        .toSorted((a, b) => a.order - b.order)
        .map(({ id, title, component: Section }) => (
          <RecoverableSlot
            key={id}
            className="rounded-sm"
            contactAvailable={ADMIN_PROFILE.contactAvailable}
            frame={(content) => (
              <SectionFrame title={title}>{content}</SectionFrame>
            )}
          >
            <Section product={product} />
          </RecoverableSlot>
        ))}
    </div>
  );
}
