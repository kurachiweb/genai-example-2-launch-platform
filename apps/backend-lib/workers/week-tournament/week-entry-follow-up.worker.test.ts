import type { Event } from '@sentry/cloudflare';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { formatWeekPeriodLabel } from '../../../common-lib/tournament/week-period.ts';
import {
  TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
  type WeekEntryRefundEmailInput,
} from '../../core/email/kinds/tournament-week.ts';
import type { EmailSender, EmailSendRequest } from '../../core/email/ports.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import type {
  PaymentRefunds,
  RefundRequestInput,
  RefundRequestResult,
} from '../../core/payments/ports.ts';
import { D1UserContactDirectory } from '../identity/d1-user-contact-directory.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_START,
  weekEntryIdOf,
  type WeekEntryFixture,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';
import { WeekEntryRefundFollowUp } from './week-entry-follow-up.ts';

const NOW = new Date('2026-11-25T12:21:00.000Z');

const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

const BILLING_URL = `${CLIENT_SITE_ORIGIN}/settings/billing`;

const FOLLOW_UP_CATEGORY = 'api.week-tournament.follow-up';

const SECOND_WEEK_START = '2026-11-09';

const store = new D1WeekTournamentStore(db);

function purchaseIdOf(index: number): string {
  return `01JD0PVRCHASE${String(index).padStart(13, '0')}`;
}

function refundRequestIdOf(index: number): string {
  return `01JD0REFVND${String(index).padStart(15, '0')}`;
}

type RefundAnswer = (input: RefundRequestInput) => Promise<RefundRequestResult>;

interface RecordingRefunds {
  readonly refunds: PaymentRefunds;
  readonly requests: RefundRequestInput[];
}

const notUsed = (): never => {
  throw new Error('この操作は使わない');
};

const acceptAll: RefundAnswer = () =>
  Promise.resolve({
    kind: 'accepted',
    refundRequestId: refundRequestIdOf(1),
    duplicate: false,
  });

function createRefunds(answer: RefundAnswer = acceptAll): RecordingRefunds {
  const requests: RefundRequestInput[] = [];
  return {
    requests,
    refunds: {
      request: (input) => {
        requests.push(input);
        return answer(input);
      },
      dispatch: notUsed,
      redispatch: notUsed,
    },
  };
}

interface RecordingSender {
  readonly sender: EmailSender;
  readonly sent: EmailSendRequest<unknown>[];
}

// 実際の送信要求と同じく、入力が種別の検証規則に合わなければ拒否する
function createSender(failure?: Error): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  return {
    sent,
    sender: {
      send: <TInput>(request: EmailSendRequest<TInput>) => {
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        request.kind.inputSchema.parse(request.input);
        sent.push(request);
        return Promise.resolve(
          `01JC0EMA11${String(sent.length).padStart(16, '0')}`,
        );
      },
    },
  };
}

// 週ごとの読み取りを繰り返すことを少ない枠で確かめるため、読み取りの上限を小さくする
const READ_LIMIT = 3;

function createFollowUp(
  refunds: PaymentRefunds,
  sender: EmailSender,
): WeekEntryRefundFollowUp {
  return new WeekEntryRefundFollowUp({
    appName: 'api',
    store,
    refunds,
    contacts: new D1UserContactDirectory(db),
    emails: sender,
    clientSiteOrigin: CLIENT_SITE_ORIGIN,
    readLimit: READ_LIMIT,
  });
}

const FORFEITED = {
  status: 'forfeited',
  closeReason: 'deleted',
  closedAt: T0,
  entitlementSource: 'payment',
  entitledAt: T0,
  refundStatus: 'pending',
} as const;

const EXCLUDED = {
  ...FORFEITED,
  status: 'excluded',
  closeReason: 'hidden_or_suspended',
} as const;

const NOTICE_PENDING = {
  refundStatus: 'requested',
  refundRequestedAt: T0,
  refundNoticeStatus: 'pending',
} as const;

