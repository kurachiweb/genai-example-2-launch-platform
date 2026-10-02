import { useId } from 'react';
import { StarIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';

import type { Rating } from '../-model/page-model';
import { UNVERIFIED_MESSAGE, usePageContext } from './page-context';
import { StarRatingInput } from './star-rating-input';

type Props = { rating: Rating };

// 平均値は表示用の概算。自分の評価の追加・変更・取り消しを件数と平均値に反映する
function adjusted(
  rating: Rating,
  initialMine: number | null,
  mine: number | null,
) {
  const baseCount = rating.count - (initialMine === null ? 0 : 1);
  const baseSum = (rating.average ?? 0) * rating.count - (initialMine ?? 0);
  const count = baseCount + (mine === null ? 0 : 1);
  const average = count === 0 ? null : (baseSum + (mine ?? 0)) / count;
  return { count, average };
}

export function RatingCard({ rating }: Props) {
  const { role, myRating, setMyRating, requireLogin } = usePageContext();
  const reasonId = useId();
  const { count, average } = adjusted(rating, rating.mine, myRating);

  const rate = (value: number) => {
    if (role === 'guest') {
      requireLogin('rating');
      return;
    }
    setMyRating(value);
    toast.success(
      myRating === null ? '評価しました。' : '評価を変更しました。',
    );
  };

  return (
    <section
      aria-labelledby="rating-heading"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <h2 id="rating-heading" className="text-sm font-extrabold">
        5段階評価
      </h2>
      {average === null ? (
        <div className="mt-3 flex items-center gap-3">
          <StarIcon
            className="size-8 text-muted-foreground/40"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            まだ評価がありません。
            {role === 'user' && '最初の評価をしてみませんか?'}
          </p>
        </div>
      ) : (
        <div className="mt-2 flex items-end gap-3">
          <p className="scoreboard-digits text-5xl leading-none">
            {average.toFixed(1)}
            <span className="sr-only">(5段階中)</span>
          </p>
          <div className="pb-1">
            <StarMeter value={average} />
            <p className="mt-1 text-xs text-muted-foreground">
              {count.toLocaleString()}件の評価
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-4">
        {role === 'owner' ? (
          <p className="text-sm text-muted-foreground">
            自身のプロダクトは評価できません。
          </p>
        ) : (
          <>
            <p className="text-xs font-bold text-muted-foreground">
              あなたの評価
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StarRatingInput
                label="あなたの評価"
                value={myRating}
                onChange={rate}
                disabled={role === 'unverified'}
                describedBy={role === 'unverified' ? reasonId : undefined}
              />
              {myRating !== null && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setMyRating(null);
                    toast.success('評価を取り消しました。');
                  }}
                >
                  取り消す
                </Button>
              )}
            </div>
            {role === 'unverified' && (
              <p id={reasonId} className="mt-2 text-xs text-muted-foreground">
                {UNVERIFIED_MESSAGE}
              </p>
            )}
            {role === 'guest' && (
              <p className="mt-2 text-xs text-muted-foreground">
                星を選ぶとログインして評価できます。
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// 平均値を星5つの塗りの割合で示す(読み上げは平均値の数字で行う)
function StarMeter({ value }: { value: number }) {
  const stars = [0, 1, 2, 3, 4];
  return (
    <span className="relative inline-flex" aria-hidden="true">
      <span className="flex">
        {stars.map((i) => (
          <StarIcon key={i} className="size-5 text-muted-foreground/40" />
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden"
        style={{ width: `${(value / 5) * 100}%` }}
      >
        {stars.map((i) => (
          <StarIcon
            key={i}
            className="size-5 shrink-0 fill-primary text-primary"
          />
        ))}
      </span>
    </span>
  );
}
