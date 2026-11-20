import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type { ModerationTargetKind } from '../../../../common-lib/moderation/moderation-actions.ts';
import { MODERATION_ACTION_DEFINITIONS } from '../../../../common-lib/moderation/moderation-actions.ts';
import { notify } from '../../../../lib/components/feedback/notify.ts';
import { invalidateAuditLogQueries } from '../../../graphql/admin-audit-logs.ts';
import {
  commentModerationActionOptions,
  invalidateAdminModerationEngagementQueries,
  ratingModerationActionOptions,
} from '../../../graphql/admin-moderation-engagement.ts';
import {
  invalidateAdminModerationProductQueries,
  productModerationActionOptions,
} from '../../../graphql/admin-moderation-products.ts';
import type {
  ModerationActionInput,
  ModerationActionOptions,
  ModerationOutcomeView,
} from '../../../graphql/admin-moderation-shared.ts';
import {
  invalidateAdminModerationUserQueries,
  userModerationActionOptions,
} from '../../../graphql/admin-moderation-users.ts';
import {
  imageModerationActionOptions,
  invalidateAdminQuarantinedImageQueries,
} from '../../../graphql/admin-quarantined-images.ts';
import {
  MODERATION_CHANGED_MESSAGES,
  MODERATION_UNCHANGED_MESSAGES,
} from './moderation-messages.ts';
import {
  moderationActionOf,
  type ModerationOperation,
} from './moderation-operations.ts';

type Invalidate = (queryClient: QueryClient) => Promise<void>;

const optionsOf = (operation: ModerationOperation): ModerationActionOptions => {
  const action = moderationActionOf(operation);
  switch (action) {
    case 'user.suspend':
    case 'user.unsuspend':
    case 'user.administrative-withdraw':
      return userModerationActionOptions(action);
    case 'product.hide':
    case 'product.unhide':
      return productModerationActionOptions(action);
    case 'comment.hide':
    case 'comment.unhide':
      return commentModerationActionOptions(action);
    case 'rating.invalidate':
    case 'rating.revalidate':
      return ratingModerationActionOptions(action);
    case 'image.approve':
    case 'image.quarantine':
    case 'image.release':
    case 'image.delete':
      return imageModerationActionOptions(action);
  }
};

// 措置は他の一覧の表示も変える(停止はプロダクトの公開状態・コメントの状態・画像の隔離理由、評価は詳細の平均、画像は一覧と詳細の画像)ため、影響する照会をまとめて無効にする。表示していない照会は古い印が付くだけで取り直さない
const AFFECTED_QUERIES: Readonly<
  Record<ModerationTargetKind, readonly Invalidate[]>
> = Object.freeze({
  user: [
    invalidateAdminModerationUserQueries,
    invalidateAdminModerationProductQueries,
    invalidateAdminModerationEngagementQueries,
    invalidateAdminQuarantinedImageQueries,
  ],
  product: [
    invalidateAdminModerationProductQueries,
    invalidateAdminModerationEngagementQueries,
    invalidateAdminQuarantinedImageQueries,
  ],
  comment: [invalidateAdminModerationEngagementQueries],
  rating: [
    invalidateAdminModerationEngagementQueries,
    invalidateAdminModerationProductQueries,
  ],
  image: [
    invalidateAdminQuarantinedImageQueries,
    invalidateAdminModerationUserQueries,
    invalidateAdminModerationProductQueries,
  ],
});

export type RunModeration = (
  input: ModerationActionInput,
) => Promise<ModerationOutcomeView>;

// 措置を行い、対象の表示を新しい状態に取り直してから、変わったか変わらなかったかを知らせる。監査ログは状態が変わった措置だけが残すため、その時だけ監査ログの照会も無効にする。失敗は例外のまま呼び出し元へ返す
export function useModerationMutation(
  operation: ModerationOperation,
): RunModeration {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(optionsOf(operation));
  const { targetKind } =
    MODERATION_ACTION_DEFINITIONS[moderationActionOf(operation)];

  return async (input) => {
    const outcome = await mutateAsync({ variables: input });
    const invalidations = outcome.changed
      ? [...AFFECTED_QUERIES[targetKind], invalidateAuditLogQueries]
      : AFFECTED_QUERIES[targetKind];
    await Promise.all(
      invalidations.map((invalidate) => invalidate(queryClient)),
    );
    if (outcome.changed) {
      notify.success(MODERATION_CHANGED_MESSAGES[operation]);
    } else {
      notify.info(MODERATION_UNCHANGED_MESSAGES[operation]);
    }
    return outcome;
  };
}
