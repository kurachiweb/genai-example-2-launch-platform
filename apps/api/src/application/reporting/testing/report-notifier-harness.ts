import type {
  EmailSendRequest,
  EmailSender,
} from '../../../../lib/core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../../lib/core/identity/ports.ts';
import type {
  PendingOutcomeNotice,
  ReportCaseRecord,
  ReportNoticeCaseReader,
  ReportNoticeStore,
  ReportNotifier,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
} from '../ports.ts';
import { EmailReportNotifier } from '../report-notifier.ts';
import { reportTargetKeyOf } from '../report-target-resolver.ts';

export const NOW = new Date('2027-03-20T12:00:00.000Z');
export const CLOSED_AT = new Date('2027-03-20T11:30:00.123Z');
export const CLOSED_AT_ISO = '2027-03-20T11:30:00.123Z';
export const CONTACT_URL = 'https://client.example/contact';
export const CASE_ID = '01JQ0CAS000000000000000001';
export const OWNER_ID = '01JQ0USR000000000000000001';
export const MEMBER_A = '01JQ0USR000000000000000002';
export const MEMBER_B = '01JQ0USR000000000000000003';
export const PRODUCT_ID = '01JQ0PRD000000000000000001';
export const COMMENT_ID = '01JQ0CMT000000000000000001';
export const CLOSING_REASON = '利用規約に反する宣伝のため非公開にしました';
export const SEND_ERROR = new Error('メールの送信を依頼できませんでした');

export const reportIdOf = (n: number): string =>
  `01JQ0REP0000000000000000${String(n).padStart(2, '0')}`;

export const caseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord => ({
  caseId: CASE_ID,
  targetKind: 'product',
  targetId: PRODUCT_ID,
  targetDetachedAt: null,
  targetOwnerUserId: OWNER_ID,
  productId: PRODUCT_ID,
  status: 'resolved',
  statusChangedAt: CLOSED_AT,
  infringementReportedAt: null,
  closedAt: CLOSED_AT,
  resolution: 'product.hide',
  closingReason: CLOSING_REASON,
  lastInquiredAt: null,
  lastInquiryMessage: null,
  reportCount: 1,
  firstReportedAt: new Date('2027-03-19T00:00:00.000Z'),
  lastReportedAt: new Date('2027-03-19T01:00:00.000Z'),
  categoryCounts: [],
  ...overrides,
});

export const rejectedCaseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord =>
  caseOf({ status: 'rejected', resolution: null, ...overrides });

export const commentCaseOf = (
  overrides: Partial<ReportCaseRecord> = {},
): ReportCaseRecord =>
  caseOf({
    targetKind: 'comment',
    targetId: COMMENT_ID,
    resolution: 'comment.hide',
    ...overrides,
  });

export const member = (n: number, userId: string): PendingOutcomeNotice => ({
  reportId: reportIdOf(n),
  reporterUserId: userId,
  contactEmail: null,
});

export const guest = (
  n: number,
  contactEmail: string | null,
): PendingOutcomeNotice => ({
  reportId: reportIdOf(n),
  reporterUserId: null,
  contactEmail,
});

export const contactOf = (
  overrides: Partial<UserContact> = {},
): UserContact => ({
  userId: MEMBER_A,
  email: 'member-a@mail.example',
  nickname: '申出者A',
  emailVerified: true,
  ...overrides,
});

export const OWNER_CONTACT = contactOf({
  userId: OWNER_ID,
  email: 'owner@mail.example',
  nickname: '投稿者',
});

export const UNAVAILABLE_VIEW: ReportTargetView = {
  available: false,
  handle: null,
  label: null,
  excerpt: null,
  productName: null,
  productHandle: null,
};

export const PRODUCT_VIEW: ReportTargetView = {
  ...UNAVAILABLE_VIEW,
  available: true,
  handle: 'retro-board',
  label: 'レトロボード',
};

export const COMMENT_VIEW: ReportTargetView = {
  ...UNAVAILABLE_VIEW,
  available: true,
  excerpt: '宣伝のリンクばかりのコメントです',
  productName: 'レトロボード',
  productHandle: 'retro-board',
};

export interface NotifierScenario {
  readonly caseRecord?: ReportCaseRecord | undefined;
  readonly pending?: readonly PendingOutcomeNotice[];
  readonly posterPending?: boolean;
  readonly contacts?: readonly UserContact[];
  readonly view?: ReportTargetView | undefined;
  // 何通目の送信の依頼を失敗させるか(1始まり)
  readonly failSendAt?: number;
}

export interface OutcomeMark {
  readonly reportIds: readonly string[];
  readonly to: 'requested' | 'skipped';
  readonly at: Date;
}

