import {
  MODERATION_ACTIONS,
  type ModerationAction,
} from '../../../../common-lib/moderation/moderation-actions.ts';

// 画像の公開拒否は削除の措置を、確認と結果の文言だけを替えて行う
export type ModerationOperation = ModerationAction | 'image.reject';

export const MODERATION_OPERATIONS: readonly ModerationOperation[] =
  Object.freeze([...MODERATION_ACTIONS, 'image.reject']);

export const moderationActionOf = (
  operation: ModerationOperation,
): ModerationAction =>
  operation === 'image.reject' ? 'image.delete' : operation;
