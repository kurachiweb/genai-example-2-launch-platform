import { createFileRoute } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import { MySponsorshipList } from '../../../components/sponsorship/my-sponsorship-list.tsx';
import { MY_SPONSORSHIPS_PAGE_TITLE } from '../../../components/sponsorship/sponsorship-messages.ts';
import { loadMySponsorships } from '../../../graphql/sponsorship.ts';
import { buildMySponsorshipsHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない
export const Route = createFileRoute('/_authenticated/settings/sponsorships')({
  loader: loadMySponsorships,
  head: buildMySponsorshipsHead,
  component: SponsorshipsSettingsRoute,
});

function SponsorshipsSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {MY_SPONSORSHIPS_PAGE_TITLE}
      </h1>
      <MySponsorshipList
        viewerId={viewer.id}
        labelledBy={headingId}
        retryFocusRef={headingRef}
      />
    </div>
  );
}
