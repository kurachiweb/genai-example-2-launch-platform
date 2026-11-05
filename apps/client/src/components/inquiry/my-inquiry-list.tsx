import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { InquiryStatusBadge } from '../../../lib/components/inquiry/inquiry-status-badge.tsx';
import { PageNavigation } from '../../../lib/components/navigation/page-navigation.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  type MyInquiryItem,
  myInquiriesQueryOptions,
  toMyInquiryPage,
} from '../../graphql/inquiry-contact.ts';
import { inquiryChatHref } from './inquiry-chat-href.ts';
import {
  LAST_MESSAGE_AT_LABEL,
  MY_INQUIRIES_EMPTY_MESSAGE,
  MY_INQUIRIES_PAGINATION_LABEL,
  MY_INQUIRIES_TITLE,
  SENT_AT_LABEL,
} from './inquiry-contact-messages.ts';

export interface MyInquiryListProps {
  readonly viewerId: string;
  // ページの位置のカーソル。undefinedは1ページ目
  readonly after: string | undefined;
  readonly onShowPage: (after: string | undefined) => void;
}

function MyInquiryRow({ item }: { readonly item: MyInquiryItem }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <InquiryStatusBadge status={item.status} />
        <PathLink
          href={inquiryChatHref(item.id)}
          className="font-bold break-all text-primary underline-offset-4 hover:underline"
        >
          {item.categoryName}
        </PathLink>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{SENT_AT_LABEL}</dt>
        <dd>
          <DateTime value={item.createdAt} format="longDateTime" />
        </dd>
        <dt className="text-muted-foreground">{LAST_MESSAGE_AT_LABEL}</dt>
        <dd>
          <DateTime value={item.lastMessageAt} format="longDateTime" />
        </dd>
      </dl>
    </li>
  );
}

interface MyInquiryListBodyProps {
  readonly items: readonly MyInquiryItem[] | undefined;
  readonly failure: {
    readonly message: string;
    readonly onRetry: () => void;
  } | null;
}

function MyInquiryListBody({ items, failure }: MyInquiryListBodyProps) {
  if (failure !== null) {
    return (
      <PartialErrorState message={failure.message} onRetry={failure.onRetry} />
    );
  }
  if (items === undefined) {
    return null;
  }
  if (items.length === 0) {
    return <EmptyState title={MY_INQUIRIES_EMPTY_MESSAGE} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <MyInquiryRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

// ログイン中の利用者が送った問い合わせを、検索パラメータのカーソルで区切って前後のページへ移りながら示す
export function MyInquiryList({
  viewerId,
  after,
  onShowPage,
}: MyInquiryListProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const myInquiries = useQuery({
    ...myInquiriesQueryOptions(viewerId, after),
    select: toMyInquiryPage,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  // 絞り込みが無く、閲覧者が変われば前の閲覧者の記録を使わないよう、閲覧者を条件にする
  const previous = previousPageOf(trail, viewerId, after);
  const nextCursor = myInquiries.data?.nextCursor ?? null;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の失敗はブラウザへ渡った後に取得し直した結果で文言を選び直すためでもある
  const error = myInquiries.isFetching ? null : myInquiries.error;
  const items = error === null ? myInquiries.data?.items : undefined;
  const loading = error === null && items === undefined;
  // 1ページだけと分かった一覧には、押せないページ送りを並べない
  const singlePage =
    items !== undefined && after === undefined && nextCursor === null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 flex flex-col gap-4 border-t border-border pt-8"
    >
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-xl font-extrabold"
      >
        {MY_INQUIRIES_TITLE}
      </h2>
      {/* aria-busyの中の変化は読み上げが遅れ得るため、読み込み中のLoadingSkeletonは一覧の領域のaria-busyの外に置く */}
      <div>
        {loading ? <LoadingSkeleton /> : null}
        <div aria-busy={loading ? true : undefined}>
          <MyInquiryListBody
            items={items}
            failure={
              error === null
                ? null
                : {
                    message: errorMessageOf(
                      error,
                      CLIENT_PROFILE.contactAvailable,
                    ),
                    onRetry: () => {
                      headingRef.current?.focus();
                      void myInquiries.refetch();
                    },
                  }
            }
          />
        </div>
      </div>
      {singlePage ? null : (
        <PageNavigation
          label={MY_INQUIRIES_PAGINATION_LABEL}
          hasPrevious={previous.exists}
          hasNext={nextCursor !== null}
          settled={items !== undefined}
          onPrevious={() => {
            onShowPage(previous.after);
          }}
          onNext={() => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, viewerId, after, nextCursor));
            onShowPage(nextCursor);
          }}
        />
      )}
    </section>
  );
}
