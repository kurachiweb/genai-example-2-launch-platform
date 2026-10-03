import { TrophyIcon } from 'lucide-react';
import type { BaseWin } from '../-model/listing';
import { useDirectoryFormat } from './use-directory-format';

type Props = { win: BaseWin };

// 勝利した予選マッチ(基準勝利マッチ1件)
export function WinSummary({ win }: Props) {
  const format = useDirectoryFormat();

  return (
    <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
      <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="inline-flex items-center gap-1 font-bold">
          <TrophyIcon
            className="size-3.5 text-gold-strong dark:text-gold"
            aria-hidden="true"
          />
          予選勝利
        </span>
        <time dateTime={win.date} className="text-muted-foreground">
          {format.launchDate(win.date)}
        </time>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {win.result === 'win' && win.ownVotes !== null && (
          <p className="scoreboard-digits text-2xl leading-none">
            <span className="sr-only">Upvote数</span>
            {format.number(win.ownVotes)}
            <span className="ml-0.5 text-sm font-bold text-muted-foreground">
              票
            </span>
          </p>
        )}
        {win.result !== 'win' && (
          <span className="gold-gradient inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold text-gold-foreground">
            <TrophyIcon className="size-3" aria-hidden="true" />
            不戦勝
          </span>
        )}
        {win.result === 'bye' && (
          <span className="text-xs text-muted-foreground">
            対戦相手がいないため
          </span>
        )}
        {win.result === 'early' && win.ownVotes !== null && (
          <span className="text-xs text-muted-foreground">
            確定時点で
            <span className="scoreboard-digits mx-0.5 text-sm text-foreground">
              {format.number(win.ownVotes)}
            </span>
            票
          </span>
        )}
      </div>
    </div>
  );
}