function followUpEntryOf(
  index: number,
  columns: WeekEntryFixture['columns'] = {},
  { tournament = 1, owner = 1 }: { tournament?: number; owner?: number } = {},
): WeekEntryFixture {
  return {
    index,
    tournament,
    launch: index,
    product: index,
    owner,
    columns: { ...FORFEITED, purchaseId: purchaseIdOf(index), ...columns },
  };
}

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

async function readEntryRows() {
  return db
    .select()
    .from(weekTournamentEntries)
    .orderBy(asc(weekTournamentEntries.id));
}

async function pendingEntryIds(): Promise<string[]> {
  const records = await store.listPendingFollowUps(
    new Date(NOW.getTime() + 1),
    100,
  );
  return records.map(({ entryId }) => entryId);
}

function refundEmailOf(
  reason: WeekEntryRefundEmailInput['reason'],
  {
    weekStart = WEEK_START,
    owner = 1,
  }: { weekStart?: string; owner?: number } = {},
): EmailSendRequest<WeekEntryRefundEmailInput> {
  return {
    kind: TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
    to: emailOf(owner),
    input: {
      nickname: `利用者${String(owner)}`,
      weekLabel: formatWeekPeriodLabel(weekStart),
      launchDate: '2026-11-20',
      reason,
      billingUrl: BILLING_URL,
    },
  };
}

let logs: LogObject[] = [];
let events: Event[] = [];

function followUpLogs(): LogObject[] {
  return logs.filter(({ category }) => category === FOLLOW_UP_CATEGORY);
}

function incidentEvents(): Event[] {
  return events.filter(
    (event) => event.tags?.tournament_incident !== undefined,
  );
}

function expectNoPersonalData(): void {
  const recorded = JSON.stringify([logs, events]);
  for (const value of [emailOf(1), '利用者1', emailOf(2), '利用者2']) {
    expect(recorded).not.toContain(value);
  }
}

// 利用者1のプロダクト1〜8と利用者2のプロダクト9を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearWeekTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await insertProduct(index, index === 9 ? 2 : 1);
    await insertLaunch(index, index);
  }
  await insertWeekTournaments([
    { index: 1 },
    { index: 2, weekStart: SECOND_WEEK_START },
  ]);
});

afterEach(resetObservability);

