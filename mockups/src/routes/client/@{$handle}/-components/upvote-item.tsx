import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';

import { LaunchHighlightChip } from '#/components/client/launch-highlight-chip';
import { StageBadge } from '#/components/client/match/stage-badge';
import { ProductLogo } from '#/components/client/product-logo';
import { UserAvatar } from '#/components/client/user-avatar';

import type { UpvoteEntry } from '../-model/upvotes';

type Props = {
  entry: UpvoteEntry;
  imagesBroken: boolean;
};

// Upvoteしたプロダクトのロゴ・名称・投稿者とマッチの種別。掲載中のプロダクトだけ名称から詳細ページへ遷移する
export function UpvoteItem({ entry, imagesBroken }: Props) {
  const { product, maker } = entry;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs sm:flex-nowrap sm:px-4">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <ProductLogo
          product={product}
          size={40}
          broken={imagesBroken}
          className="size-10 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {entry.listed ? (
              <Link
                to="/client/p/$handle"
                params={{ handle: product.handle }}
                className="min-w-0 font-bold wrap-anywhere text-foreground no-underline hover:underline"
              >
                {product.name}
              </Link>
            ) : (
              <span className="min-w-0 font-bold wrap-anywhere">
                {product.name}
              </span>
            )}
            {!entry.listed && (
              <span className="rounded-full border border-border px-2 py-px text-[0.6875rem] font-bold text-muted-foreground">
                未掲載
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs">
            <span className="sr-only">投稿者: </span>
            <Link
              to="/client/@{$handle}"
              params={{ handle: maker.handle }}
              className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground hover:underline"
            >
              <UserAvatar user={maker} size={18} broken={imagesBroken} />
              <span className="min-w-0 wrap-anywhere">{maker.nickname}</span>
            </Link>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end sm:gap-1.5">
        <StageBadge kind={entry.kind} round={entry.round} size="default" />
        {entry.live && (
          <span className="flex items-center gap-2">
            <LaunchHighlightChip label="マッチ中" tone="live" />
            <Link
              to="/client/top"
              className="inline-flex items-center gap-0.5 text-xs font-bold whitespace-nowrap text-primary no-underline hover:underline"
            >
              トップページで見る
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </Link>
          </span>
        )}
      </div>
    </li>
  );
}
