import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type { ExtraHeaders } from '../email/email-headers.ts';
import type { AnyEmailKind } from '../email/email-kind.ts';
import {
  type FollowedUserAwardEmailInput,
  type FollowedUserMatchesEmailInput,
  MATCH_RESULT_SUPPLEMENT_LIMIT,
  type MatchPreviewEmailInput,
  type MatchResultEmailInput,
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from '../email/kinds/notifications.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchPhase,
  MatchStage,
} from '../match/match-model.ts';
import {
  awardPeriodLabel,
  matchLabel,
  type ResultOutcome,
  resultOutcomeOf,
  roundName,
  UNAVAILABLE_PRODUCT_NAME,
} from './notice-copy.ts';
import type {
  NoticeEmailPlan,
  NoticeSkipReason,
  PendingNotice,
  SkippedNotice,
} from './notice-plan.ts';
import type { AwardKind } from './notification-event-contract.ts';
import type { UnsubscribeTarget } from './ports.ts';
import type { ResultNoticeSupplement } from './result-notice-supplements.ts';
import {
  listUnsubscribeHeaders,
  unsubscribePageUrl,
} from './unsubscribe-token.ts';

export interface MatchNoticeEntryView {
  readonly entryId: string;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly upvoteCount: number;
  readonly result: EntryResult | null;
}

// MatchDirectory.findMatchesの結果をそのまま渡せる形
export interface MatchNoticeView {
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly phase: MatchPhase;
  readonly decision: MatchDecision | null;
  readonly entries: readonly MatchNoticeEntryView[];
}

export interface NoticeProductView {
  readonly name: string;
  readonly handle: string;
  readonly ownerUserId: string;
}

export interface NoticeMakerView {
  readonly nickname: string;
}

export interface AwardNoticeView {
  readonly award: AwardKind;
  readonly period: string;
}

export interface NoticeEmailContext {
  readonly contact: { readonly email: string; readonly nickname: string };
  readonly matches: ReadonlyMap<string, MatchNoticeView>;
  // 表示できるプロダクトだけ
  readonly products: ReadonlyMap<string, NoticeProductView>;
  // 表示できる利用者だけ
  readonly makers: ReadonlyMap<string, NoticeMakerView>;
  // 受賞の通知イベントのID → 賞と期間
  readonly awards: ReadonlyMap<string, AwardNoticeView>;
  // unsubscribeTokenKeyのキー → トークン
  readonly tokens: ReadonlyMap<string, string>;
  // 結果の通知のID → 追記(登録の順)
  readonly supplements: ReadonlyMap<string, readonly ResultNoticeSupplement[]>;
  readonly origins: { readonly client: string; readonly event: string };
  readonly now: Date;
}

export type NoticeEmailBuild =
  | {
      readonly kind: 'email';
      readonly emailKind: AnyEmailKind;
      readonly input: unknown;
      readonly headers: ExtraHeaders;
      readonly deadline: Date | undefined;
      // メールに載せた通知
      readonly sentNoticeIds: readonly string[];
      readonly skipped: readonly SkippedNotice[];
    }
  | {
      readonly kind: 'skip';
      readonly skipped: readonly SkippedNotice[];
    };

type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: NoticeSkipReason };

interface PreviewDetails {
  readonly match: MatchNoticeView;
  readonly ownProductName: string;
  readonly opponentProductName: string;
  readonly matchLabel: string;
}

interface ResultDetails {
  readonly ownProductName: string;
  readonly opponentProductName: string;
  readonly matchLabel: string;
  readonly outcome: ResultOutcome;
  readonly decidedByLastUpvote: boolean;
  readonly ownVotes: number;
  readonly opponentVotes: number;
}

type DigestItem = FollowedUserMatchesEmailInput['items'][number];

type NextMatch = NonNullable<MatchResultEmailInput['next']>;

const SETTINGS_PATH = '/settings/notifications';
const TOP_PAGE_PATH = '/';
const MY_PRODUCTS_PATH = '/my/products';
const PRODUCT_PATH_PREFIX = '/p/';
const OWN_PRODUCT_ACTION_LABEL = '自分のプロダクトを見る';
const MATCH_SIDE_COUNT = 2;
const COMBINABLE_OUTCOMES: ReadonlySet<ResultOutcome> = new Set<ResultOutcome>([
  'won',
  'bye',
]);

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });

const fail = <T>(reason: NoticeSkipReason): Checked<T> => ({
  ok: false,
  reason,
});

const skip = (skipped: readonly SkippedNotice[]): NoticeEmailBuild => ({
  kind: 'skip',
  skipped,
});

