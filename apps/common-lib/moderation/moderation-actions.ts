import { AUDIT_REASON_MAX } from '../admin/admin-input-rules.ts';
import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const MODERATION_ACTIONS = Object.freeze([
  'user.suspend',
  'user.unsuspend',
  'user.administrative-withdraw',
  'product.hide',
  'product.unhide',
  'comment.hide',
  'comment.unhide',
  'rating.invalidate',
  'rating.revalidate',
  'image.approve',
  'image.quarantine',
  'image.release',
  'image.delete',
] as const);

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_TARGET_KINDS = Object.freeze([
  'user',
  'product',
  'comment',
  'rating',
  'image',
] as const);

export type ModerationTargetKind = (typeof MODERATION_TARGET_KINDS)[number];

export type ReasonRequirement = 'required' | 'optional';

// deferredは措置の確定の後に依頼待ちの記録から送り、失敗しても送り直す
export type NoticePolicy = 'deferred' | 'none';

// 上流のライフサイクルのイベントの種類の写し。共用部品は他の層を読み込めないため値を持ち、一致はルートの写しの照合のテストで確かめる
export const MODERATION_USER_LIFECYCLE_EVENTS = Object.freeze([
  'suspended',
  'unsuspended',
  'withdrawn',
] as const);

export const MODERATION_PRODUCT_LIFECYCLE_EVENTS = Object.freeze([
  'hidden',
  'unhidden',
] as const);

export type ModerationLifecycleEvent =
  | (typeof MODERATION_USER_LIFECYCLE_EVENTS)[number]
  | (typeof MODERATION_PRODUCT_LIFECYCLE_EVENTS)[number];

export interface ModerationActionDefinition {
  readonly action: ModerationAction;
  readonly targetKind: ModerationTargetKind;
  readonly reason: ReasonRequirement;
  readonly notice: NoticePolicy;
  readonly lifecycleEvent: ModerationLifecycleEvent | null;
}

const defineModerationAction = (
  definition: ModerationActionDefinition,
): ModerationActionDefinition => Object.freeze({ ...definition });

export const MODERATION_ACTION_DEFINITIONS: Readonly<
  Record<ModerationAction, ModerationActionDefinition>
> = Object.freeze({
  'user.suspend': defineModerationAction({
    action: 'user.suspend',
    targetKind: 'user',
    reason: 'required',
    notice: 'deferred',
    lifecycleEvent: 'suspended',
  }),
  'user.unsuspend': defineModerationAction({
    action: 'user.unsuspend',
    targetKind: 'user',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: 'unsuspended',
  }),
  // 本人の意思の確かめと完了の知らせはシステムの外のメールで行うため、通知を送らない
  'user.administrative-withdraw': defineModerationAction({
    action: 'user.administrative-withdraw',
    targetKind: 'user',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: 'withdrawn',
  }),
  'product.hide': defineModerationAction({
    action: 'product.hide',
    targetKind: 'product',
    reason: 'required',
    notice: 'deferred',
    lifecycleEvent: 'hidden',
  }),
  'product.unhide': defineModerationAction({
    action: 'product.unhide',
    targetKind: 'product',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: 'unhidden',
  }),
  'comment.hide': defineModerationAction({
    action: 'comment.hide',
    targetKind: 'comment',
    reason: 'required',
    notice: 'deferred',
    lifecycleEvent: null,
  }),
  'comment.unhide': defineModerationAction({
    action: 'comment.unhide',
    targetKind: 'comment',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'rating.invalidate': defineModerationAction({
    action: 'rating.invalidate',
    targetKind: 'rating',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'rating.revalidate': defineModerationAction({
    action: 'rating.revalidate',
    targetKind: 'rating',
    reason: 'required',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'image.approve': defineModerationAction({
    action: 'image.approve',
    targetKind: 'image',
    reason: 'optional',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'image.quarantine': defineModerationAction({
    action: 'image.quarantine',
    targetKind: 'image',
    reason: 'optional',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'image.release': defineModerationAction({
    action: 'image.release',
    targetKind: 'image',
    reason: 'optional',
    notice: 'none',
    lifecycleEvent: null,
  }),
  'image.delete': defineModerationAction({
    action: 'image.delete',
    targetKind: 'image',
    reason: 'optional',
    notice: 'none',
    lifecycleEvent: null,
  }),
});

export const MODERATION_NOTICE_STATUSES = Object.freeze([
  'none',
  'pending',
  'requested',
  'skipped',
] as const);

export type NoticeStatus = (typeof MODERATION_NOTICE_STATUSES)[number];

// 措置の理由は監査ログの理由としても記録するため、監査ログの理由の上限を超えられない
export const MODERATION_REASON_MAX = AUDIT_REASON_MAX;

export type ReasonCheck = 'ok' | 'required' | 'too-long';

export const checkModerationReason = (
  action: ModerationAction,
  reason: string | undefined,
): ReasonCheck => {
  const graphemes = countGraphemes(trimWhiteSpace(reason ?? ''));
  if (
    graphemes === 0 &&
    MODERATION_ACTION_DEFINITIONS[action].reason === 'required'
  ) {
    return 'required';
  }
  return graphemes > MODERATION_REASON_MAX ? 'too-long' : 'ok';
};

export const MODERATION_REASON_MESSAGES: Readonly<
  Record<ReasonCheck, string | undefined>
> = Object.freeze({
  ok: undefined,
  required: '理由を入力してください。',
  'too-long': `理由は${String(MODERATION_REASON_MAX)}文字以内で入力してください。`,
});

export const NOTICE_EXCERPT_MAX = 100;

export const ADMIN_LIST_PAGE_SIZE = 50;

export const STATISTICS_WEEKS_SHOWN = 26;
