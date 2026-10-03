import { Link } from '@tanstack/react-router';
import { InfoIcon, ThumbsUpIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { isoDate } from '#/lib/clock';
import { useDateTimeFormatter } from '#/lib/date-format';

import type { ProfileModel } from '../-model/page-model';
import { groupByDay } from '../-model/upvotes';
import { LoadMore } from './load-more';
import { TabEmpty } from './tab-empty';
import { UpvoteItem } from './upvote-item';
import { UpvoteSkeletons } from './upvote-skeletons';
import { usePagedList } from './use-paged-list';

type Props = {
  model: ProfileModel;
  loadMoreFails: boolean;
};

const LOAD_MORE_SKELETONS = 3;

export function UpvoteHistoryPanel({ model, loadMoreFails }: Props) {
  const { upvotes, role, suspended } = model;
  const dateFormatter = useDateTimeFormatter('longDate');
  const list = usePagedList(upvotes.length, loadMoreFails);

  if (upvotes.length === 0) {
    const canUpvote = role === 'owner' && !suspended;
    return (
      <TabEmpty
        icon={ThumbsUpIcon}
        title="まだUpvoteしたマッチはありません。"
        description={
          canUpvote
            ? '開催中のマッチで、応援したいプロダクトにUpvoteしましょう。'
            : undefined
        }
        action={
          canUpvote && (
            <Button size="lg" asChild>
              <Link to="/client/top">トップページで開催中のマッチを見る</Link>
            </Button>
          )
        }
      />
    );
  }

  const days = groupByDay(upvotes.slice(0, list.visible));

  return (
    <div>
      <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
        公開を停止・削除されたプロダクトは表示されません。
      </p>
      <div className="space-y-6">
        {days.map((day) => {
          const headingId = `upvotes-${isoDate(day.date)}`;
          return (
            <section key={headingId} aria-labelledby={headingId}>
              <h3
                id={headingId}
                className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5 text-sm font-bold"
              >
                <time dateTime={isoDate(day.date)}>
                  {dateFormatter.format(day.date)}
                </time>
                <span className="text-xs font-normal text-muted-foreground">
                  {day.entries.length}件
                </span>
              </h3>
              <ul className="space-y-2">
                {day.entries.map((entry) => (
                  <UpvoteItem
                    key={entry.id}
                    entry={entry}
                    imagesBroken={model.othersImagesBroken}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <LoadMore
        list={list}
        skeleton={<UpvoteSkeletons count={LOAD_MORE_SKELETONS} />}
      />
    </div>
  );
}
