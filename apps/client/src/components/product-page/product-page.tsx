import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  PRODUCT_LIVE_MATCH_QUERY_PREFIX,
  PRODUCT_OWNER_STATUS_QUERY_PREFIX,
  PRODUCT_PAGE_QUERY_PREFIX,
  productLiveMatchQueryOptions,
  type ProductPageView,
} from '../../graphql/product-page.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { AutoRefreshSwitch } from '../match/auto-refresh-switch.tsx';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  hasLiveMatchAutoUpdates,
  heldLiveMatchOf,
  liveMatchBoundariesOf,
} from './live-match-refresh.ts';
import { LiveMatchSection } from './live-match-section.tsx';
import { ProductBreadcrumbs } from './product-breadcrumbs.tsx';
import { ProductHeader } from './product-header.tsx';
import { PRODUCT_PAGE_ASIDE_LABEL } from './product-page-messages.ts';
import { groupProductPageSections } from './product-page-section-order.ts';
import type {
  ProductPageContext,
  ProductPageSection,
} from './product-page-section-types.ts';
import { UnlistedBanner } from './unlisted-banner.tsx';

export interface ProductPageProps {
  // 区画の登録口(PRODUCT_PAGE_SECTIONS)。置き場所ごとにorderの順で並べる
  readonly sections: readonly ProductPageSection[];
  readonly page: ProductPageView;
  readonly viewer: ClientViewer | null;
}

type ReportAutoUpdating = (sectionId: string, active: boolean) => void;

type PageSectionContext = Omit<ProductPageContext, 'reportAutoUpdating'>;

interface SectionSlotProps {
  readonly id: string;
  readonly component: ComponentType<ProductPageContext>;
  readonly context: PageSectionContext;
  readonly onReport: ReportAutoUpdating;
  // 区画の中にUpvoteのbot判定のウィジェットを置き、区画のUpvoteへトークンを渡す
  readonly protectUpvote?: boolean;
}

// 開催中のマッチの区画は登録口とは別にページが置き、申告はこの名前で区画と同じく数える
const LIVE_MATCH_SLOT_ID = 'directory-discovery.live-match';

// 区画が描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、区画の要素そのものを列の項目にする。
// 該当せずnullを描いた区画が列の間隔を残さないようにする。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const SECTION_SLOT_CLASS =
  'has-[>[data-product-page-section-rendered]]:contents';

// 区画のエラーの境界の内側に置き、境界が例外を捕まえて区画を外した時とページから区画が外れた時に、その区画の申告を消す
function AutoUpdatingReportScope({ onEnd }: { readonly onEnd: () => void }) {
  useEffect(() => onEnd, [onEnd]);
  return null;
}

// 判定の失敗の文言を対戦カードの下に置き、列の間隔を空けずに区画に続けるため、区画とウィジェットを1つの箱にまとめる
function ProtectedUpvotes({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <UpvoteBotProtection>{children}</UpvoteBotProtection>
    </div>
  );
}

