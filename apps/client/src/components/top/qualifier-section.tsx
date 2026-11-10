import { RocketIcon } from 'lucide-react';
import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type {
  ClientQualifierBoardQuery,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { ByeList } from '../match/bye-list.tsx';
import { MatchCard } from '../match/match-card.tsx';
import { useUpvote } from '../match/use-upvote.ts';
import { EmptyLineup } from './empty-lineup.tsx';
import {
  FULL_TIME_LABEL,
  heldCountLabel,
  NEXT_KICKOFF_LABEL,
  QUALIFIER_SECTION_TITLE,
} from './qualifier-section-messages.ts';
import { SectionHeading } from './section-heading.tsx';
import { layoutQualifierList } from './top-page-section-order.ts';
import type { QualifierListInsert } from './top-page-section-types.ts';

export interface QualifierSectionProps {
  readonly board: ClientQualifierBoardQuery['qualifierBoard'];
  readonly signedIn: boolean;
  // Upvote・取り消しの成功でサーバーが返したマッチを、呼び出し元の取得の結果(キャッシュ)へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
  // 見出しの下の状態の領域に出す文。結果の反映を待つ取り直しが上限に達した時に呼び出し元が渡す
  readonly statusMessage?: string | null;
  // 差し込みの登録口(QUALIFIER_LIST_INSERTS)。登録口が区画の登録と同じ合成の箇所にあり、読み込みが循環しないよう呼び出し元が渡す
  readonly inserts: readonly QualifierListInsert[];
}

interface QualifierMatchCardProps {
  readonly match: MatchFragment;
  readonly onUpdated: (match: MatchFragment) => void;
  readonly className?: string;
}

function QualifierMatchCard({
  match,
  onUpdated,
  className,
}: QualifierMatchCardProps) {
  const { pendingEntryId, toggle, loginDialog } = useUpvote({
    match,
    onUpdated,
  });
  return (
    <>
      <MatchCard
        match={match}
        pendingEntryId={pendingEntryId}
        onToggleUpvote={toggle}
        className={className}
      />
      {loginDialog}
    </>
  );
}

function HeadingMeta({
  board,
}: {
  readonly board: QualifierSectionProps['board'];
}) {
  const preferences = useDisplayPreferences();
  const isLive = board.phase === 'LIVE';
  return (
    <>
      <span>{heldCountLabel(formatNumber(board.heldCount, preferences))}</span>
      <span>
        {isLive ? FULL_TIME_LABEL : NEXT_KICKOFF_LABEL}
        <DateTime
          value={isLive ? board.fullTimeAt : board.nextKickoffAt}
          format="time"
        />
      </span>
    </>
  );
}

interface LineupProps {
  readonly matches: readonly MatchFragment[];
  readonly inserts: readonly QualifierListInsert[];
  readonly onUpdated: (match: MatchFragment) => void;
}

// 差し込みが描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、差し込みの要素そのものをグリッドのセルにする。
// 表示する画面幅の判定は差し込みが持つため、広い画面で表示をやめた差し込みが空のセルを残して2列の並びをずらさないようにする。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const INSERT_SLOT_CLASS = 'has-[>[data-qualifier-insert-rendered]]:contents';

// 画面幅1280px以上は2列にして先頭のカードだけを全幅にし、差し込みは指定の件数ごとに区画ごとのエラーの境界で包んで置く
function Lineup({ matches, inserts, onUpdated }: LineupProps) {
  const leadId = matches[0]?.id;
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {layoutQualifierList(matches, inserts).map((item) => {
        if (item.kind === 'card') {
          return (
            <QualifierMatchCard
              key={item.card.id}
              match={item.card}
              onUpdated={onUpdated}
              className={item.card.id === leadId ? 'xl:col-span-2' : undefined}
            />
          );
        }
        const { id, component: Insert } = item.insert;
        return (
          <RecoverableSlot
            key={`${id}:${String(item.position)}`}
            className={INSERT_SLOT_CLASS}
            contactAvailable={CLIENT_PROFILE.contactAvailable}
            contactHref={CONTACT_HREF}
          >
            <Insert position={item.position} />
            <span hidden data-qualifier-insert-rendered="" />
          </RecoverableSlot>
        );
      })}
    </div>
  );
}

export function QualifierSection({
  board,
  signedIn,
  onUpdated,
  statusMessage = null,
  inserts,
}: QualifierSectionProps) {
  const headingId = useId();
  const isEmpty = board.matches.length === 0 && board.byes.length === 0;
  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        icon={<RocketIcon className="size-5 text-primary" aria-hidden="true" />}
        title={QUALIFIER_SECTION_TITLE}
        meta={<HeadingMeta board={board} />}
      />
      {/* 文が加わった時に読み上げられるよう、文が無い間も領域を置いておく */}
      <p role="status" className="mt-2 text-sm font-medium empty:mt-0">
        {statusMessage}
      </p>
      {isEmpty ? (
        <EmptyLineup signedIn={signedIn} />
      ) : (
        <>
          {board.matches.length > 0 && (
            <Lineup
              matches={board.matches}
              inserts={inserts}
              onUpdated={onUpdated}
            />
          )}
          <ByeList byes={board.byes} />
        </>
      )}
    </section>
  );
}