const clientUrl = (context: NoticeEmailContext, path: string): string =>
  new URL(path, context.origins.client).href;

// 表記の規則はラウンドの無いトーナメントのマッチなどで例外を投げるため、壊れた1件をその通知だけの送らない判断に留める
function labelOf(compute: () => string): string | undefined {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) {
      return undefined;
    }
    throw error;
  }
}

export function unsubscribeTokenKey(target: UnsubscribeTarget): string {
  return `${target.userId}:${target.topic}`;
}

function tokenOf(
  context: NoticeEmailContext,
  userId: string,
  topic: NotificationTopic,
): string {
  const token = context.tokens.get(unsubscribeTokenKey({ userId, topic }));
  if (token === undefined) {
    throw new RangeError(`配信停止のトークンが渡されていません: ${topic}`);
  }
  return token;
}

function linksOf(
  context: NoticeEmailContext,
  userId: string,
  topic: NotificationTopic,
): {
  readonly links: {
    readonly settingsUrl: string;
    readonly unsubscribeUrl: string;
  };
  readonly headers: ExtraHeaders;
} {
  const token = tokenOf(context, userId, topic);
  return {
    links: {
      settingsUrl: clientUrl(context, SETTINGS_PATH),
      unsubscribeUrl: unsubscribePageUrl(context.origins.client, token),
    },
    headers: listUnsubscribeHeaders(context.origins.event, token),
  };
}

function productNameOf(
  context: NoticeEmailContext,
  productId: string | null | undefined,
): string {
  const product =
    productId === null || productId === undefined
      ? undefined
      : context.products.get(productId);
  return product?.name ?? UNAVAILABLE_PRODUCT_NAME;
}

function ownProductOf(
  context: NoticeEmailContext,
  notice: PendingNotice,
): NoticeProductView | undefined {
  return notice.productId === null
    ? undefined
    : context.products.get(notice.productId);
}

function matchOf(
  context: NoticeEmailContext,
  notice: PendingNotice,
): MatchNoticeView | undefined {
  return notice.matchId === null
    ? undefined
    : context.matches.get(notice.matchId);
}

function previewDetails(
  notice: PendingNotice,
  context: NoticeEmailContext,
): Checked<PreviewDetails> {
  const match = matchOf(context, notice);
  if (
    match === undefined ||
    match.phase !== 'scheduled' ||
    match.entries.length !== MATCH_SIDE_COUNT ||
    match.startsAt.getTime() <= context.now.getTime()
  ) {
    return fail('stale');
  }
  const own = match.entries.find(({ entryId }) => entryId === notice.entryId);
  const opponent = match.entries.find((side) => side !== own);
  if (own === undefined || opponent === undefined) {
    return fail('stale');
  }
  const ownProduct = ownProductOf(context, notice);
  if (ownProduct === undefined) {
    return fail('own_product_unavailable');
  }
  const label = labelOf(() => matchLabel(match));
  if (label === undefined) {
    return fail('stale');
  }
  return ok({
    match,
    ownProductName: ownProduct.name,
    opponentProductName: productNameOf(context, opponent.productId),
    matchLabel: label,
  });
}

function resultDetails(
  notice: PendingNotice,
  context: NoticeEmailContext,
): Checked<ResultDetails> {
  const match = matchOf(context, notice);
  const own = match?.entries.find(({ entryId }) => entryId === notice.entryId);
  if (
    match?.decision === null ||
    match?.decision === undefined ||
    own?.result === null ||
    own?.result === undefined
  ) {
    return fail('stale');
  }
  const outcome = resultOutcomeOf(own.result, match.decision);
  const ownProduct = ownProductOf(context, notice);
  if (outcome === null || ownProduct === undefined) {
    return fail('own_product_unavailable');
  }
  const label = labelOf(() => matchLabel(match));
  if (label === undefined) {
    return fail('stale');
  }
  const opponent = match.entries.find((side) => side !== own);
  return ok({
    ownProductName: ownProduct.name,
    opponentProductName: productNameOf(context, opponent?.productId),
    matchLabel: label,
    outcome,
    decidedByLastUpvote: match.decision === 'last_upvote',
    ownVotes: own.upvoteCount,
    opponentVotes: opponent?.upvoteCount ?? 0,
  });
}