export interface PosterMark {
  readonly caseId: string;
  readonly to: 'requested' | 'skipped';
  readonly at: Date;
}

export interface NotifierHarness {
  readonly notifier: ReportNotifier;
  readonly calls: string[];
  readonly sent: EmailSendRequest<unknown>[];
  readonly outcomeMarks: OutcomeMark[];
  readonly posterMarks: PosterMark[];
  readonly contactLookups: string[];
  readonly describedKeys: (readonly ReportTargetKey[])[];
}

const unused = (): never => {
  throw new Error('この試験では呼ばれない');
};

export async function caughtOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

interface Recorders {
  readonly calls: string[];
  readonly outcomeMarks: OutcomeMark[];
  readonly posterMarks: PosterMark[];
}

const caseStoreOf = (
  caseRecord: ReportCaseRecord | undefined,
  calls: string[],
): ReportNoticeCaseReader => ({
  findForNotice: (caseId) => {
    calls.push('findForNotice');
    return Promise.resolve(
      caseRecord?.caseId === caseId ? caseRecord : undefined,
    );
  },
});

const noticeStoreOf = (
  scenario: NotifierScenario,
  { calls, outcomeMarks, posterMarks }: Recorders,
): ReportNoticeStore => ({
  listPendingOutcome: () => {
    calls.push('listPendingOutcome');
    return Promise.resolve(scenario.pending ?? []);
  },
  markOutcome: (reportIds, to, at) => {
    calls.push(`markOutcome:${to}`);
    outcomeMarks.push({ reportIds, to, at });
    return Promise.resolve(reportIds.length);
  },
  markPoster: (caseId, to, at) => {
    calls.push(`markPoster:${to}`);
    posterMarks.push({ caseId, to, at });
    return Promise.resolve(true);
  },
  posterNoticePending: () => {
    calls.push('posterNoticePending');
    return Promise.resolve(scenario.posterPending ?? false);
  },
  listCasesWithPendingNotices: unused,
});

const resolverOf = (
  view: ReportTargetView | undefined,
  calls: string[],
  describedKeys: (readonly ReportTargetKey[])[],
): ReportTargetResolver => ({
  resolveForSubmission: unused,
  describe: (keys) => {
    calls.push('describe');
    describedKeys.push(keys);
    return Promise.resolve(
      new Map(
        view === undefined
          ? []
          : keys.map((key): [string, ReportTargetView] => [
              reportTargetKeyOf(key),
              view,
            ]),
      ),
    );
  },
});

const contactDirectoryOf = (
  contacts: readonly UserContact[],
  calls: string[],
  contactLookups: string[],
): UserContactDirectory => ({
  findContact: (userId) => {
    calls.push('findContact');
    contactLookups.push(userId);
    return Promise.resolve(
      contacts.find((contact) => contact.userId === userId),
    );
  },
});

const emailSenderOf = (
  failSendAt: number | undefined,
  calls: string[],
  sent: EmailSendRequest<unknown>[],
): EmailSender => {
  let attempts = 0;
  return {
    send: (request) => {
      calls.push('send');
      attempts += 1;
      if (failSendAt === attempts) {
        return Promise.reject(SEND_ERROR);
      }
      sent.push(request);
      return Promise.resolve(
        `01JQ0SND0000000000000000${String(attempts).padStart(2, '0')}`,
      );
    },
  };
};

export const setupNotifier = (
  scenario: NotifierScenario = {},
): NotifierHarness => {
  const calls: string[] = [];
  const sent: EmailSendRequest<unknown>[] = [];
  const outcomeMarks: OutcomeMark[] = [];
  const posterMarks: PosterMark[] = [];
  const contactLookups: string[] = [];
  const describedKeys: (readonly ReportTargetKey[])[] = [];
  const caseRecord = 'caseRecord' in scenario ? scenario.caseRecord : caseOf();
  const view = 'view' in scenario ? scenario.view : PRODUCT_VIEW;
  const notifier = new EmailReportNotifier(
    caseStoreOf(caseRecord, calls),
    noticeStoreOf(scenario, { calls, outcomeMarks, posterMarks }),
    resolverOf(view, calls, describedKeys),
    contactDirectoryOf(scenario.contacts ?? [], calls, contactLookups),
    emailSenderOf(scenario.failSendAt, calls, sent),
    { CLIENT_SITE_ORIGIN: 'https://client.example' },
    { now: () => NOW },
  );
  return {
    notifier,
    calls,
    sent,
    outcomeMarks,
    posterMarks,
    contactLookups,
    describedKeys,
  };
};
