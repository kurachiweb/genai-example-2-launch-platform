import { useCallback, useEffect, useMemo, useState } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF, SITE_NAME } from '../layout/site-links.ts';
import { AutoRefreshSwitch } from './auto-refresh-switch.tsx';
import { GuestHero } from './guest-hero.tsx';
import { groupTopPageSections } from './top-page-section-order.ts';
import type {
  TopPageSection,
  TopPageSectionContext,
} from './top-page-section-types.ts';

export interface TopPageProps {
  // 区画の登録口(TOP_PAGE_SECTIONS)。置き場所ごとにorderの順で並べる
  readonly sections: readonly TopPageSection[];
  readonly board: TopPageSectionContext['board'];
  readonly signedIn: boolean;
  // 当日の予選の対戦カードがあるか。定期の取り直しと演出を持つため、自動更新の切り替えを描く
  readonly hasQualifierMatches: boolean;
}

type ReportAutoUpdating = (sectionId: string, active: boolean) => void;

interface SectionSlotProps {
  readonly section: TopPageSection;
  readonly board: TopPageSectionContext['board'];
  readonly viewer: TopPageSectionContext['viewer'];
  readonly autoRefresh: boolean;
  readonly onReport: ReportAutoUpdating;
}

// 区画が描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、区画の要素そのものを上部の行のグリッドや列の項目にする。
// 該当せずnullを描いた区画が空のセルや列の間隔を残さないようにする。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const SECTION_SLOT_CLASS = 'has-[>[data-top-page-section-rendered]]:contents';

// 区画のエラーの境界の内側に置き、境界が例外を捕まえて区画を外した時とページから区画が外れた時に、その区画の申告を消す
function AutoUpdatingReportScope({ onEnd }: { readonly onEnd: () => void }) {
  useEffect(() => onEnd, [onEnd]);
  return null;
}

function SectionSlot({
  section,
  board,
  viewer,
  autoRefresh,
  onReport,
}: SectionSlotProps) {
  const { id, component: Section } = section;
  const reportAutoUpdating = useCallback(
    (active: boolean) => {
      onReport(id, active);
    },
    [onReport, id],
  );
  const endReport = useCallback(() => {
    onReport(id, false);
  }, [onReport, id]);
  return (
    <RecoverableSlot
      className={SECTION_SLOT_CLASS}
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
    >
      <AutoUpdatingReportScope onEnd={endReport} />
      <Section
        board={board}
        viewer={viewer}
        autoRefresh={autoRefresh}
        reportAutoUpdating={reportAutoUpdating}
      />
      <span hidden data-top-page-section-rendered="" />
    </RecoverableSlot>
  );
}

const withReport = (
  reports: ReadonlySet<string>,
  sectionId: string,
  active: boolean,
): ReadonlySet<string> => {
  if (reports.has(sectionId) === active) {
    return reports;
  }
  return active
    ? new Set([...reports, sectionId])
    : new Set([...reports].filter((id) => id !== sectionId));
};

// 上部の行(先頭に自動更新の切り替え)→未ログインの案内→全幅の注目→本文の列と横の列→フッター直上の順に置き、区画ごとにエラーの境界で包む。
// 自動更新の状態はページを開くたびにオンから始め、全ての区画へ渡してページの根の属性で演出を止める
export function TopPage({
  sections,
  board,
  signedIn,
  hasQualifierMatches,
}: TopPageProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [reports, setReports] = useState<ReadonlySet<string>>(() => new Set());
  const onReport = useCallback<ReportAutoUpdating>((sectionId, active) => {
    setReports((current) => withReport(current, sectionId, active));
  }, []);
  const viewer = useMemo(() => ({ signedIn }), [signedIn]);
  const groups = useMemo(() => groupTopPageSections(sections), [sections]);
  const switchVisible =
    board.phase === 'LIVE' || hasQualifierMatches || reports.size > 0;

  const slotsOf = (placement: keyof typeof groups) =>
    groups[placement].map((section) => (
      <SectionSlot
        key={section.id}
        section={section}
        board={board}
        viewer={viewer}
        autoRefresh={autoRefresh}
        onReport={onReport}
      />
    ));

  return (
    <div
      data-auto-refresh={autoRefresh ? 'on' : 'off'}
      className="flex flex-col pb-10"
    >
      <h1 className="sr-only">{SITE_NAME}</h1>
      <div className="mx-auto w-full max-w-7xl px-4 pt-4">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {switchVisible && (
            <AutoRefreshSwitch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
          )}
          {slotsOf('banner')}
        </div>
      </div>
      {!signedIn && (
        <div className="mx-auto w-full max-w-7xl px-4">
          <GuestHero />
        </div>
      )}
      <div className="flex flex-col">{slotsOf('showcase')}</div>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pt-10 lg:flex-row lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          {slotsOf('main')}
        </div>
        {groups.aside.length > 0 && (
          <div className="flex flex-col gap-6 lg:shrink-0">
            {slotsOf('aside')}
          </div>
        )}
      </div>
      <div className="flex flex-col">{slotsOf('bottom')}</div>
    </div>
  );
}
