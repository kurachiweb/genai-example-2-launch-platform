import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, notFound } from '@tanstack/react-router';
import { useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import { INQUIRY_DETAIL_ACTIONS } from '../../composition/inquiry-detail-actions.ts';
import {
  adminInquiryQueryOptions,
  inquiryDetailActionContextOf,
  toAdminInquiryDetail,
} from '../../graphql/admin-inquiries.ts';
import type { AdminInquiryQuery } from '../../graphql/generated/graphql.ts';
import { INQUIRY_DETAIL_TITLE } from '../inquiry/admin-inquiries-messages.ts';
import { GuestInquiryDetail } from '../inquiry/guest-inquiry-detail.tsx';
import { InquiryDetailActionsView } from '../inquiry/inquiry-detail-actions-view.tsx';
import { InquiryReplyForm } from '../inquiry/inquiry-reply-form.tsx';
import { InquiryStatusControl } from '../inquiry/inquiry-status-control.tsx';
import { RoleGate } from '../layout/role-gate.tsx';
import { MemberInquiryDetail } from '../inquiry/member-inquiry-detail.tsx';

const routeApi = getRouteApi('/_authenticated/inquiries/$inquiryId');

// 未ログインの問い合わせは利用者が後からメッセージを送れず変わるのは管理者の操作だけのため、ログインの問い合わせだけを最新に保つ
const isMemberInquiry = (query: {
  readonly state: { readonly data?: AdminInquiryQuery | undefined };
}): boolean => query.state.data?.adminInquiry?.kind === 'MEMBER';

export function InquiryDetailPage() {
  const { inquiryId } = routeApi.useParams();
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 表示する前にloaderが毎回新しく取得しているため、表示した時点では取り直さず、loaderの取得とハイドレーションの直後の取得を重ねない
  const { data: inquiry } = useSuspenseQuery({
    ...adminInquiryQueryOptions(inquiryId),
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      autoRefresh && isMemberInquiry(query)
        ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
        : false,
    refetchOnWindowFocus: isMemberInquiry,
    refetchOnMount: false,
    select: toAdminInquiryDetail,
  });
  // loaderが確かめた問い合わせが取り直しで消えるのは物理削除の後で、存在しないページとして扱う
  if (inquiry === undefined) {
    throw notFound();
  }
  const withdrawn = inquiry.kind === 'member' && inquiry.withdrawn;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <AdminPageHeader title={INQUIRY_DETAIL_TITLE} />
      {inquiry.kind === 'member' ? (
        <MemberInquiryDetail
          inquiry={inquiry}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
        />
      ) : (
        <GuestInquiryDetail inquiry={inquiry} />
      )}
      {/* 退会済みの問い合わせは利用者のデータの保持のためだけに残り、返信もステータスの変更も受け付けない */}
      {withdrawn ? null : (
        <RoleGate minimum="moderator">
          {inquiry.kind === 'member' ? (
            <InquiryReplyForm inquiryId={inquiry.id} />
          ) : null}
          <InquiryStatusControl
            inquiryId={inquiry.id}
            status={inquiry.status}
          />
        </RoleGate>
      )}
      <InquiryDetailActionsView
        actions={INQUIRY_DETAIL_ACTIONS}
        inquiry={inquiryDetailActionContextOf(inquiry)}
      />
    </div>
  );
}