function SectionSlot({
  id,
  component: Section,
  context,
  onReport,
  protectUpvote = false,
}: SectionSlotProps) {
  const reportAutoUpdating = useCallback(
    (active: boolean) => {
      onReport(id, active);
    },
    [onReport, id],
  );
  const endReport = useCallback(() => {
    onReport(id, false);
  }, [onReport, id]);
  const section = (
    <Section {...context} reportAutoUpdating={reportAutoUpdating} />
  );
  return (
    <RecoverableSlot
      className={SECTION_SLOT_CLASS}
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
    >
      <AutoUpdatingReportScope onEnd={endReport} />
      {protectUpvote ? <ProtectedUpvotes>{section}</ProtectedUpvotes> : section}
      <span hidden data-product-page-section-rendered="" />
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

// ページ上部の区画(全幅)→自動更新の切り替え→パンくずリスト→未掲載の案内→ヘッダー・サイドバー・開催中のマッチ・本文の区画・ページ末尾の区画の順に置き、区画ごとにエラーの境界で包む。
// 1024px以上はサイドバーをヘッダーの横から本文の横に置き、未満はヘッダーの直後に置く。自動更新の状態はページを開くたびにオンから始め、全ての区画へ渡してページの根の属性で演出を止める。
// 境界の時刻の取り直しは、区画の描画の失敗で止まらないよう、区画のエラーの境界の外のここで行う
export function ProductPage({ sections, page, viewer }: ProductPageProps) {
  const queryClient = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [reports, setReports] = useState<ReadonlySet<string>>(() => new Set());
  const onReport = useCallback<ReportAutoUpdating>((sectionId, active) => {
    setReports((current) => withReport(current, sectionId, active));
  }, []);

  // 定期の取り直しと失敗の表示は開催中のマッチの区画に任せ、ページはloaderの取得を読むだけにする
  const { data: liveMatchData } = useQuery({
    ...productLiveMatchQueryOptions(viewer, page.handle),
    refetchOnMount: false,
    retryOnMount: false,
  });
  const liveMatch = liveMatchData?.productLiveMatch;
  const hasLiveMatch = heldLiveMatchOf(liveMatch) !== null;

  // 予約の可否は境界の時刻(ペアリング・キックオフ)と開催中のマッチの終了で変わり得るため、投稿者本人向けの照会も取り直す
  const refresh = useCallback(() => {
    for (const queryKey of [
      PRODUCT_LIVE_MATCH_QUERY_PREFIX,
      PRODUCT_PAGE_QUERY_PREFIX,
      PRODUCT_OWNER_STATUS_QUERY_PREFIX,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);
  useBoundaryRefresh(liveMatchBoundariesOf(liveMatch, page.launches), refresh);

  // 開催中のマッチの有無が変わると区画がbot判定の内外へ移って作り直され、区画は替わる前のマッチを知らないため、ページが詳細ページを取り直してマッチ履歴とキックオフの案内を替える
  const previousHasLiveMatchRef = useRef(hasLiveMatch);
  useEffect(() => {
    const previous = previousHasLiveMatchRef.current;
    previousHasLiveMatchRef.current = hasLiveMatch;
    if (previous !== hasLiveMatch) {
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_PAGE_QUERY_PREFIX,
      });
    }
  }, [hasLiveMatch, queryClient]);

  const context = useMemo<PageSectionContext>(
    () => ({
      product: {
        id: page.id,
        handle: page.handle,
        name: page.name,
        listed: page.listed,
        ownerHandle: page.owner.handle,
      },
      viewer: { signedIn: viewer !== null, isOwner: page.viewerIsOwner },
      page,
      autoRefresh,
    }),
    [page, viewer, autoRefresh],
  );
  const groups = useMemo(() => groupProductPageSections(sections), [sections]);
  const switchVisible = hasLiveMatchAutoUpdates(liveMatch) || reports.size > 0;

  const slotsOf = (placement: keyof typeof groups) =>
    groups[placement].map(({ id, component }) => (
      <SectionSlot
        key={id}
        id={id}
        component={component}
        context={context}
        onReport={onReport}
      />
    ));

  return (
    <div
      data-auto-refresh={autoRefresh ? 'on' : 'off'}
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-5 pb-10"
    >
      {slotsOf('banner')}
      {switchVisible && (
        <div className="sm:max-w-sm">
          <AutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
          />
        </div>
      )}
      <ProductBreadcrumbs category={page.category} name={page.name} />
      <UnlistedBanner listed={page.listed} viewerIsOwner={page.viewerIsOwner} />
      <div
        data-product-page-columns=""
        className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ProductHeader page={page} />
        </div>
        <aside
          aria-label={PRODUCT_PAGE_ASIDE_LABEL}
          data-product-page-aside=""
          className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <div className="flex flex-col gap-4 lg:sticky lg:top-20">
            {slotsOf('aside')}
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-12 lg:col-start-1 lg:row-start-2">
          <SectionSlot
            id={LIVE_MATCH_SLOT_ID}
            component={LiveMatchSection}
            context={context}
            onReport={onReport}
            protectUpvote={hasLiveMatch}
          />
          {slotsOf('main')}
          {slotsOf('bottom')}
        </div>
      </div>
    </div>
  );
}