describe('WeekEntryRefundFollowUp.process(返金の依頼)', () => {
  test.each([
    {
      label: '喪失',
      columns: FORFEITED,
      reason: 'entitlement_lost',
    },
    {
      label: '除外',
      columns: EXCLUDED,
      reason: 'entitlement_suspended',
    },
  ] as const)(
    '$labelの返金待ちの枠は、購入の全額の返金を理由と依頼キー付きで依頼し、依頼済みにして返金の知らせを送る',
    async ({ columns, reason }) => {
      await insertWeekEntries([followUpEntryOf(1, columns)]);
      const { refunds, requests } = createRefunds();
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

      expect(requests).toEqual([
        {
          purchaseId: purchaseIdOf(1),
          amount: null,
          reason,
          requestKey: `tournament-week:${purchaseIdOf(1)}:${reason}`,
        },
      ]);
      expect(sent).toEqual([refundEmailOf(reason)]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'requested',
        refundRequestedAt: NOW,
        refundNoticeStatus: 'sent',
        updatedAt: NOW,
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      expect(incidentEvents()).toEqual([]);
      expectNoPersonalData();
    },
  );

  test('同じ依頼キーの既存の依頼(重複)も受け付けとして依頼済みにし、返金の知らせを送る', async () => {
    await insertWeekEntries([followUpEntryOf(1)]);
    const { refunds } = createRefunds(() =>
      Promise.resolve({
        kind: 'accepted',
        refundRequestId: refundRequestIdOf(1),
        duplicate: true,
      }),
    );
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'sent',
    });
  });

  test('枠の週の期間と枠の投稿者の宛先で知らせる', async () => {
    await insertWeekEntries([
      followUpEntryOf(9, {}, { tournament: 2, owner: 2 }),
    ]);
    const { refunds } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(9)], NOW);

    expect(sent).toEqual([
      refundEmailOf('entitlement_lost', {
        weekStart: SECOND_WEEK_START,
        owner: 2,
      }),
    ]);
  });

  test.each(['not_paid', 'purchase_not_found'] as const)(
    '拒否(%s)は返金不要にし、知らせを送らず、購入の識別だけのerrorログを残してcaptureEventしない',
    async (code) => {
      await insertWeekEntries([followUpEntryOf(1)]);
      const { refunds } = createRefunds(() =>
        Promise.resolve({ kind: 'rejected', code }),
      );
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

      expect(sent).toEqual([]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'not_needed',
        refundRequestedAt: null,
        refundNoticeStatus: 'none',
        updatedAt: NOW,
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      const [log, ...otherLogs] = followUpLogs();
      expect(otherLogs).toEqual([]);
      expect(log?.level).toBe('error');
      expect(Object.keys(log ?? {}).sort()).toEqual([
        'category',
        'code',
        'level',
        'message',
        'purchaseId',
        'time',
      ]);
      expect(log).toMatchObject({ purchaseId: purchaseIdOf(1), code });
      expect(incidentEvents()).toEqual([]);
    },
  );

  test('返金できる残額が無い拒否は返金済みで依頼を終え、知らせを送らずrefund-already-settledをcaptureEventする', async () => {
    await insertWeekEntries([followUpEntryOf(1)]);
    const { refunds } = createRefunds(() =>
      Promise.resolve({ kind: 'rejected', code: 'amount_exceeds_refundable' }),
    );
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'already_refunded',
      refundNoticeStatus: 'none',
    });
    await expect(pendingEntryIds()).resolves.toEqual([]);
    const [log, ...otherLogs] = followUpLogs();
    expect(otherLogs).toEqual([]);
    expect(log?.level).toBe('warning');
    expect(log).toMatchObject({
      tournamentId: weekTournamentIdOf(1),
      entryId: weekEntryIdOf(1),
      purchaseId: purchaseIdOf(1),
      code: 'amount_exceeds_refundable',
    });
    const [event, ...otherEvents] = incidentEvents();
    expect(otherEvents).toEqual([]);
    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(log?.message);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual([
      'tournament',
      'refund-already-settled',
    ]);
    expect(event?.tags).toStrictEqual({
      tournament_incident: 'refund-already-settled',
      tournament_id: weekTournamentIdOf(1),
      entry_id: weekEntryIdOf(1),
    });
    expectNoPersonalData();
  });

  test.each([
    {
      label: '金額の形式の誤り',
      answer: () =>
        Promise.resolve({
          kind: 'rejected',
          code: 'invalid_amount',
        } as const),
      code: 'invalid_amount',
    },
    {
      label: '依頼キーの形式の誤り',
      answer: () =>
        Promise.resolve({
          kind: 'rejected',
          code: 'invalid_request_key',
        } as const),
      code: 'invalid_request_key',
    },
    {
      label: '理由の形式違反の例外',
      answer: () => Promise.reject(new RangeError('返金の理由の形式違反')),
      code: 'invalid_reason',
    },
  ] satisfies readonly {
    label: string;
    answer: RefundAnswer;
    code: string;
  }[])(
    '$labelは拒否で依頼を終え、知らせを送らずrefund-rejectedをcaptureEventする',
    async ({ answer, code }) => {
      await insertWeekEntries([followUpEntryOf(1)]);
      const { refunds } = createRefunds(answer);
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

      expect(sent).toEqual([]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'rejected',
        refundNoticeStatus: 'none',
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      const [log, ...otherLogs] = followUpLogs();
      expect(otherLogs).toEqual([]);
      expect(log?.level).toBe('error');
      expect(log).toMatchObject({
        tournamentId: weekTournamentIdOf(1),
        entryId: weekEntryIdOf(1),
        purchaseId: purchaseIdOf(1),
        code,
      });
      const [event, ...otherEvents] = incidentEvents();
      expect(otherEvents).toEqual([]);
      expect(event?.level).toBe('error');
      expect(event?.logentry?.message).toBe(log?.message);
      expect(event?.fingerprint).toEqual(['tournament', 'refund-rejected']);
      expect(event?.tags).toStrictEqual({
        tournament_incident: 'refund-rejected',
        tournament_id: weekTournamentIdOf(1),
        entry_id: weekEntryIdOf(1),
      });
    },
  );

  test('購入の記録が無い返金待ちの枠は依頼をせずに返金不要で終える', async () => {
    await insertWeekEntries([
      followUpEntryOf(1, { entitlementSource: 'ultras', purchaseId: null }),
    ]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(requests).toEqual([]);
    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'not_needed',
      refundNoticeStatus: 'none',
    });
    expect(followUpLogs()).toEqual([
      expect.objectContaining({ level: 'error', entryId: weekEntryIdOf(1) }),
    ]);
  });

  test('返金の依頼の一時的な失敗は例外にし、枠を返金待ちのまま変えない', async () => {
    await insertWeekEntries([followUpEntryOf(1)]);
    const before = await readEntryRow(1);
    const { refunds } = createRefunds(() =>
      Promise.reject(new Error('Stripeの一時的な失敗')),
    );
    const { sender, sent } = createSender();

    await expect(
      createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW),
    ).rejects.toThrow('Stripeの一時的な失敗');

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toEqual(before);
    expect(incidentEvents()).toEqual([]);
  });
});

