import { useSuspenseQueries } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ultrasOfferQueryOptions,
  viewerUltrasQueryOptions,
} from '../../graphql/ultras.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { PLAN_PAGE_TITLE } from './plan-messages.ts';
import { PlanStatusPanel } from './plan-status-panel.tsx';
import { PortalButton } from './portal-button.tsx';
import { PortalReturnNotice } from './portal-return-notice.tsx';

export interface PlanPageProps {
  readonly viewer: ClientViewer;
  readonly portalReturned: boolean;
}

// 読み込み中と取得の失敗の間も題名を残すため、題名は内容を包む枠として描く。再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする
function PlanPageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <h1
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {PLAN_PAGE_TITLE}
      </h1>
      {children}
    </div>
  );
}

function PlanPageContent({ viewer, portalReturned }: PlanPageProps) {
  const [{ data: offer }, { data: viewerUltras }] = useSuspenseQueries({
    queries: [ultrasOfferQueryOptions(), viewerUltrasQueryOptions(viewer)],
  });
  const ultras = viewerUltras.viewerUltras;
  const { promotionEnabled, price } = offer.ultrasOffer;

  return (
    <>
      {portalReturned ? <PortalReturnNotice viewer={viewer} /> : null}
      <PlanStatusPanel
        viewer={viewer}
        plan={ultras?.plan ?? null}
        promotionEnabled={promotionEnabled}
        price={price}
      />
      {ultras?.canOpenPortal === true ? <PortalButton /> : null}
    </>
  );
}

// 加入状態の表示とCustomer Portalへの導線だけを置き、確定の変更はこの画面から呼ばない(Portalでの操作の反映はWebhookだけで行う)。取得の失敗は題名を残したまま再試行と問い合わせの導線を示す
export function PlanPage({ viewer, portalReturned }: PlanPageProps) {
  return (
    <RecoverableSlot
      className="rounded-sm"
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
      frame={(content) => <PlanPageFrame>{content}</PlanPageFrame>}
    >
      <PlanPageFrame>
        <PlanPageContent viewer={viewer} portalReturned={portalReturned} />
      </PlanPageFrame>
    </RecoverableSlot>
  );
}
