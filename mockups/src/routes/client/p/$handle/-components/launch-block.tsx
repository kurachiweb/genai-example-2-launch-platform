import { Link } from '@tanstack/react-router';
import { CalendarClockIcon, LinkIcon, RadioIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';
import { useDateTimeFormatter } from '#/lib/date-format';
import type { Product } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { isoDate } from '../-model/clock';
import type { CommentNode } from '../-model/comments';
import type { LaunchHighlight, LaunchView } from '../-model/launches';
import { CommentThread } from './comment-thread';
import { MatchRow } from './match-row';
import { usePageContext } from './page-context';

type Props = {
  launch: LaunchView;
  product: Product;
  comments: CommentNode[] | undefined;
  // 開始済みで最も新しいローンチのコメントだけを既定で展開する
  commentsOpen: boolean;
};

const HIGHLIGHT_CLASSES: Record<LaunchHighlight['tone'], string> = {
  gold: 'gold-gradient text-gold-foreground',
  primary: 'bg-primary/12 text-primary',
  live: 'bg-primary text-primary-foreground',
  muted: 'bg-muted text-defeat',
};

export function LaunchBlock({
  launch,
  product,
  comments,
  commentsOpen,
}: Props) {
  const dateFormatter = useDateTimeFormatter('longDate');
  const titleId = `${launch.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className="rounded-2xl border border-border bg-card/70 p-4 shadow-xs sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={titleId} className="text-lg font-extrabold tracking-tight">
          第{launch.number}回ローンチ
        </h3>
        <time
          dateTime={isoDate(launch.date)}
          className="text-sm text-muted-foreground"
        >
          {dateFormatter.format(launch.date)}
        </time>
        {launch.highlights.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {launch.highlights.map((highlight) => (
              <li
                key={highlight.label}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-bold',
                  HIGHLIGHT_CLASSES[highlight.tone],
                )}
                translate={highlight.tone === 'gold' ? 'no' : undefined}
              >
                {highlight.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      {launch.matches.length > 0 ? (
        <ol
          aria-label={`第${launch.number}回ローンチのマッチ`}
          className="mt-4 space-y-2.5"
        >
          {launch.matches.map((match) => (
            <MatchRow key={match.id} match={match} product={product} />
          ))}
        </ol>
      ) : (
        <EmptyMatches launch={launch} />
      )}

      {comments ? (
        <CommentThread
          launchNumber={launch.number}
          initial={comments}
          defaultOpen={commentsOpen}
        />
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          キックオフ後にコメントできるようになります。
        </p>
      )}
    </article>
  );
}

function EmptyMatches({ launch }: { launch: LaunchView }) {
  const { role } = usePageContext();
  const dateFormatter = useDateTimeFormatter('dateWeekday');
  const isOwner = role === 'owner';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('リンクをコピーしました。');
    } catch {
      toast.error('リンクをコピーできませんでした。');
    }
  };

  if (launch.state === 'live') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-4 text-sm">
        <RadioIcon
          className="size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1">
          予選マッチが行われています。勝敗はフルタイム後にここへ表示されます。
        </p>
        <Button size="sm" variant="outline" asChild>
          <a href="#live-match-heading">マッチを見る</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center">
      <CalendarClockIcon
        className="mx-auto size-8 text-muted-foreground/60"
        aria-hidden="true"
      />
      <p className="mt-2 font-semibold">
        <time dateTime={isoDate(launch.date)}>
          {dateFormatter.format(launch.date)}
        </time>
        にキックオフします。
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isOwner
          ? '当日はトップページで対戦が始まります。リンクを共有して応援を呼びかけましょう。'
          : 'まだ終了したマッチはありません。当日はトップページで対戦が始まります。'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {isOwner ? (
          <Button size="sm" onClick={copyLink}>
            <LinkIcon aria-hidden="true" />
            リンクをコピーして応援を呼びかける
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link to="/client/top">トップページで本日のマッチを見る</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