function previewEmail(
  notice: PendingNotice,
  context: NoticeEmailContext,
  skippedBefore: readonly SkippedNotice[],
): NoticeEmailBuild {
  const details = previewDetails(notice, context);
  if (!details.ok) {
    return skip([
      ...skippedBefore,
      { noticeId: notice.noticeId, reason: details.reason },
    ]);
  }
  const { match, ...names } = details.value;
  const { links, headers } = linksOf(
    context,
    notice.recipientUserId,
    'match_preview',
  );
  const input: MatchPreviewEmailInput = {
    ...links,
    ...names,
    nickname: context.contact.nickname,
    startsAt: match.startsAt.toISOString(),
    endsAt: match.endsAt.toISOString(),
    topPageUrl: clientUrl(context, TOP_PAGE_PATH),
  };
  return {
    kind: 'email',
    emailKind: NOTIFICATION_MATCH_PREVIEW_KIND,
    input,
    headers,
    deadline: match.startsAt,
    sentNoticeIds: [notice.noticeId],
    skipped: skippedBefore,
  };
}

// 件名の「次は<ラウンド名>」を作れるのは、勝利・不戦勝の結果と、ラウンドのあるトーナメントの翌日のマッチの組だけ
function nextMatchOf(
  preview: PendingNotice,
  outcome: ResultOutcome,
  context: NoticeEmailContext,
): Checked<NextMatch> {
  const details = previewDetails(preview, context);
  if (!details.ok) {
    return details;
  }
  const { match, opponentProductName } = details.value;
  const nextRoundName =
    match.kind === 'qualifier' ? undefined : labelOf(() => roundName(match));
  if (!COMBINABLE_OUTCOMES.has(outcome) || nextRoundName === undefined) {
    return fail('stale');
  }
  const token = tokenOf(context, preview.recipientUserId, 'match_preview');
  return ok({
    opponentProductName,
    roundName: nextRoundName,
    matchLabel: details.value.matchLabel,
    startsAt: match.startsAt.toISOString(),
    endsAt: match.endsAt.toISOString(),
    unsubscribeUrl: unsubscribePageUrl(context.origins.client, token),
  });
}

function supplementsOf(
  notice: PendingNotice,
  context: NoticeEmailContext,
): MatchResultEmailInput['supplements'] {
  return (context.supplements.get(notice.noticeId) ?? [])
    .slice(0, MATCH_RESULT_SUPPLEMENT_LIMIT)
    .map(({ title, lines, action, emphasized }) => ({
      title,
      lines: [...lines],
      emphasized,
      ...(action === undefined
        ? {}
        : { action: { label: action.label, url: action.url } }),
    }));
}

function resultEmail(
  plan: Extract<NoticeEmailPlan, { kind: 'match-result' }>,
  context: NoticeEmailContext,
): NoticeEmailBuild {
  const { result, preview } = plan;
  const details = resultDetails(result, context);
  if (!details.ok) {
    const skipped = [{ noticeId: result.noticeId, reason: details.reason }];
    return preview === null
      ? skip(skipped)
      : previewEmail(preview, context, skipped);
  }
  const next =
    preview === null
      ? undefined
      : nextMatchOf(preview, details.value.outcome, context);
  const supplements = supplementsOf(result, context);
  const { links, headers } = linksOf(
    context,
    result.recipientUserId,
    'match_result',
  );
  const input: MatchResultEmailInput = {
    ...links,
    ...details.value,
    nickname: context.contact.nickname,
    supplements,
    action: supplements.find(({ action }) => action !== undefined)?.action ?? {
      label: OWN_PRODUCT_ACTION_LABEL,
      url: clientUrl(context, MY_PRODUCTS_PATH),
    },
    next: next?.ok === true ? next.value : null,
  };
  return {
    kind: 'email',
    emailKind: NOTIFICATION_MATCH_RESULT_KIND,
    input,
    headers,
    deadline: undefined,
    sentNoticeIds:
      preview !== null && next?.ok === true
        ? [result.noticeId, preview.noticeId]
        : [result.noticeId],
    skipped:
      preview !== null && next?.ok === false
        ? [{ noticeId: preview.noticeId, reason: next.reason }]
        : [],
  };
}

function digestItemOf(
  notice: PendingNotice,
  context: NoticeEmailContext,
): Checked<{ readonly item: DigestItem; readonly endsAt: Date }> {
  const match = matchOf(context, notice);
  const own = match?.entries.find(
    ({ productId }) => productId === notice.productId,
  );
  const opponent = match?.entries.find((side) => side !== own);
  if (match?.phase !== 'live' || own === undefined || opponent === undefined) {
    return fail('stale');
  }
  const product = ownProductOf(context, notice);
  const maker =
    product === undefined ? undefined : context.makers.get(product.ownerUserId);
  if (product === undefined || maker === undefined) {
    return fail('own_product_unavailable');
  }
  const label = labelOf(() => matchLabel(match));
  if (label === undefined) {
    return fail('stale');
  }
  return ok({
    item: {
      productName: product.name,
      makerNickname: maker.nickname,
      matchLabel: label,
      opponentProductName: productNameOf(context, opponent.productId),
    },
    endsAt: match.endsAt,
  });
}

