import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import type {
  InquiryDetailAction,
  InquiryDetailActionContext,
} from '../../composition/inquiry-detail-actions.ts';

export interface InquiryDetailActionsViewProps {
  readonly actions: readonly InquiryDetailAction[];
  readonly inquiry: InquiryDetailActionContext;
}

// 後続specが登録した操作を順序どおりに並べ、1つの操作の描画や取得の失敗はその操作の位置に留めて詳細と他の操作の表示を続ける。登録が無ければ見出しや空状態も含めて何も描かない
export function InquiryDetailActionsView({
  actions,
  inquiry,
}: InquiryDetailActionsViewProps) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4">
      {actions
        .toSorted((a, b) => a.order - b.order)
        .map(({ id, component: Action }) => (
          <RecoverableSlot
            key={id}
            className="rounded-sm"
            contactAvailable={ADMIN_PROFILE.contactAvailable}
          >
            <Action inquiry={inquiry} />
          </RecoverableSlot>
        ))}
    </div>
  );
}
