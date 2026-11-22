import { describe, expect, test } from 'bun:test';

import {
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
} from '../../../lib/core/email/kinds/content-reporting.ts';
import type { ReportCaseRecord } from './ports.ts';
import {
  CASE_ID,
  caughtOf,
  CLOSED_AT,
  CLOSED_AT_ISO,
  CLOSING_REASON,
  COMMENT_ID,
  COMMENT_VIEW,
  CONTACT_URL,
  contactOf,
  guest,
  MEMBER_A,
  member,
  NOW,
  OWNER_CONTACT,
  OWNER_ID,
  rejectedCaseOf,
  reportIdOf,
  SEND_ERROR,
  setupNotifier,
  UNAVAILABLE_VIEW,
} from './testing/report-notifier-harness.ts';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,40}$/u;

const rejectedCommentCase = rejectedCaseOf({
  targetKind: 'comment',
  targetId: COMMENT_ID,
});

describe('EmailReportNotifier 却下の投稿者への通知', () => {
  test('却下で投稿者への通知が依頼待ちなら、投稿者の宛先を連絡先の照会で引いて送り、送信の後に依頼済みにする', async () => {
    const { notifier, sent, posterMarks, calls, contactLookups } =
      setupNotifier({
        caseRecord: rejectedCaseOf(),
        posterPending: true,
        contacts: [OWNER_CONTACT],
      });

    const result = await notifier.dispatch(CASE_ID);

    expect(result).toEqual({ requested: 1, skipped: 0 });
    expect(contactLookups).toEqual([OWNER_ID]);
    expect(sent).toEqual([
      {
        kind: REPORT_REJECTION_TO_POSTER_EMAIL,
        to: 'owner@mail.example',
        idempotencyKey: `${CASE_ID}:${String(CLOSED_AT.getTime())}`,
        input: {
          nickname: '投稿者',
          targetKind: 'product',
          targetLabel: 'レトロボード',
          excerpt: null,
          reason: CLOSING_REASON,
          decidedAt: CLOSED_AT_ISO,
          contactUrl: CONTACT_URL,
        },
      },
    ]);
    expect(posterMarks).toEqual([
      { caseId: CASE_ID, to: 'requested', at: NOW },
    ]);
    expect(calls.slice(-3)).toEqual([
      'findContact',
      'send',
      'markPoster:requested',
    ]);
  });

  test('申出者が全員退会して全ての通報が論理削除された却下の案件でも、申出者を退会済みとして送らない記録にし、利用中の投稿者へ1通依頼する', async () => {
    const { notifier, sent, outcomeMarks, posterMarks } = setupNotifier({
      caseRecord: rejectedCaseOf({ reportCount: 0, categoryCounts: [] }),
      pending: [member(1, MEMBER_A)],
      posterPending: true,
      contacts: [OWNER_CONTACT],
    });

    const result = await notifier.dispatch(CASE_ID);

    expect(result).toEqual({ requested: 1, skipped: 1 });
    expect(outcomeMarks).toEqual([
      { reportIds: [reportIdOf(1)], to: 'skipped', at: NOW },
    ]);
    expect(
      sent.map(({ kind, to, idempotencyKey }) => ({
        kind,
        to,
        idempotencyKey,
      })),
    ).toEqual([
      {
        kind: REPORT_REJECTION_TO_POSTER_EMAIL,
        to: 'owner@mail.example',
        idempotencyKey: `${CASE_ID}:${String(CLOSED_AT.getTime())}`,
      },
    ]);
    expect(posterMarks).toEqual([
      { caseId: CASE_ID, to: 'requested', at: NOW },
    ]);
  });

  test('申出者へ送った後に投稿者へ送り、投稿者への入力に申出者の情報を含めない', async () => {
    const { notifier, sent } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      pending: [member(1, MEMBER_A), guest(2, 'guest@mail.example')],
      posterPending: true,
      contacts: [contactOf(), OWNER_CONTACT],
    });

    await notifier.dispatch(CASE_ID);

    expect(sent.map(({ kind }) => kind)).toEqual([
      REPORT_OUTCOME_EMAIL,
      REPORT_OUTCOME_EMAIL,
      REPORT_REJECTION_TO_POSTER_EMAIL,
    ]);
    const posterInput = JSON.stringify(sent[2]?.input);
    for (const value of [
      '申出者A',
      'member-a@mail.example',
      'guest@mail.example',
      MEMBER_A,
      reportIdOf(1),
      reportIdOf(2),
    ]) {
      expect(posterInput).not.toContain(value);
    }
    expect(Object.keys(sent[2]?.input as object).sort()).toEqual([
      'contactUrl',
      'decidedAt',
      'excerpt',
      'nickname',
      'reason',
      'targetKind',
      'targetLabel',
    ]);
  });

  test('対応済では投稿者への通知の状態を読まず、投稿者へ送らない', async () => {
    const { notifier, sent, calls, posterMarks } = setupNotifier({
      posterPending: true,
      contacts: [OWNER_CONTACT],
    });

    expect(await notifier.dispatch(CASE_ID)).toEqual({
      requested: 0,
      skipped: 0,
    });
    expect(sent).toEqual([]);
    expect(posterMarks).toEqual([]);
    expect(calls).not.toContain('posterNoticePending');
  });

  test('投稿者への通知が依頼待ちでなければ投稿者へ送らない', async () => {
    const { notifier, sent, posterMarks, calls } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      posterPending: false,
      contacts: [OWNER_CONTACT],
    });

    expect(await notifier.dispatch(CASE_ID)).toEqual({
      requested: 0,
      skipped: 0,
    });
    expect(sent).toEqual([]);
    expect(posterMarks).toEqual([]);
    expect(calls).not.toContain('describe');
  });

  test('退会済み・物理削除済みで連絡先が引けない投稿者、対象への参照を消した案件、匿名化されたコメントの投稿者には送らずに送らなかった記録にする', async () => {
    const withdrawn = setupNotifier({
      caseRecord: rejectedCaseOf(),
      posterPending: true,
      contacts: [],
    });
    const detached = setupNotifier({
      caseRecord: rejectedCaseOf({
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        targetDetachedAt: CLOSED_AT,
      }),
      posterPending: true,
      contacts: [OWNER_CONTACT],
    });
    const anonymized = setupNotifier({
      caseRecord: rejectedCommentCase,
      posterPending: true,
      contacts: [OWNER_CONTACT],
      view: { ...COMMENT_VIEW, anonymized: true },
    });

    for (const harness of [withdrawn, detached, anonymized]) {
      expect(await harness.notifier.dispatch(CASE_ID)).toEqual({
        requested: 0,
        skipped: 1,
      });
      expect(harness.sent).toEqual([]);
      expect(harness.posterMarks).toEqual([
        { caseId: CASE_ID, to: 'skipped', at: NOW },
      ]);
    }
    expect(detached.contactLookups).toEqual([]);
  });

  test('停止中の投稿者にも送る', async () => {
    const { notifier, sent } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      posterPending: true,
      contacts: [{ ...OWNER_CONTACT, emailVerified: false }],
    });

    await notifier.dispatch(CASE_ID);

    expect(sent.map(({ to }) => to)).toEqual(['owner@mail.example']);
  });

  test('投稿者への送信の失敗では例外を投げ、投稿者への通知を依頼待ちのまま残す', async () => {
    const { notifier, posterMarks } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      posterPending: true,
      contacts: [OWNER_CONTACT],
      failSendAt: 1,
    });

    expect(await caughtOf(notifier.dispatch(CASE_ID))).toBe(SEND_ERROR);
    expect(posterMarks).toEqual([]);
  });

  test('対象が引けないときは対象の表示と抜粋をnullにして送る', async () => {
    const { notifier, sent } = setupNotifier({
      caseRecord: rejectedCommentCase,
      posterPending: true,
      contacts: [OWNER_CONTACT],
      view: UNAVAILABLE_VIEW,
    });

    await notifier.dispatch(CASE_ID);

    expect(sent[0]?.input).toMatchObject({
      targetKind: 'comment',
      targetLabel: null,
      excerpt: null,
    });
  });
});