function digestEmail(
  plan: Extract<NoticeEmailPlan, { kind: 'followed-user-matches' }>,
  context: NoticeEmailContext,
): NoticeEmailBuild {
  const checked = plan.items.map((notice) => ({
    noticeId: notice.noticeId,
    checked: digestItemOf(notice, context),
  }));
  const skipped = checked.flatMap(({ noticeId, checked: result }) =>
    result.ok ? [] : [{ noticeId, reason: result.reason }],
  );
  const shown = checked.flatMap(({ noticeId, checked: result }) =>
    result.ok ? [{ noticeId, ...result.value }] : [],
  );
  if (shown.length === 0) {
    return skip(skipped);
  }
  const { links, headers } = linksOf(
    context,
    plan.recipientUserId,
    'followed_user_match',
  );
  const input: FollowedUserMatchesEmailInput = {
    ...links,
    nickname: context.contact.nickname,
    items: shown.map(({ item }) => item),
    omittedCount: plan.omittedCount,
    topPageUrl: clientUrl(context, TOP_PAGE_PATH),
  };
  return {
    kind: 'email',
    emailKind: NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
    input,
    headers,
    deadline: new Date(
      Math.min(...shown.map(({ endsAt }) => endsAt.getTime())),
    ),
    sentNoticeIds: shown.map(({ noticeId }) => noticeId),
    skipped,
  };
}

function awardEmail(
  plan: Extract<NoticeEmailPlan, { kind: 'followed-user-award' }>,
  context: NoticeEmailContext,
): NoticeEmailBuild {
  const notice = plan.award;
  const skipAs = (reason: NoticeSkipReason): NoticeEmailBuild =>
    skip([{ noticeId: notice.noticeId, reason }]);
  const award =
    notice.eventId === null ? undefined : context.awards.get(notice.eventId);
  if (award === undefined) {
    return skipAs('stale');
  }
  const product = ownProductOf(context, notice);
  const maker =
    product === undefined ? undefined : context.makers.get(product.ownerUserId);
  if (product === undefined || maker === undefined) {
    return skipAs('own_product_unavailable');
  }
  const periodLabel = labelOf(() =>
    awardPeriodLabel(award.award, award.period),
  );
  if (periodLabel === undefined) {
    return skipAs('stale');
  }
  const { links, headers } = linksOf(
    context,
    plan.recipientUserId,
    'followed_user_award',
  );
  const input: FollowedUserAwardEmailInput = {
    ...links,
    nickname: context.contact.nickname,
    productName: product.name,
    makerNickname: maker.nickname,
    award: award.award,
    periodLabel,
    productUrl: clientUrl(
      context,
      `${PRODUCT_PATH_PREFIX}${encodeURIComponent(product.handle)}`,
    ),
  };
  return {
    kind: 'email',
    emailKind: NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
    input,
    headers,
    deadline: undefined,
    sentNoticeIds: [notice.noticeId],
    skipped: [],
  };
}

export function buildNoticeEmail(
  plan: NoticeEmailPlan,
  context: NoticeEmailContext,
): NoticeEmailBuild {
  switch (plan.kind) {
    case 'match-preview':
      return previewEmail(plan.preview, context, []);
    case 'match-result':
      return resultEmail(plan, context);
    case 'followed-user-matches':
      return digestEmail(plan, context);
    case 'followed-user-award':
      return awardEmail(plan, context);
  }
}

const PLAN_TOPICS: Readonly<
  Record<NoticeEmailPlan['kind'], NotificationTopic>
> = Object.freeze({
  'match-preview': 'match_preview',
  'match-result': 'match_result',
  'followed-user-matches': 'followed_user_match',
  'followed-user-award': 'followed_user_award',
});

// 統合したメールは本文の2つ目の配信停止のリンクに予告の種別のトークンも使う
export function unsubscribeTargetsOf(
  plan: NoticeEmailPlan,
): readonly UnsubscribeTarget[] {
  const topics: readonly NotificationTopic[] =
    plan.kind === 'match-result' && plan.preview !== null
      ? ['match_result', 'match_preview']
      : [PLAN_TOPICS[plan.kind]];
  return topics.map((topic) => ({ userId: plan.recipientUserId, topic }));
}
