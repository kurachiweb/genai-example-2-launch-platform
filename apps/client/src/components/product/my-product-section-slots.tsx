import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import type {
  MyProductSection,
  MyProductSectionContext,
} from './product-section-types.ts';

export interface MyProductSectionSlotsProps {
  // orderの順に並べ替え済みの登録
  readonly sections: readonly MyProductSection[];
  readonly product: MyProductSectionContext;
}

// 区画ごとにエラーの境界で包み、1つの区画の取得や描画の失敗をその位置に留めて、他の区画とカードの表示を続ける
export function MyProductSectionSlots({
  sections,
  product,
}: MyProductSectionSlotsProps) {
  if (sections.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ id, component: Section }) => (
        <RecoverableSlot
          key={id}
          className="rounded-xl"
          contactAvailable={CLIENT_PROFILE.contactAvailable}
          contactHref={CONTACT_HREF}
        >
          <Section product={product} />
        </RecoverableSlot>
      ))}
    </div>
  );
}
