import { TrophyArt } from '#/components/client/art/trophy-art';
import { isoDate } from '#/lib/clock';
import { useDateTimeFormatter } from '#/lib/date-format';
import { cn } from '#/lib/utils';

import type { Award } from '../-model/page-model';

type Props = { awards: Award[] };

export function TrophyShelf({ awards }: Props) {
  const dateFormatter = useDateTimeFormatter('longDate');
  if (awards.length === 0) return null;
  // Yearの受賞を先頭に置き、Weekは新しい順に並べる
  const ordered = [...awards].sort((a, b) =>
    a.kind === b.kind
      ? b.decidedAt.getTime() - a.decidedAt.getTime()
      : a.kind === 'year'
        ? -1
        : 1,
  );

  return (
    <section
      id="trophies"
      aria-labelledby="trophies-heading"
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-gold/50 bg-card shadow-sm"
    >
      <h2
        id="trophies-heading"
        className="border-b border-gold/30 bg-gold/10 px-5 py-2.5 text-sm font-extrabold tracking-wide"
      >
        トロフィー
      </h2>
      <ul className="flex snap-x gap-3 overflow-x-auto px-5 pt-5 pb-0">
        {ordered.map((award) => (
          <li
            key={award.id}
            className={cn(
              'flex shrink-0 snap-start flex-col items-center text-center',
              award.kind === 'year' ? 'w-48' : 'w-44',
            )}
          >
            <TrophyArt
              kind={award.kind}
              size={award.kind === 'year' ? 96 : 72}
            />
            <p
              className={cn(
                'mt-2 leading-tight font-extrabold',
                award.kind === 'year' ? 'text-base' : 'text-sm',
              )}
              translate="no"
            >
              {award.kind === 'year'
                ? 'Product of the Year'
                : 'Product of the Week'}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-gold-foreground dark:text-gold">
              {award.period}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <time dateTime={isoDate(award.decidedAt)}>
                {dateFormatter.format(award.decidedAt)}
              </time>
              受賞
            </p>
          </li>
        ))}
      </ul>
      {/* 棚板 */}
      <div
        aria-hidden="true"
        className="mx-5 mt-1 mb-5 h-2 rounded-full bg-linear-to-b from-[oklch(0.62_0.08_60)] to-[oklch(0.45_0.07_55)] shadow-md"
      />
    </section>
  );
}
