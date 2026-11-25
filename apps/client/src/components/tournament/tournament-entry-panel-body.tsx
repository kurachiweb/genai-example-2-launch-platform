import { BadgeCheckIcon, ChevronRightIcon, TrophyIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import { EntryDeadline } from './entry-deadline.tsx';
import {
  BRACKET_LINK_LABEL,
  ENTRY_EXEMPT_TITLE,
  type TournamentEntryCopy,
} from './tournament-copy.ts';
import {
  type TournamentEntryCheckoutStart,
  TournamentEntryCheckout,
} from './tournament-entry-checkout.tsx';
import {
  hasEntryCountdown,
  type TournamentEntryDisplay,
  type TournamentEntryDrawnOutcome,
  type TournamentEntryInput,
  tournamentEntryBoundariesOf,
  tournamentEntryDisplayOf,
} from './tournament-entry-model.ts';

export interface TournamentEntryPanelBodyProps<TData> {
  // 投稿者本人のプロダクトの直近のローンチの参加の枠。無ければ何も描かない
  readonly entry: TournamentEntryInput | null;
  readonly copy: TournamentEntryCopy;
  // 受付期限まで48時間未満の注意色と秒読みを添えるか
  readonly countdown: boolean;
  // ページの「自動更新」の状態。偽の間は受付期限の秒読みの毎秒の更新を止める。境界の時刻の取り直しは止めない
  readonly autoRefresh: boolean;
  readonly checkout: TournamentEntryCheckoutStart<TData>;
  // 表示を切り替える境界の時刻に達した。包みが枠を取り直す
  readonly onBoundaryReached: () => void;
  // 秒読みを持つ間は自動更新の状態によらずtrue、それ以外はfalseを申告する。ページは切り替えを描くかの判定に使う
  readonly onAutoUpdatingChange?: ((active: boolean) => void) | undefined;
  // 決済の導線の間だけ決済期限の前に添える種類の案内(対象年・決勝日など)。無ければ何も添えない
  readonly payableIntro?: ReactNode | undefined;
}

interface StateProps<TData> {
  readonly entry: TournamentEntryInput;
  readonly display: TournamentEntryDisplay;
  readonly copy: TournamentEntryCopy;
  readonly countdown: boolean;
  readonly autoRefresh: boolean;
  readonly checkout: TournamentEntryCheckoutStart<TData>;
  readonly payableIntro: ReactNode | undefined;
}

const STATUS_TEXT_CLASS = 'text-sm font-bold';

const drawnMessageOf = (
  outcome: TournamentEntryDrawnOutcome,
  copy: TournamentEntryCopy,
): string => {
  switch (outcome.type) {
    case 'alive':
      return copy.drawnMessage;
    case 'champion':
      return copy.championMessage;
    case 'eliminated':
      return copy.eliminatedMessage(outcome.roundName);
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

function ExemptStatus({ message }: { readonly message: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-extrabold text-primary">
        <BadgeCheckIcon aria-hidden="true" className="size-4" />
        {ENTRY_EXEMPT_TITLE}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function EntryState<TData>({
  entry,
  display,
  copy,
  countdown,
  autoRefresh,
  checkout,
  payableIntro,
}: StateProps<TData>) {
  switch (display.kind) {
    case 'payable':
      return (
        <>
          {payableIntro !== undefined && (
            <p className="text-sm">{payableIntro}</p>
          )}
          <EntryDeadline
            acceptUntil={entry.acceptUntil}
            serverTime={entry.serverTime}
            autoRefresh={autoRefresh}
            countdown={countdown}
          />
          <TournamentEntryCheckout
            launchId={entry.launchId}
            feeAmount={display.feeAmount}
            ultrasGuide={display.ultrasGuide}
            blockedReason={display.blockedReason}
            copy={copy}
            checkout={checkout}
          />
        </>
      );
    case 'exempt':
      return <ExemptStatus message={copy.exemptMessage} />;
    case 'closed':
      return <StatusText>{copy.closedMessage}</StatusText>;
    case 'entitled':
      return (
        <StatusText>
          {copy.entitledMessage.lead}
          {copy.entitledMessage.before}
          <DateTime value={display.drawAt} format="dateTime" />
          {copy.entitledMessage.after}
        </StatusText>
      );
    case 'drawn':
      return (
        <>
          <StatusText>{drawnMessageOf(display.outcome, copy)}</StatusText>
          {display.bracketPath !== null && (
            <BracketLink href={display.bracketPath} />
          )}
        </>
      );
    case 'expired':
      return <StatusText>{copy.expiredMessage(display.late)}</StatusText>;
    case 'forfeited':
      return (
        <StatusText>
          {copy.forfeitedMessage}
          {display.refund && copy.forfeitedRefundSuffix}
        </StatusText>
      );
    case 'excluded':
      return (
        <StatusText>
          {copy.excludedMessage(display.reason)}
          {display.refund && copy.excludedRefundSuffix}
        </StatusText>
      );
  }
}

// 参加の枠を状態ごとに示す。決済の導線の間は受付期限(秒読みを添えるときはその48時間前も)の境界で取り直しを求め、注意色・秒読みと受付の終了へ切り替える
export function TournamentEntryPanelBody<TData>({
  entry,
  copy,
  countdown,
  autoRefresh,
  checkout,
  onBoundaryReached,
  onAutoUpdatingChange,
  payableIntro,
}: TournamentEntryPanelBodyProps<TData>) {
  const titleId = useId();
  useBoundaryRefresh(
    entry === null ? [] : tournamentEntryBoundariesOf(entry, countdown),
    onBoundaryReached,
  );
  const urgent = countdown && hasEntryCountdown(entry);
  useEffect(() => {
    onAutoUpdatingChange?.(urgent);
  }, [urgent, onAutoUpdatingChange]);
  if (entry === null) {
    return null;
  }
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
        {copy.title}
      </p>
      <EntryState
        entry={entry}
        display={tournamentEntryDisplayOf(entry)}
        copy={copy}
        countdown={countdown}
        autoRefresh={autoRefresh}
        checkout={checkout}
        payableIntro={payableIntro}
      />
    </div>
  );
}
