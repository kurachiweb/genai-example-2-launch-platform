import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminNotificationSenderInfoDocument,
  type AdminNotificationSenderInfoQuery,
} from './generated/graphql.ts';

export type AdminNotificationSenderInfoState =
  AdminNotificationSenderInfoQuery['notificationSenderInfo'];

export type AdminNotificationSenderInfo = NonNullable<
  AdminNotificationSenderInfoState['info']
>;

export interface SenderInfoLastChange {
  // nullは最後の変更が無いものとして表示する
  readonly updatedAt: string | null;
  readonly updatedByNickname: string | null;
}

export const adminNotificationSenderInfoQueryOptions = () =>
  graphqlQueryOptions(AdminNotificationSenderInfoDocument, {});

// 一度も保存していない(版が0の)送信者情報は最後の変更を持たない。ニックネームを得られない管理者による保存は日時を残し、管理者だけが無い
export const toSenderInfoLastChange = ({
  version,
  updatedAt,
  updatedByNickname,
}: AdminNotificationSenderInfoState): SenderInfoLastChange =>
  version === 0
    ? { updatedAt: null, updatedByNickname: null }
    : { updatedAt, updatedByNickname };
