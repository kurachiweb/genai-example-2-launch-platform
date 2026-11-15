import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import type { AdminSettingsSection } from '../../composition/admin-settings-sections.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { SectionFallback } from '../layout/section-fallback.tsx';

export interface AdminSettingsSectionsViewProps {
  readonly sections: readonly AdminSettingsSection[];
}

// 各機能が登録した設定の区画を順序どおりに並べ、1つの区画の描画や取得の失敗はその区画の位置に留めて他の区画の表示を続ける
export function AdminSettingsSectionsView({
  sections,
}: AdminSettingsSectionsViewProps) {
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