describe('WeekEntryRefundFollowUp.process(返金の知らせ)', () => {
  test('知らせ待ちの枠は依頼をせずに返金の知らせだけを送り、送信済みにする', async () => {
    await insertWeekEntries([followUpEntryOf(1, NOTICE_PENDING)]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(requests).toEqual([]);
    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundRequestedAt: T0,
      refundNoticeStatus: 'sent',
      updatedAt: NOW,
    });
  });

  test('退会済みの投稿者には送らず省略にする', async () => {
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, userIdOf(1)));
    await insertWeekEntries([followUpEntryOf(1)]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'skipped',
    });
    await expect(pendingEntryIds()).resolves.toEqual([]);
  });

  test('投稿者の紐付けを解除した枠には送らず省略にする', async () => {
    await insertWeekEntries([
      { ...followUpEntryOf(1, NOTICE_PENDING), owner: null },
    ]);
    const { refunds } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundNoticeStatus: 'skipped',
    });
  });

  test('送信の一時的な失敗は例外にし、知らせ待ちのまま変えない', async () => {
    await insertWeekEntries([followUpEntryOf(1, NOTICE_PENDING)]);
    const before = await readEntryRow(1);
    const { refunds } = createRefunds();
    const { sender } = createSender(new Error('Queueの一時的な失敗'));

    await expect(
      createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW),
    ).rejects.toThrow('Queueの一時的な失敗');

    await expect(readEntryRow(1)).resolves.toEqual(before);
  });

  test('依頼の後の送信の失敗は依頼済み・知らせ待ちで残し、次の処理で依頼し直さずに知らせだけを送る', async () => {
    await insertWeekEntries([followUpEntryOf(1)]);
    const { refunds, requests } = createRefunds();
    const failing = createSender(new Error('Queueの一時的な失敗'));

    await expect(
      createFollowUp(refunds, failing.sender).process([weekEntryIdOf(1)], NOW),
    ).rejects.toThrow('Queueの一時的な失敗');
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'pending',
    });

    const { sender, sent } = createSender();
    await createFollowUp(refunds, sender).process([weekEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundNoticeStatus: 'sent',
    });
  });
});

