import { and, eq, inArray } from 'drizzle-orm';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type { Database } from '../../../db/client.ts';
import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';
import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import {
  type AlertThrottle,
  type EmailSender,
  EmailSendError,
  type SuppressionList,
} from '../../../lib/core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import {
  type AwardNoticeView,
  buildNoticeEmail,
  type NoticeEmailContext,
  type NoticeMakerView,
  type NoticeProductView,
  unsubscribeTargetsOf,
} from '../../../lib/core/notifications/notice-email.ts';
import {
  type GroupEmailPlan,
  type NoticeEmailPlan,
  type NoticeSkipReason,
  type PendingNotice,
  planGroupEmail,
  type SkippedNotice,
} from '../../../lib/core/notifications/notice-plan.ts';
import { noticeGroupOutcome } from '../../../lib/core/notifications/notice-settlement.ts';
import type {
  NoticeGroup,
  NoticeSettlement,
  NotificationIncidentReporter,
  NotificationNoticeStore,
  NotificationPreferenceStore,
  SenderInfoStore,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';
import type {
  ResultNoticeSupplement,
  ResultNoticeSupplementInput,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import type {
  GroupDispatcher,
  GroupDispatchStep,
  SupplementSource,
} from '../../application/notifications/ports.ts';

export interface EmailGroupDispatcherDependencies {
  readonly db: Database;
  readonly notices: NotificationNoticeStore;
  readonly preferences: NotificationPreferenceStore;
  readonly senderInfo: SenderInfoStore;
  readonly tokens: UnsubscribeTokenService;
  readonly incidents: NotificationIncidentReporter;
  readonly alertThrottle: AlertThrottle;
  readonly contacts: UserContactDirectory;
  readonly suppressions: SuppressionList;
  readonly emails: EmailSender;
  readonly matches: MatchDirectory;
  readonly products: ProductDirectory;
  readonly profiles: UserProfileDirectory;
  readonly supplements: SupplementSource;
  readonly origins: NoticeEmailContext['origins'];
}

interface PlannedGroup {
  readonly group: NoticeGroup;
  readonly planned: GroupEmailPlan & { readonly plan: NoticeEmailPlan };
}

interface SendableGroup extends PlannedGroup {
  readonly contact: UserContact;
}

type SharedContext = Omit<NoticeEmailContext, 'contact'>;

const SENDER_INFO_ALERT_NAME = 'notifications-sender-info-missing';
const SENDER_INFO_ALERT_INTERVAL_SECONDS = 3600;

// D1のバインド変数の上限(100)から、IDの一覧以外の条件に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const FOLLOWED_TOPICS: ReadonlySet<NotificationTopic> = new Set([
  'followed_user_match',
  'followed_user_award',
]);

