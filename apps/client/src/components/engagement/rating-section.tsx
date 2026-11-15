import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import {
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Card } from '../../../lib/components/ui/card/card.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { OWN_PRODUCT_RATING_MESSAGE } from '../../../common-lib/engagement/engagement-rules.ts';
import { productRatingQueryOptions } from '../../graphql/engagement.ts';
import type { ProductRatingFragment } from '../../graphql/generated/graphql.ts';
import { LoginRequiredDialog } from '../auth/login-required-dialog.tsx';
import type { ProductPageContext } from '../product-page/product-page-section-types.ts';
import {
  OWN_RATING_LABEL,
  RATING_CANCEL_LABEL,
  RATING_EMAIL_UNVERIFIED_REASON,
  RATING_GUEST_NOTICE,
  RATING_LOAD_ERROR_MESSAGE,
  RATING_LOADING_LABEL,
  RATING_LOGIN_REQUIRED_DESCRIPTION,
  RATING_LOGIN_REQUIRED_TITLE,
  RATING_SECTION_TITLE,
} from './rating-messages.ts';
import { RatingSummary } from './rating-summary.tsx';
import { StarRatingInput } from './star-rating-input.tsx';
import { useEngagementViewer } from './use-engagement-viewer.ts';
import { useRatingMutations } from './use-rating-mutations.ts';

const NOTE_CLASS = 'text-xs text-muted-foreground';

const INPUT_ROW_CLASS = 'flex flex-wrap items-center gap-x-3 gap-y-1';

const RATING_SKELETON = (
  <div className="flex flex-col gap-4">
    <div className="flex items-end gap-3">
      <Skeleton className="h-12 w-16" />
      <div className="flex flex-col gap-2 pb-1">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-40" />
    </div>
  </div>
);

function GuestRatingInput() {
  const [open, setOpen] = useState(false);
  const returnTo = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });
  return (
    <>
      <StarRatingInput
        label={OWN_RATING_LABEL}
        value={null}
        onChange={() => {
          setOpen(true);
        }}
      />
      <p className={NOTE_CLASS}>{RATING_GUEST_NOTICE}</p>
      <LoginRequiredDialog
        open={open}
        onOpenChange={setOpen}
        title={RATING_LOGIN_REQUIRED_TITLE}
        description={RATING_LOGIN_REQUIRED_DESCRIPTION}
        returnTo={returnTo}
      />
    </>
  );
}

interface SignedInRatingInputProps {
  readonly rating: ProductRatingFragment;
  readonly viewerId: string;
  readonly unverified: boolean;
  // 取消で消えた「取り消す」の代わりに、星を選べない時に移るフォーカスの先
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}

// 送信中に入力を無効にするとフォーカスが<body>へ落ちるため、無効にせず送信中の操作を受ける側で扱う。未確認でも評価済みなら「取り消す」は使える
function SignedInRatingInput({
  rating,
  viewerId,
  unverified,
  headingRef,
}: SignedInRatingInputProps) {
  const reasonId = useId();
  const inputRef = useRef<HTMLDivElement>(null);
  const refocusRef = useRef(false);
  const { busy, cancelling, rate, cancel } = useRatingMutations({
    rating,
    viewerId,
    onCancelled: () => {
      refocusRef.current = true;
    },
  });
  const score = rating.viewerScore;

  // 取消の後に消えた「取り消す」からフォーカスを<body>へ落とさず、選び直す星へ移す。送信を待つ間に利用者が移したフォーカスは奪い返さない
  useLayoutEffect(() => {
    if (!refocusRef.current || score !== null) {
      return;
    }
    refocusRef.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    const tabStop = inputRef.current?.querySelector<HTMLButtonElement>(
      '[role="radio"][tabindex="0"]:enabled',
    );
    (tabStop ?? headingRef.current)?.focus();
  }, [score, headingRef]);

  return (
    <>
      <div ref={inputRef} className={INPUT_ROW_CLASS}>
        <StarRatingInput
          label={OWN_RATING_LABEL}
          value={score}
          onChange={rate}
          disabled={unverified}
          {...(unverified ? { describedBy: reasonId } : {})}
        />
        {score !== null && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-disabled={busy || undefined}
            aria-busy={cancelling || undefined}
            onClick={cancel}
          >
            {RATING_CANCEL_LABEL}
          </Button>
        )}
      </div>
      {unverified && (
        <p id={reasonId} className={NOTE_CLASS}>
          {RATING_EMAIL_UNVERIFIED_REASON}
        </p>
      )}
    </>
  );
}

// 区画の位置を占めるカードの中で取得の状態を描き、取得の失敗をこの欄の中に留める。定期の取り直しを持たないため自動更新を申告しない
export function RatingSection({ product, viewer }: ProductPageContext) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { kind, viewerId } = useEngagementViewer({ viewer });
  const query = useQuery(productRatingQueryOptions(viewerId, product.id));
  const rating = query.data?.productRating;
  if (rating === null) {
    return null;
  }
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const loadError =
    rating === undefined && !query.isFetching ? query.error : null;

  const renderBody = () => {
    if (loadError !== null) {
      return (
        <PartialErrorState
          message={RATING_LOAD_ERROR_MESSAGE}
          onRetry={() => {
            headingRef.current?.focus();
            void query.refetch();
          }}
        />
      );
    }
    if (rating === undefined) {
      return (
        <LoadingSkeleton label={RATING_LOADING_LABEL}>
          {RATING_SKELETON}
        </LoadingSkeleton>
      );
    }
    return (
      <>
        <RatingSummary
          average={rating.average ?? null}
          count={rating.count}
          invite={kind === 'member'}
        />
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {viewer.isOwner ? (
            <p className="text-sm text-muted-foreground">
              {OWN_PRODUCT_RATING_MESSAGE}
            </p>
          ) : (
            <>
              <h3 className="text-xs font-bold text-muted-foreground">
                {OWN_RATING_LABEL}
              </h3>
              {viewerId === null ? (
                <GuestRatingInput />
              ) : (
                <SignedInRatingInput
                  rating={rating}
                  viewerId={viewerId}
                  unverified={kind === 'unverified'}
                  headingRef={headingRef}
                />
              )}
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <Card className="gap-0 py-5">
      <section aria-labelledby={titleId} className="flex flex-col gap-4 px-5">
        <h2
          ref={headingRef}
          id={titleId}
          tabIndex={-1}
          className="text-sm font-extrabold"
        >
          {RATING_SECTION_TITLE}
        </h2>
        {renderBody()}
      </section>
    </Card>
  );
}