describe('WeekEntryRefundFollowUp.process(対象)', () => {
  test('返金待ち・知らせ待ちでない枠と存在しない枠は何もしない', async () => {
    await insertWeekEntries([
      followUpEntryOf(1, { refundStatus: 'not_needed' }),
      followUpEntryOf(2, { refundStatus: 'already_refunded' }),
      followUpEntryOf(3, { refundStatus: 'rejected' }),
      followUpEntryOf(4, {
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(5, {
        refundStatus: 'requested',
        refundNoticeStatus: 'skipped',
      }),
    ]);
    const before = await readEntryRows();
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process(
      [1, 2, 3, 4, 5, 6].map(weekEntryIdOf),
      NOW,
    );

    expect(requests).toEqual([]);
    expect(sent).toEqual([]);
    await expect(readEntryRows()).resolves.toEqual(before);
  });

  test('失敗した枠があっても残りの枠を処理してから例外にする', async () => {
    await insertWeekEntries([followUpEntryOf(1), followUpEntryOf(2)]);
    const { refunds, requests } = createRefunds((input) =>
      input.purchaseId === purchaseIdOf(1)
        ? Promise.reject(new Error('Stripeの一時的な失敗'))
        : acceptAll(input),
    );
    const { sender, sent } = createSender();

    await expect(
      createFollowUp(refunds, sender).process(
        [weekEntryIdOf(1), weekEntryIdOf(2)],
        NOW,
      ),
    ).rejects.toThrow('Stripeの一時的な失敗');

    expect(requests).toHaveLength(2);
    expect(sent).toHaveLength(1);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'pending',
    });
    await expect(readEntryRow(2)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'sent',
    });
  });
});

describe('WeekEntryRefundFollowUp.processTournament', () => {
  test('その週の返金待ち・知らせ待ちの枠だけを、読み取りの上限を超えても全て処理する', async () => {
    const indexes = [1, 2, 3, 4, 5, 6, 7, 8];
    await insertWeekEntries([
      ...indexes.map((index) =>
        followUpEntryOf(index, index % 2 === 0 ? NOTICE_PENDING : {}),
      ),
      followUpEntryOf(9, {}, { tournament: 2, owner: 2 }),
    ]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).processTournament(
      weekTournamentIdOf(1),
      NOW,
    );

    expect(requests.map(({ purchaseId }) => purchaseId)).toEqual(
      [1, 3, 5, 7].map(purchaseIdOf),
    );
    expect(sent).toHaveLength(8);
    await expect(pendingEntryIds()).resolves.toEqual([weekEntryIdOf(9)]);
  });

  test('依頼に失敗して返金待ちに残る枠で繰り返さず、残りの枠を処理してから例外にする', async () => {
    await insertWeekEntries([followUpEntryOf(1), followUpEntryOf(2)]);
    const { refunds, requests } = createRefunds((input) =>
      input.purchaseId === purchaseIdOf(1)
        ? Promise.reject(new Error('Stripeの一時的な失敗'))
        : acceptAll(input),
    );
    const { sender } = createSender();

    await expect(
      createFollowUp(refunds, sender).processTournament(
        weekTournamentIdOf(1),
        NOW,
      ),
    ).rejects.toThrow('Stripeの一時的な失敗');

    expect(requests.map(({ purchaseId }) => purchaseId)).toEqual([
      purchaseIdOf(1),
      purchaseIdOf(2),
    ]);
    await expect(pendingEntryIds()).resolves.toEqual([weekEntryIdOf(1)]);
  });

  test('拒否で依頼を終えた枠は処理の対象から外れ、もう一度呼んでも依頼しない', async () => {
    await insertWeekEntries([followUpEntryOf(1)]);
    const { refunds, requests } = createRefunds(() =>
      Promise.resolve({ kind: 'rejected', code: 'amount_exceeds_refundable' }),
    );
    const { sender, sent } = createSender();
    const followUp = createFollowUp(refunds, sender);

    await followUp.processTournament(weekTournamentIdOf(1), NOW);
    await followUp.processTournament(weekTournamentIdOf(1), NOW);
    await followUp.process([weekEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(incidentEvents()).toHaveLength(1);
  });
});