const logger = getAppLogger(['event', 'notifications', 'dispatch']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function unique<T>(items: readonly (T | null | undefined)[]): T[] {
  return [
    ...new Set(
      items.filter((item): item is T => item !== null && item !== undefined),
    ),
  ];
}

function skippedEntries(skipped: readonly SkippedNotice[]): NoticeSettlement[] {
  return skipped.map(({ noticeId, reason }) => ({
    noticeId,
    status: 'skipped',
    reason,
    emailRequestId: null,
  }));
}

// まとめのキー全体の理由は、計画が送らないと決めた通知の理由を残し、送るはずだった通知にだけ付ける
function skipWholeGroup(
  { group, planned }: PlannedGroup,
  reason: NoticeSkipReason,
): readonly SkippedNotice[] {
  const plannedSkips = new Set(planned.skipped.map(({ noticeId }) => noticeId));
  return [
    ...planned.skipped,
    ...group.notices
      .filter(({ noticeId }) => !plannedSkips.has(noticeId))
      .map(({ noticeId }) => ({ noticeId, reason })),
  ];
}

function noticesOfPlan(plan: NoticeEmailPlan): readonly PendingNotice[] {
  switch (plan.kind) {
    case 'match-preview':
      return [plan.preview];
    case 'match-result':
      return plan.preview === null
        ? [plan.result]
        : [plan.result, plan.preview];
    case 'followed-user-matches':
      return plan.items;
    case 'followed-user-award':
      return [plan.award];
  }
}

function supplementInputOf(
  notice: PendingNotice,
  match: MatchRecord | undefined,
): ResultNoticeSupplementInput | undefined {
  const own = match?.entries.find(({ entryId }) => entryId === notice.entryId);
  if (
    match?.decidedAt === null ||
    match?.decidedAt === undefined ||
    own?.result === null ||
    own?.result === undefined ||
    own.productId === null ||
    own.ownerUserId === null
  ) {
    return undefined;
  }
  return {
    matchId: match.matchId,
    kind: match.kind,
    round: match.round,
    stage: match.stage,
    matchDate: match.matchDate,
    entryId: own.entryId,
    launchId: own.launchId,
    productId: own.productId,
    ownerUserId: own.ownerUserId,
    result: own.result,
    decidedAt: match.decidedAt,
  };
}

export class EmailGroupDispatcher implements GroupDispatcher {
  constructor(private readonly deps: EmailGroupDispatcherDependencies) {}

  async dispatchNext(
    slotKey: string,
    now: Date,
    limit: number,
  ): Promise<GroupDispatchStep> {
    const groups = await this.deps.notices.nextPendingGroups(slotKey, limit);
    if (groups.length === 0) {
      return { emails: 0, skipped: 0, more: false };
    }
    const more = groups.length >= limit;
    const { planned, skips } = await this.plan(groups);
    const sender = await this.deps.senderInfo.get();
    let step: { readonly emails: number; readonly skipped: number };
    if (sender?.info === undefined) {
      const missing = planned.flatMap((entry) =>
        skipWholeGroup(entry, 'sender_info_missing'),
      );
      await this.reportSenderInfoMissing(
        missing.filter(({ reason }) => reason === 'sender_info_missing').length,
        now,
      );
      skips.push(...missing);
      await this.settle(skippedEntries(skips), now);
      step = { emails: 0, skipped: 0 };
    } else {
      const sendable = await this.sendableGroups(planned, skips);
      await this.settle(skippedEntries(skips), now);
      step = await this.send(sendable, now);
    }
    const skipped = skips.length + step.skipped;
    logger.info('通知のまとめを処理しました', {
      slot: slotKey,
      groups: groups.length,
      emails: step.emails,
      skipped,
    });
    return { emails: step.emails, skipped, more };
  }

  // 送る直前の受信設定と送信の対象者で計画し、計画の無いまとめの通知を送らない扱いにする
  private async plan(groups: readonly NoticeGroup[]): Promise<{
    readonly planned: readonly PlannedGroup[];
    readonly skips: SkippedNotice[];
  }> {
    const enabled = await this.deps.preferences.enabledTopicsOf(
      unique(
        groups.flatMap(({ notices }) =>
          notices.map((notice) => notice.recipientUserId),
        ),
      ),
    );
    const skips: SkippedNotice[] = [];
    const planned: PlannedGroup[] = [];
    for (const group of groups) {
      const [first] = group.notices;
      const plan = planGroupEmail({
        notices: group.notices,
        enabledTopics:
          first === undefined ? undefined : enabled.get(first.recipientUserId),
      });
      if (plan.plan === null) {
        skips.push(
          ...noticeGroupOutcome({
            notices: group.notices,
            planned: plan,
            build: undefined,
          }).skipped,
        );
      } else {
        planned.push({ group, planned: { ...plan, plan: plan.plan } });
      }
    }
    return { planned, skips };
  }

  // 送信の対象者の確かめ直しの後に退会・未確認・抑止になった宛先を除く
  private async sendableGroups(
    planned: readonly PlannedGroup[],
    skips: SkippedNotice[],
  ): Promise<readonly SendableGroup[]> {
    const contacts = await Promise.all(
      planned.map(async (entry) => ({
        entry,
        contact: await this.deps.contacts.findContact(
          entry.planned.plan.recipientUserId,
        ),
      })),
    );
    const verified = contacts.flatMap(({ entry, contact }) => {
      if (contact === undefined) {
        skips.push(...skipWholeGroup(entry, 'recipient_unavailable'));
        return [];
      }
      if (!contact.emailVerified) {
        skips.push(...skipWholeGroup(entry, 'email_not_verified'));
        return [];
      }
      return [{ ...entry, contact }];
    });
    if (verified.length === 0) {
      return [];
    }
    const suppressed = await this.deps.suppressions.findSuppressed(
      verified.map(({ contact }) => contact.email),
    );
    return verified.filter((entry) => {
      if (!suppressed.has(toMatchingKey(entry.contact.email))) {
        return true;
      }
      skips.push(...skipWholeGroup(entry, 'suppressed'));
      return false;
    });
  }

  private async send(
    sendable: readonly SendableGroup[],
    now: Date,
  ): Promise<{ readonly emails: number; readonly skipped: number }> {
    if (sendable.length === 0) {
      return { emails: 0, skipped: 0 };
    }
    const shared = await this.sharedContext(sendable, now);
    let emails = 0;
    let skipped = 0;
    for (const { group, planned, contact } of sendable) {
      const build = buildNoticeEmail(planned.plan, {
        ...shared,
        contact: { email: contact.email, nickname: contact.nickname },
      });
      const outcome = noticeGroupOutcome({
        notices: group.notices,
        planned,
        build,
      });
      const requestId =
        build.kind === 'email'
          ? await this.request(contact.email, build)
          : undefined;
      const sentAs: NoticeSettlement[] =
        requestId === undefined
          ? skippedEntries(
              outcome.sent.map((noticeId) => ({
                noticeId,
                reason: 'send_rejected',
              })),
            )
          : outcome.sent.map((noticeId) => ({
              noticeId,
              status: 'sent',
              reason: null,
              emailRequestId: requestId,
            }));
      // 送信の依頼の後にこの確定が失敗して段を再試行すると、同じ通知をもう1通依頼し得る(要件7.12で許容する重複)
      await this.settle([...sentAs, ...skippedEntries(outcome.skipped)], now);
      emails += requestId === undefined ? 0 : 1;
      skipped +=
        outcome.skipped.length +
        (requestId === undefined ? outcome.sent.length : 0);
    }
    return { emails, skipped };
  }

  // 送信の要求の拒否は送り直しても直らないため、報告して送らない扱いにする。それ以外の失敗は段の再試行に任せる
  private async request(
    to: string,
    build: Extract<ReturnType<typeof buildNoticeEmail>, { kind: 'email' }>,
  ): Promise<string | undefined> {
    try {
      return await this.deps.emails.send({
        kind: build.emailKind,
        to,
        input: build.input,
        headers: build.headers,
        ...(build.deadline === undefined ? {} : { deadline: build.deadline }),
      });
    } catch (error) {
      if (!(error instanceof EmailSendError)) {
        throw error;
      }
      this.deps.incidents.report({
        kind: 'send-rejected',
        emailKind: build.emailKind.name,
        reason: error.reason,
      });
      return undefined;
    }
  }

  private async sharedContext(
    sendable: readonly SendableGroup[],
    now: Date,
  ): Promise<SharedContext> {
    const notices = sendable.flatMap(({ planned }) =>
      noticesOfPlan(planned.plan),
    );
    const matchIds = unique(notices.map(({ matchId }) => matchId));
    const matches =
      matchIds.length === 0
        ? new Map<string, MatchRecord>()
        : await this.deps.matches.findMatches(matchIds, now);
    const products = await this.productsOf(notices, matches);
    const makers = await this.makersOf(notices, products);
    const awards = await this.awardsOf(notices);
    const supplements = await this.supplementsOf(sendable, matches, products);
    const tokens = await this.deps.tokens.tokensFor(
      sendable.flatMap(({ planned }) => unsubscribeTargetsOf(planned.plan)),
      now,
    );
    return {
      matches,
      products,
      makers,
      awards,
      tokens,
      supplements,
      origins: this.deps.origins,
      now,
    };
  }

  // 相手のプロダクトも名前を示すため、照会したマッチの全ての側を含める
  private async productsOf(
    notices: readonly PendingNotice[],
    matches: ReadonlyMap<string, MatchRecord>,
  ): Promise<ReadonlyMap<string, NoticeProductView>> {
    const productIds = unique([
      ...notices.map(({ productId }) => productId),
      ...[...matches.values()].flatMap(({ entries }) =>
        entries.map(({ productId }) => productId),
      ),
    ]);
    return productIds.length === 0
      ? new Map()
      : this.deps.products.findSummaries(productIds, 'visible');
  }

  private async makersOf(
    notices: readonly PendingNotice[],
    products: ReadonlyMap<string, NoticeProductView>,
  ): Promise<ReadonlyMap<string, NoticeMakerView>> {
    const makerIds = unique(
      notices
        .filter(({ topic }) => FOLLOWED_TOPICS.has(topic))
        .map(({ productId }) =>
          productId === null ? undefined : products.get(productId)?.ownerUserId,
        ),
    );
    return makerIds.length === 0
      ? new Map()
      : this.deps.profiles.findSummaries(makerIds, 'visible');
  }

  // 受賞の通知は通知イベントのIDだけを持つため、賞と期間を通知イベントの行から読む
  private async awardsOf(
    notices: readonly PendingNotice[],
  ): Promise<ReadonlyMap<string, AwardNoticeView>> {
    const eventIds = unique(
      notices
        .filter(({ topic }) => topic === 'followed_user_award')
        .map(({ eventId }) => eventId),
    );
    const pages = await Promise.all(
      chunk(eventIds, IDS_PER_STATEMENT).map((page) =>
        this.deps.db
          .select({
            eventId: notificationEvents.id,
            award: notificationEvents.award,
            period: notificationEvents.period,
          })
          .from(notificationEvents)
          .where(
            and(
              inArray(notificationEvents.id, page),
              eq(notificationEvents.type, 'award'),
            ),
          ),
      ),
    );
    return new Map(
      pages
        .flat()
        .flatMap(({ eventId, award, period }) =>
          award === null || period === null
            ? []
            : [[eventId, { award, period }] as const],
        ),
    );
  }

  private async supplementsOf(
    sendable: readonly SendableGroup[],
    matches: ReadonlyMap<string, MatchRecord>,
    products: ReadonlyMap<string, NoticeProductView>,
  ): Promise<ReadonlyMap<string, readonly ResultNoticeSupplement[]>> {
    const requests = sendable.flatMap(({ planned: { plan } }) => {
      if (plan.kind !== 'match-result') {
        return [];
      }
      const { result } = plan;
      const input =
        result.matchId === null
          ? undefined
          : supplementInputOf(result, matches.get(result.matchId));
      return input === undefined || !products.has(input.productId)
        ? []
        : [{ noticeId: result.noticeId, input }];
    });
    return requests.length === 0
      ? new Map()
      : this.deps.supplements.supplementsFor(requests);
  }

  // 間引きの失敗で送らない扱いの確定を止めないよう、間引けないときは報告する
  private async reportSenderInfoMissing(
    skipped: number,
    now: Date,
  ): Promise<void> {
    if (skipped === 0) {
      return;
    }
    let acquired: boolean;
    try {
      acquired = await this.deps.alertThrottle.tryAcquire(
        SENDER_INFO_ALERT_NAME,
        now,
        SENDER_INFO_ALERT_INTERVAL_SECONDS,
      );
    } catch (error) {
      logger.error('送信者情報の未設定の報告の間引きに失敗しました', { error });
      acquired = true;
    }
    if (acquired) {
      this.deps.incidents.report({ kind: 'sender-info-missing', skipped });
    }
  }

  private async settle(
    entries: readonly NoticeSettlement[],
    now: Date,
  ): Promise<void> {
    if (entries.length > 0) {
      await this.deps.notices.settle(entries, now);
    }
  }
}
