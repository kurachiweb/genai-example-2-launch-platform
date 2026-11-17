import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BadgeCheckIcon, ChevronRightIcon, TrophyIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { myWeekEntryQueryOptions } from '../../graphql/week-tournament.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import { EntryDeadline } from './entry-deadline.tsx';
import { WeekEntryCheckout } from './week-entry-checkout.tsx';
import {
  WEEK_ENTRY_CHAMPION_MESSAGE,
  WEEK_ENTRY_CLOSED_MESSAGE,
  WEEK_ENTRY_DRAWN_MESSAGE,
  WEEK_ENTRY_ENTITLED_MESSAGE,
  WEEK_ENTRY_EXCLUDED_MESSAGE,
  WEEK_ENTRY_EXCLUDED_REFUND_MESSAGE,
  WEEK_ENTRY_EXEMPT_MESSAGE,
  WEEK_ENTRY_EXEMPT_TITLE,
  WEEK_ENTRY_EXPIRED_MESSAGE,
  WEEK_ENTRY_FORFEITED_MESSAGE,
  WEEK_ENTRY_FORFEITED_REFUND_MESSAGE,
  WEEK_ENTRY_LATE_ENTRY_MESSAGE,
  weekEntryEliminatedMessage,
} from './week-entry-messages.ts';
import {
  hasEntryCountdown,
  type WeekEntryDisplay,
  type WeekEntryDrawnOutcome,
  type WeekEntryPanelView,
  weekEntryBoundariesOf,
  weekEntryDisplayOf,
} from './week-entry-model.ts';
import {
  BRACKET_LINK_LABEL,
  WEEK_TOURNAMENT_SECTION_TITLE,
} from './week-tournament-messages.ts';

export interface WeekEntryPanelProps {
  // 現在のハンドル
  readonly productHandle: string;
  // ページの「自動更新」の状態。偽の間は受付期限の秒読みの毎秒の更新を止める。境界の時刻の取り直しは止めない
  readonly autoRefresh: boolean;
  // 秒読みを持つ間(受付中で受付期限まで48時間未満)は自動更新の状態によらずtrue、それ以外はfalseを申告する。ページは切り替えを描くかの判定に使う
  readonly onAutoUpdatingChange?: (active: boolean) => void;
}

interface PanelContentProps extends WeekEntryPanelProps {
  readonly viewer: ClientViewer;
}

const STATUS_TEXT_CLASS = 'text-sm font-bold';

const drawnMessageOf = (outcome: WeekEntryDrawnOutcome): string => {
  switch (outcome.type) {
    case 'alive':
      return WEEK_ENTRY_DRAWN_MESSAGE;
    case 'champion':
      return WEEK_ENTRY_CHAMPION_MESSAGE;
    case 'eliminated':
      return weekEntryEliminatedMessage(outcome.roundName);
  }
};

function StatusText({ children }: { readonly children: ReactNode }) {
  return <p className={STATUS_TEXT_CLASS}>{children}</p>;
}

function BracketLink({ href }: { readonly href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary underline underline-offset-4"
    >
      {BRACKET_LINK_LABEL}
      <ChevronRightIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
}

function ExemptStatus() {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-extrabold text-primary">
        <BadgeCheckIcon aria-hidden="true" className="size-4" />
        {WEEK_ENTRY_EXEMPT_TITLE}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {WEEK_ENTRY_EXEMPT_MESSAGE}
      </p>
    </div>
  );
}

function PanelBody({
  entry,
  display,
  autoRefresh,
}: {
  readonly entry: WeekEntryPanelView;
  readonly display: WeekEntryDisplay;
  readonly autoRefresh: boolean;
}) {
  switch (display.kind) {
    case 'payable':
      return (
        <>
          <EntryDeadline
            acceptUntil={entry.acceptUntil}
            serverTime={entry.serverTime}
            autoRefresh={autoRefresh}
          />
          <WeekEntryCheckout
            launchId={entry.launchId}
            feeAmount={display.feeAmount}
            ultrasGuide={display.ultrasGuide}
            blockedReason={display.blockedReason}
          />
        </>
      );
    case 'exempt':
      return <ExemptStatus />;
    case 'closed':
      return <StatusText>{WEEK_ENTRY_CLOSED_MESSAGE}</StatusText>;
    case 'entitled':
      return (
        <StatusText>
          {WEEK_ENTRY_ENTITLED_MESSAGE.lead}
          {WEEK_ENTRY_ENTITLED_MESSAGE.before}
          <DateTime value={display.drawAt} format="dateTime" />
          {WEEK_ENTRY_ENTITLED_MESSAGE.after}
        </StatusText>
      );
    case 'drawn':
      return (
        <>
          <StatusText>{drawnMessageOf(display.outcome)}</StatusText>
          {display.bracketPath !== null && (
            <BracketLink href={display.bracketPath} />
          )}
        </>
      );
    case 'expired':
      return (
        <StatusText>
          {display.late
            ? WEEK_ENTRY_LATE_ENTRY_MESSAGE
            : WEEK_ENTRY_EXPIRED_MESSAGE}
        </StatusText>
      );
    case 'forfeited':
      return (
        <StatusText>
          {WEEK_ENTRY_FORFEITED_MESSAGE}
          {display.refund && WEEK_ENTRY_FORFEITED_REFUND_MESSAGE}
        </StatusText>
      );
    case 'excluded':
      return (
        <StatusText>
          {WEEK_ENTRY_EXCLUDED_MESSAGE}
          {display.refund && WEEK_ENTRY_EXCLUDED_REFUND_MESSAGE}
        </StatusText>
      );
  }
}

function WeekEntryPanelContent({
  viewer,
  productHandle,
  autoRefresh,
  onAutoUpdatingChange,
}: PanelContentProps) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const options = myWeekEntryQueryOptions(viewer, productHandle);
  const { data } = useSuspenseQuery(options);
  const entry = data.myWeekEntry;
  useBoundaryRefresh(entry === null ? [] : weekEntryBoundariesOf(entry), () => {
    void queryClient.invalidateQueries({ queryKey: options.queryKey });
  });
  const urgent = hasEntryCountdown(entry);
  useEffect(() => {
    onAutoUpdatingChange?.(urgent);
  }, [urgent, onAutoUpdatingChange]);
  if (entry === null) {
    return null;
  }
  const display = weekEntryDisplayOf(entry);
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground',
        urgent ? 'border-warning ring-2 ring-warning/40' : 'border-border',
      )}
    >
      <p
        id={titleId}
        className="flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground"
      >
        <TrophyIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {WEEK_TOURNAMENT_SECTION_TITLE}
      </p>
      <PanelBody entry={entry} display={display} autoRefresh={autoRefresh} />
    </div>
  );
}

// 投稿者本人のプロダクトの直近のローンチのWeekトーナメントの参加の枠を、状態ごとに示す。枠が無い・本人でなければ何も描かない。
// 受付期限の48時間前と受付期限に取り直して注意色・秒読みと受付の終了へ切り替える。取得の失敗と読み込み中は置き場所の区画のエラーの境界に任せる
export function WeekEntryPanel({
  productHandle,
  autoRefresh,
  onAutoUpdatingChange,
}: WeekEntryPanelProps) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <WeekEntryPanelContent
      viewer={viewer}
      productHandle={productHandle}
      autoRefresh={autoRefresh}
      onAutoUpdatingChange={onAutoUpdatingChange}
    />
  );
}
