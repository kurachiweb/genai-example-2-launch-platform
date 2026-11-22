import { inject, injectable } from 'inversify';

import {
  isClosedStatus,
  REPORT_NOTICE_EXCERPT_MAX,
} from '../../../common-lib/reporting/report-case-rules.ts';
import {
  countGraphemes,
  truncateGraphemes,
} from '../../../common-lib/text/graphemes.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import {
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
  type ReportOutcomeInput,
} from '../../../lib/core/email/kinds/content-reporting.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  PendingOutcomeNotice,
  ReportCaseRecord,
  ReportNoticeCaseReader,
  ReportNoticeStore,
  ReportNotifier,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
} from './ports.ts';
import { reportTargetKeyOf } from './report-target-resolver.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

export interface ReportNotifierEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

interface ClosedCase {
  readonly record: ReportCaseRecord;
  readonly outcome: ReportOutcomeInput['outcome'];
  readonly closedAt: Date;
  readonly reason: string;
}

type TargetInput = Pick<
  ReportOutcomeInput,
  'targetKind' | 'targetLabel' | 'excerpt'
>;

interface NoticeContent {
  readonly target: TargetInput;
  // 表示名の照会は匿名化したコメントの抜粋を空文字で返すため、それを投稿者の匿名化として投稿者へ送らない(11.5)
  readonly posterAnonymized: boolean;
  readonly reason: string;
  readonly decidedAt: string;
  readonly contactUrl: string;
}

type ReporterRecipient =
  | { readonly kind: 'member'; readonly userId: string }
  | { readonly kind: 'guest'; readonly email: string }
  | { readonly kind: 'none' };

interface ReporterGroup {
  readonly recipient: ReporterRecipient;
  // 通報のIDの昇順で、先頭が冪等のキーに使う最小のID
  readonly reportIds: readonly string[];
}

interface DispatchCount {
  readonly requested: number;
  readonly skipped: number;
}

const NOTHING: DispatchCount = Object.freeze({ requested: 0, skipped: 0 });

const REQUESTED_ONE: DispatchCount = Object.freeze({
  requested: 1,
  skipped: 0,
});

const SKIPPED_ONE: DispatchCount = Object.freeze({ requested: 0, skipped: 1 });

const addCount = (a: DispatchCount, b: DispatchCount): DispatchCount => ({
  requested: a.requested + b.requested,
  skipped: a.skipped + b.skipped,
});

const CONTACT_PATH = '/contact';

const EXCERPT_ELLIPSIS = '…';

const logger = getAppLogger(['api', 'application', 'reporting']);

const closedCaseOf = (
  record: ReportCaseRecord | undefined,
): ClosedCase | undefined => {
  if (
    record === undefined ||
    !isClosedStatus(record.status) ||
    record.closedAt === null
  ) {
    return undefined;
  }
  if (record.closingReason === null) {
    throw new Error(`理由の無い完了した案件は通知できません: ${record.caseId}`);
  }
  return {
    record,
    outcome: record.status === 'rejected' ? 'rejected' : 'resolved',
    closedAt: record.closedAt,
    reason: record.closingReason,
  };
};

// 冪等のキーは宛先・入力の値を含めず、完了から戻して再び完了したときに改めて送れるよう完了の日時を含める
const idempotencyKeyOf = (id: string, closedAt: Date): string =>
  `${id}:${String(closedAt.getTime())}`;

const recipientOf = (notice: PendingOutcomeNotice): ReporterRecipient => {
  if (notice.reporterUserId !== null) {
    return { kind: 'member', userId: notice.reporterUserId };
  }
  return notice.contactEmail === null
    ? { kind: 'none' }
    : { kind: 'guest', email: notice.contactEmail };
};

const groupKeyOf = (recipient: ReporterRecipient): string => {
  switch (recipient.kind) {
    case 'member': {
      return `member:${recipient.userId}`;
    }
    case 'guest': {
      return `guest:${toMatchingKey(recipient.email)}`;
    }
    case 'none': {
      return 'none';
    }
  }
};

const groupReporters = (
  notices: readonly PendingOutcomeNotice[],
): readonly ReporterGroup[] => {
  const groups = new Map<string, ReporterGroup>();
  for (const notice of notices) {
    const recipient = recipientOf(notice);
    const key = groupKeyOf(recipient);
    const group = groups.get(key);
    groups.set(key, {
      recipient: group?.recipient ?? recipient,
      reportIds: [...(group?.reportIds ?? []), notice.reportId],
    });
  }
  return [...groups.values()];
};

const noticeExcerptOf = (excerpt: string | null): string | null => {
  if (excerpt === null || excerpt === '') {
    return null;
  }
  return countGraphemes(excerpt) <= REPORT_NOTICE_EXCERPT_MAX
    ? excerpt
    : `${truncateGraphemes(excerpt, REPORT_NOTICE_EXCERPT_MAX - 1)}${EXCERPT_ELLIPSIS}`;
};