describe('EmailReportNotifier 送信の依頼の冪等のキー', () => {
  const pending = [
    guest(3, 'guest@mail.example'),
    member(5, MEMBER_A),
    guest(7, 'GUEST@mail.example'),
  ];

  const keysOf = async (caseRecord: ReportCaseRecord) => {
    const { notifier, sent } = setupNotifier({
      caseRecord,
      pending,
      posterPending: true,
      contacts: [contactOf(), OWNER_CONTACT],
    });
    await notifier.dispatch(CASE_ID);
    return sent.map((request) => ({
      kind: request.kind.name,
      key: request.idempotencyKey,
    }));
  };

  test('申出者への結果は宛先のまとまりの通報のIDの最小と完了の日時のミリ秒、却下の投稿者への通知は案件のIDと完了の日時のミリ秒にする', async () => {
    const ms = String(CLOSED_AT.getTime());

    expect(await keysOf(rejectedCaseOf())).toEqual([
      {
        kind: 'content-reporting.report-outcome',
        key: `${reportIdOf(3)}:${ms}`,
      },
      {
        kind: 'content-reporting.report-outcome',
        key: `${reportIdOf(5)}:${ms}`,
      },
      {
        kind: 'content-reporting.rejection-to-poster',
        key: `${CASE_ID}:${ms}`,
      },
    ]);
  });

  test('送り直しでも同じキーにする', async () => {
    expect(await keysOf(rejectedCaseOf())).toEqual(
      await keysOf(rejectedCaseOf()),
    );
  });

  test('完了から戻して再び完了すると、完了の日時が変わるためキーが変わる', async () => {
    const reclosedAt = new Date('2027-03-21T08:00:00.000Z');
    const first = await keysOf(rejectedCaseOf());
    const reclosed = await keysOf(rejectedCaseOf({ closedAt: reclosedAt }));

    const ms = String(reclosedAt.getTime());
    expect(reclosed.map(({ key }) => key)).toEqual([
      `${reportIdOf(3)}:${ms}`,
      `${reportIdOf(5)}:${ms}`,
      `${CASE_ID}:${ms}`,
    ]);
    for (const [index, entry] of reclosed.entries()) {
      expect(entry.key).not.toBe(first[index]?.key);
    }
  });

  test('キーは[A-Za-z0-9_.:-]の40文字以内で、宛先・連絡先・入力の値を含まない', async () => {
    const { notifier, sent } = setupNotifier({
      caseRecord: rejectedCommentCase,
      pending,
      posterPending: true,
      contacts: [contactOf(), OWNER_CONTACT],
      view: COMMENT_VIEW,
    });

    await notifier.dispatch(CASE_ID);

    expect(sent).toHaveLength(3);
    for (const request of sent) {
      const key = request.idempotencyKey ?? '';
      expect(key).toMatch(KEY_PATTERN);
      expect(key).not.toContain(request.to);
      expect(key.toLowerCase()).not.toContain('mail.example');
      for (const value of Object.values(request.input as object)) {
        if (typeof value === 'string' && value !== '') {
          expect(key).not.toContain(value);
        }
      }
    }
  });
});
