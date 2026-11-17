import { BracketChampion } from '../bracket/bracket-champion.tsx';
import { BRACKET_SCROLL_REGION_LABEL } from '../bracket/bracket-messages.ts';
import { BracketRoundColumn } from '../bracket/bracket-round-column.tsx';
import { BracketRoundTabs } from '../bracket/bracket-round-tabs.tsx';
import { AutoRefreshSwitch } from '../match/auto-refresh-switch.tsx';
import {
  bracketViewPropsOf,
  isWeekBracketLive,
  type WeekBracketView,
} from './week-bracket-model.ts';
import {
  WEEK_AWARD_NAME,
  WEEK_TOURNAMENT_SECTION_TITLE,
  weekBracketCountsLabel,
} from './week-tournament-messages.ts';

export interface WeekBracketPageProps {
  readonly bracket: WeekBracketView;
  // 開催中の定期の取り直しを続けるか。終了した週では使わない
  readonly autoRefresh: boolean;
  readonly onAutoRefreshChange: (checked: boolean) => void;
}

// 画面幅768px以上は列、それ未満はタブを見せる。サーバーの描画で画面幅を知らずに済むよう両方を描き、CSSで片方を隠す
export function WeekBracketPage({
  bracket,
  autoRefresh,
  onAutoRefreshChange,
}: WeekBracketPageProps) {
  const { rounds, champion, awarded, finished } = bracketViewPropsOf(bracket);
  const live = isWeekBracketLive({ weekBracket: bracket });
  const { tournament, participantCount, seedCount } = bracket;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="flex flex-col gap-1">
          <span className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {WEEK_TOURNAMENT_SECTION_TITLE}
          </span>{' '}
          <span className="text-base font-bold text-muted-foreground sm:text-lg">
            {tournament.label}
          </span>
        </h1>
        <p className="text-sm font-semibold text-muted-foreground">
          {weekBracketCountsLabel(participantCount, seedCount)}
        </p>
      </header>
      {live ? (
        <div className="sm:max-w-sm">
          <AutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={onAutoRefreshChange}
          />
        </div>
      ) : null}
      <BracketChampion
        awardName={WEEK_AWARD_NAME}
        champion={champion}
        awarded={awarded}
        finished={finished}
      />
      {rounds.length > 0 ? (
        <>
          {/* 読み上げ専用の文言の絶対配置が領域の外の位置を基準にしてページを横にスクロールさせないよう、領域を配置の基準にする */}
          <section
            aria-label={BRACKET_SCROLL_REGION_LABEL}
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- 列の中にリンクの無い表示(未来の枠など)だけが並ぶ場合も、キーボードで横にスクロールできるよう、横スクロールの領域自体をフォーカスできるようにする
            tabIndex={0}
            className="relative hidden overflow-x-auto rounded-xl pb-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:block"
          >
            <div className="grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-4">
              {rounds.map((round) => (
                <BracketRoundColumn key={round.round} round={round} />
              ))}
            </div>
          </section>
          <BracketRoundTabs rounds={rounds} className="md:hidden" />
        </>
      ) : null}
    </div>
  );
}
