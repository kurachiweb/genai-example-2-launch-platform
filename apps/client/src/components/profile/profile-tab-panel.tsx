import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { ProfileTabPanelSkeleton } from './profile-tab-panel-skeleton.tsx';
import type {
  PublicProfileSectionComponent,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';

export interface ProfileTabPanelProps {
  readonly Panel: PublicProfileSectionComponent;
  readonly context: PublicProfileSectionContext;
}

// タブごとに呼び出し側でkeyを替え、前のタブの読み込みや失敗の状態を持ち越さない。取得の待ちと失敗はこの枠に留め、人物情報とタブを保つ
export function ProfileTabPanel({ Panel, context }: ProfileTabPanelProps) {
  return (
    <RecoverableSlot
      className="rounded-xl"
      fallback={<ProfileTabPanelSkeleton />}
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
    >
      <Panel {...context} />
    </RecoverableSlot>
  );
}
