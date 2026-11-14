import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useId } from 'react';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import {
  type AdminNotificationSenderInfo,
  type AdminNotificationSenderInfoState,
  adminNotificationSenderInfoQueryOptions,
  toSenderInfoLastChange,
} from '../../graphql/admin-notification-sender-info.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';
import { SenderInfoForm } from './sender-info-form.tsx';
import {
  SENDER_INFO_DESCRIPTION,
  SENDER_INFO_FIELD_NAMES,
  SENDER_INFO_NONE_LABEL,
  SENDER_INFO_READ_ONLY_NOTICE,
  SENDER_INFO_TITLE,
  SENDER_INFO_UNSET_WARNING,
  SENDER_INFO_UPDATED_AT_LABEL,
  SENDER_INFO_UPDATED_BY_LABEL,
} from './sender-info-messages.ts';

const LIST_CLASS_NAME = 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm';

interface SenderInfoLastChangeListProps {
  readonly state: AdminNotificationSenderInfoState;
}

function SenderInfoLastChangeList({ state }: SenderInfoLastChangeListProps) {
  const { updatedAt, updatedByNickname } = toSenderInfoLastChange(state);
  return (
    <dl className={LIST_CLASS_NAME}>
      <dt className="text-muted-foreground">{SENDER_INFO_UPDATED_AT_LABEL}</dt>
      <dd>
        {updatedAt === null ? (
          SENDER_INFO_NONE_LABEL
        ) : (
          <DateTime value={updatedAt} format="longDateTime" />
        )}
      </dd>
      <dt className="text-muted-foreground">{SENDER_INFO_UPDATED_BY_LABEL}</dt>
      <dd>{updatedByNickname ?? SENDER_INFO_NONE_LABEL}</dd>
    </dl>
  );
}

interface SenderInfoValueListProps {
  readonly info: AdminNotificationSenderInfo;
}

function SenderInfoValueList({ info }: SenderInfoValueListProps) {
  return (
    <dl className={LIST_CLASS_NAME}>
      <dt className="text-muted-foreground">
        {SENDER_INFO_FIELD_NAMES.businessName}
      </dt>
      <dd className="break-words">{info.businessName}</dd>
      <dt className="text-muted-foreground">
        {SENDER_INFO_FIELD_NAMES.contactEmail}
      </dt>
      <dd className="break-all">{info.contactEmail}</dd>
      <dt className="text-muted-foreground">
        {SENDER_INFO_FIELD_NAMES.postalAddress}
      </dt>
      <dd className="break-words">{info.postalAddress}</dd>
    </dl>
  );
}

interface SenderInfoContentProps {
  readonly state: AdminNotificationSenderInfoState;
  readonly canEdit: boolean;
}

function SenderInfoContent({ state, canEdit }: SenderInfoContentProps) {
  return (
    <>
      {state.info === null ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <TriangleAlertIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <span>{SENDER_INFO_UNSET_WARNING}</span>
        </p>
      ) : null}
      {canEdit ? (
        <SenderInfoForm state={state} />
      ) : (
        <>
          {state.info === null ? null : (
            <SenderInfoValueList info={state.info} />
          )}
          <p className="text-sm text-muted-foreground">
            {SENDER_INFO_READ_ONLY_NOTICE}
          </p>
        </>
      )}
      <SenderInfoLastChangeList state={state} />
    </>
  );
}

// 設定のページの送信者情報の区画。最上位管理者だけが編集でき、他のロールは参照だけにする
export function SenderInfoSection() {
  const headingId = useId();
  const canEdit = hasRole(useAdminRole(), 'super_admin');
  const { data } = useQuery({
    ...adminNotificationSenderInfoQueryOptions(),
    // 値が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の値を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const state = data?.notificationSenderInfo;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {SENDER_INFO_TITLE}
      </h2>
      <p className="text-sm text-muted-foreground">{SENDER_INFO_DESCRIPTION}</p>
      {state === undefined ? (
        <LoadingSkeleton />
      ) : (
        <SenderInfoContent state={state} canEdit={canEdit} />
      )}
    </section>
  );
}