const targetInputOf = (
  key: ReportTargetKey,
  view: ReportTargetView | undefined,
): TargetInput => {
  if (view?.available !== true) {
    return { targetKind: key.kind, targetLabel: null, excerpt: null };
  }
  if (key.kind !== 'comment') {
    return { targetKind: key.kind, targetLabel: view.label, excerpt: null };
  }
  return {
    targetKind: key.kind,
    targetLabel: view.productName,
    excerpt: view.productName === null ? null : noticeExcerptOf(view.excerpt),
  };
};

@injectable()
export class EmailReportNotifier implements ReportNotifier {
  constructor(
    @inject(REPORTING_TYPES.ReportNoticeCaseReader)
    private readonly cases: ReportNoticeCaseReader,
    @inject(REPORTING_TYPES.ReportNoticeStore)
    private readonly notices: ReportNoticeStore,
    @inject(REPORTING_TYPES.ReportTargetResolver)
    private readonly targets: ReportTargetResolver,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(PLATFORM_TYPES.Env) private readonly env: ReportNotifierEnv,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async dispatch(caseId: string): Promise<DispatchCount> {
    const closed = closedCaseOf(await this.cases.findForNotice(caseId));
    if (closed === undefined) {
      return NOTHING;
    }
    const pending = await this.notices.listPendingOutcome(caseId);
    const posterPending =
      closed.outcome === 'rejected' &&
      (await this.notices.posterNoticePending(caseId));
    if (pending.length === 0 && !posterPending) {
      return NOTHING;
    }
    const content = await this.#contentOf(closed);
    const at = this.clock.now();
    let count = NOTHING;
    for (const group of groupReporters(pending)) {
      count = addCount(
        count,
        await this.#notifyReporters(closed, content, group, at),
      );
    }
    if (posterPending) {
      count = addCount(count, await this.#notifyPoster(closed, content, at));
    }
    logger.info('通報の当事者への通知を処理しました', { caseId, ...count });
    return count;
  }

  async #contentOf(closed: ClosedCase): Promise<NoticeContent> {
    const { record } = closed;
    const key: ReportTargetKey = {
      kind: record.targetKind,
      targetId: record.targetId,
      productId: record.productId,
    };
    const view = (await this.targets.describe([key])).get(
      reportTargetKeyOf(key),
    );
    return {
      target: targetInputOf(key, view),
      posterAnonymized:
        key.kind === 'comment' &&
        view?.available === true &&
        view.excerpt === '',
      reason: closed.reason,
      decidedAt: closed.closedAt.toISOString(),
      contactUrl: new URL(CONTACT_PATH, this.env.CLIENT_SITE_ORIGIN).href,
    };
  }

  async #notifyReporters(
    closed: ClosedCase,
    content: NoticeContent,
    group: ReporterGroup,
    at: Date,
  ): Promise<DispatchCount> {
    const destination = await this.#reporterDestinationOf(group.recipient);
    if (destination === undefined) {
      await this.notices.markOutcome(group.reportIds, 'skipped', at);
      // 連絡先の無い未ログインの通報は宛先を区別できないため、通報ごとに数える
      return group.recipient.kind === 'none'
        ? { requested: 0, skipped: group.reportIds.length }
        : SKIPPED_ONE;
    }
    const [firstReportId = ''] = group.reportIds;
    await this.emails.send({
      kind: REPORT_OUTCOME_EMAIL,
      to: destination.email,
      idempotencyKey: idempotencyKeyOf(firstReportId, closed.closedAt),
      input: {
        recipientName: destination.name,
        outcome: closed.outcome,
        ...content.target,
        reason: content.reason,
        decidedAt: content.decidedAt,
        contactUrl: content.contactUrl,
      },
    });
    await this.notices.markOutcome(group.reportIds, 'requested', at);
    return REQUESTED_ONE;
  }

  async #reporterDestinationOf(
    recipient: ReporterRecipient,
  ): Promise<
    { readonly email: string; readonly name: string | null } | undefined
  > {
    switch (recipient.kind) {
      case 'member': {
        const contact = await this.contacts.findContact(recipient.userId);
        return contact === undefined
          ? undefined
          : { email: contact.email, name: contact.nickname };
      }
      case 'guest': {
        return { email: recipient.email, name: null };
      }
      case 'none': {
        return undefined;
      }
    }
  }

  async #notifyPoster(
    closed: ClosedCase,
    content: NoticeContent,
    at: Date,
  ): Promise<DispatchCount> {
    const ownerUserId = closed.record.targetOwnerUserId;
    const contact =
      ownerUserId === null || content.posterAnonymized
        ? undefined
        : await this.contacts.findContact(ownerUserId);
    if (contact === undefined) {
      await this.notices.markPoster(closed.record.caseId, 'skipped', at);
      return SKIPPED_ONE;
    }
    await this.emails.send({
      kind: REPORT_REJECTION_TO_POSTER_EMAIL,
      to: contact.email,
      idempotencyKey: idempotencyKeyOf(closed.record.caseId, closed.closedAt),
      input: {
        nickname: contact.nickname,
        ...content.target,
        reason: content.reason,
        decidedAt: content.decidedAt,
        contactUrl: content.contactUrl,
      },
    });
    await this.notices.markPoster(closed.record.caseId, 'requested', at);
    return REQUESTED_ONE;
  }
}
