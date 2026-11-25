import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { type RefObject, useRef, useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminSponsorshipTerminationResult,
  adminSponsorshipsQueryOptions,
  toAdminSponsorshipPage,
} from '../../graphql/admin-sponsorships.ts';
import {
  type AdminSponsorshipSearch,
  adminSponsorshipFilterScopeOf,
  adminSponsorshipSearchAt,
  adminSponsorshipVariablesOf,
} from '../sponsorship/admin-sponsorship-search.ts';
import { AdminSponsorshipTable } from '../sponsorship/admin-sponsorship-table.tsx';
import {
  SPONSORSHIPS_DESCRIPTION,
  SPONSORSHIPS_TITLE,
} from '../sponsorship/admin-sponsorships-messages.ts';
import { SponsorshipStatusFilter } from '../sponsorship/sponsorship-status-filter.tsx';
import { TerminateSponsorshipDialog } from '../sponsorship/terminate-sponsorship-dialog.tsx';
import { TerminationResultNotice } from '../sponsorship/termination-result-notice.tsx';

const routeApi = getRouteApi('/_authenticated/sponsorships/');

// 強制終了の確認を閉じた後のフォーカスの移り先。開いた元の「強制終了」は確定や拒否の後の取り直しで消える
type TerminationFocus = 'opener' | 'result' | 'list';

export function SponsorshipsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const sponsorships = useQuery({
    ...adminSponsorshipsQueryOptions(adminSponsorshipVariablesOf(search)),
    select: toAdminSponsorshipPage,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const [terminatingId, setTerminatingId] = useState<string>();
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminationFocus, setTerminationFocus] =
    useState<TerminationFocus>('opener');
  const [terminationResult, setTerminationResult] =
    useState<AdminSponsorshipTerminationResult>();
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const scope = adminSponsorshipFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const pageInfo = sponsorships.data?.pageInfo;
  const nextCursor =
    pageInfo?.hasNextPage === true ? (pageInfo.endCursor ?? null) : null;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = sponsorships.isFetching ? null : sponsorships.error;
  const show = (next: AdminSponsorshipSearch) => {
    void navigate({ search: next });
  };
  const terminationReturnFocusRef: RefObject<HTMLElement | null> | undefined =
    terminationFocus === 'result'
      ? resultHeadingRef
      : terminationFocus === 'list'
        ? listHeadingRef
        : undefined;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={SPONSORSHIPS_TITLE}
        description={SPONSORSHIPS_DESCRIPTION}
      />
      {terminationResult === undefined ? null : (
        <TerminationResultNotice
          result={terminationResult}
          headingRef={resultHeadingRef}
        />
      )}
      <SponsorshipStatusFilter
        search={search}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <AdminSponsorshipTable
        rows={sponsorships.data?.nodes}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void sponsorships.refetch();
                },
              },
            })}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(adminSponsorshipSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(adminSponsorshipSearchAt(search, nextCursor));
          },
        }}
        onTerminate={(row) => {
          setTerminatingId(row.id);
          setTerminationFocus('opener');
          setTerminateOpen(true);
        }}
        headingRef={listHeadingRef}
      />
      <TerminateSponsorshipDialog
        sponsorshipId={terminatingId}
        open={terminateOpen}
        onOpenChange={setTerminateOpen}
        onTerminated={(result) => {
          setTerminationResult(result);
          setTerminationFocus('result');
        }}
        onNotTerminable={() => {
          setTerminationFocus('list');
        }}
        {...(terminationReturnFocusRef === undefined
          ? {}
          : { returnFocusRef: terminationReturnFocusRef })}
      />
    </div>
  );
}
