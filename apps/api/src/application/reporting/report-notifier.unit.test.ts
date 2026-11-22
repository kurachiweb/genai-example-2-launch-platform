import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { REPORT_OUTCOME_EMAIL } from '../../../lib/core/email/kinds/content-reporting.ts';
import {
  CASE_ID,
  caseOf,
  caughtOf,
  CLOSED_AT,
  CLOSED_AT_ISO,
  CLOSING_REASON,
  COMMENT_ID,
  COMMENT_VIEW,
  commentCaseOf,
  CONTACT_URL,
  contactOf,
  guest,
  MEMBER_A,
  MEMBER_B,
  member,
  NOW,
  OWNER_CONTACT,
  OWNER_ID,
  PRODUCT_ID,
  PRODUCT_VIEW,
  rejectedCaseOf,
  reportIdOf,
  SEND_ERROR,
  setupNotifier,
  UNAVAILABLE_VIEW,
} from './testing/report-notifier-harness.ts';

const outcomeInputOf = (overrides: Record<string, unknown> = {}) => ({
  recipientName: null,
  outcome: 'resolved',
  targetKind: 'product',
  targetLabel: 'レトロボード',
  excerpt: null,
  reason: CLOSING_REASON,
  decidedAt: CLOSED_AT_ISO,
  contactUrl: CONTACT_URL,
  ...overrides,
});

const keyOf = (reportId: string): string =>
  `${reportId}:${String(CLOSED_AT.getTime())}`;

describe('EmailReportNotifier 申出者への結果', () => {
  test('ログイン中の申出者は利用者ごと、未ログインの申出者は連絡先の照合キーごとにまとめて1通ずつ送る', async () => {
    const { notifier, sent, outcomeMarks, contactLookups } = setupNotifier({
      pending: [
        member(1, MEMBER_A),
        guest(2, 'Guest@Mail.example'),
        member(3, MEMBER_B),
        member(4, MEMBER_A),
        guest(5, ' guest@mail.EXAMPLE '),
      ],
      contacts: [
        contactOf(),
        contactOf({
          userId: MEMBER_B,
          email: 'member-b@mail.example',
          nickname: '申出者B',
        }),
      ],
    });

    const result = await notifier.dispatch(CASE_ID);

    expect(result).toEqual({ requested: 3, skipped: 0 });
    expect(contactLookups).toEqual([MEMBER_A, MEMBER_B]);
    expect(sent.map(({ to }) => to)).toEqual([
      'member-a@mail.example',
      'Guest@Mail.example',
      'member-b@mail.example',
    ]);
    expect(outcomeMarks).toEqual([
      { reportIds: [reportIdOf(1), reportIdOf(4)], to: 'requested', at: NOW },
      { reportIds: [reportIdOf(2), reportIdOf(5)], to: 'requested', at: NOW },
      { reportIds: [reportIdOf(3)], to: 'requested', at: NOW },
    ]);
  });

  test('ログイン中の申出者の宛先とニックネームを連絡先の照会で引き、未ログインの申出者は宛名を省く', async () => {
    const { notifier, sent } = setupNotifier({
      pending: [member(1, MEMBER_A), guest(2, 'guest@mail.example')],
      contacts: [contactOf()],
    });

    await notifier.dispatch(CASE_ID);

    expect(sent).toEqual([
      {
        kind: REPORT_OUTCOME_EMAIL,
        to: 'member-a@mail.example',
        idempotencyKey: keyOf(reportIdOf(1)),
        input: outcomeInputOf({ recipientName: '申出者A' }),
      },
      {
        kind: REPORT_OUTCOME_EMAIL,
        to: 'guest@mail.example',
        idempotencyKey: keyOf(reportIdOf(2)),
        input: outcomeInputOf(),
      },
    ]);
  });

  test('停止中の利用者も連絡先の照会が返すため、そのまま送る', async () => {
    const { notifier, sent } = setupNotifier({
      pending: [member(1, MEMBER_A)],
      contacts: [contactOf({ emailVerified: false })],
    });

    expect(await notifier.dispatch(CASE_ID)).toEqual({
      requested: 1,
      skipped: 0,
    });
    expect(sent.map(({ to }) => to)).toEqual(['member-a@mail.example']);
  });

  test('退会済み・物理削除済みで連絡先が引けない申出者と、連絡先の無い未ログインの通報は、送らずに送らなかった記録にする', async () => {
    const { notifier, sent, outcomeMarks } = setupNotifier({
      pending: [
        member(1, MEMBER_A),
        guest(2, null),
        guest(3, null),
        guest(4, 'guest@mail.example'),
      ],
      contacts: [],
    });

    const result = await notifier.dispatch(CASE_ID);

    expect(result).toEqual({ requested: 1, skipped: 3 });
    expect(sent.map(({ to }) => to)).toEqual(['guest@mail.example']);
    expect(outcomeMarks).toEqual([
      { reportIds: [reportIdOf(1)], to: 'skipped', at: NOW },
      { reportIds: [reportIdOf(2), reportIdOf(3)], to: 'skipped', at: NOW },
      { reportIds: [reportIdOf(4)], to: 'requested', at: NOW },
    ]);
  });

  test('却下では申出者へ却下の旨を送る', async () => {
    const { notifier, sent } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      pending: [guest(1, 'guest@mail.example')],
    });

    await notifier.dispatch(CASE_ID);

    expect(sent[0]?.input).toEqual(outcomeInputOf({ outcome: 'rejected' }));
  });

  test('対象の表示はユーザーをニックネーム、コメントを対象のプロダクトの名称と抜粋にする', async () => {
    const user = setupNotifier({
      caseRecord: caseOf({
        targetKind: 'user',
        targetId: OWNER_ID,
        productId: null,
        resolution: 'user.suspend',
      }),
      pending: [guest(1, 'guest@mail.example')],
      view: { ...PRODUCT_VIEW, handle: 'owner', label: '投稿者' },
    });
    const comment = setupNotifier({
      caseRecord: commentCaseOf(),
      pending: [guest(1, 'guest@mail.example')],
      view: COMMENT_VIEW,
    });

    await user.notifier.dispatch(CASE_ID);
    await comment.notifier.dispatch(CASE_ID);

    expect(user.sent[0]?.input).toMatchObject({
      targetKind: 'user',
      targetLabel: '投稿者',
      excerpt: null,
    });
    expect(comment.sent[0]?.input).toMatchObject({
      targetKind: 'comment',
      targetLabel: 'レトロボード',
      excerpt: '宣伝のリンクばかりのコメントです',
    });
  });

  test('コメント以外の対象には抜粋を渡さない', async () => {
    const { notifier, sent } = setupNotifier({
      pending: [guest(1, 'guest@mail.example')],
      view: { ...PRODUCT_VIEW, excerpt: '使われない抜粋' },
    });

    await notifier.dispatch(CASE_ID);

    expect(sent[0]?.input).toMatchObject({ excerpt: null });
  });

  test('コメントの抜粋は先頭100書記素にし、切ったときは「…」を含めて100書記素にする', async () => {
    const long = setupNotifier({
      caseRecord: commentCaseOf(),
      pending: [guest(1, 'guest@mail.example')],
      view: { ...COMMENT_VIEW, excerpt: '👍🏽'.repeat(150) },
    });
    const exact = setupNotifier({
      caseRecord: commentCaseOf(),
      pending: [guest(1, 'guest@mail.example')],
      view: { ...COMMENT_VIEW, excerpt: '👍🏽'.repeat(100) },
    });

    await long.notifier.dispatch(CASE_ID);
    await exact.notifier.dispatch(CASE_ID);

    const { excerpt } = long.sent[0]?.input as { readonly excerpt: string };
    expect(countGraphemes(excerpt)).toBe(100);
    expect(excerpt).toBe(`${'👍🏽'.repeat(99)}…`);
    expect(exact.sent[0]?.input).toMatchObject({
      excerpt: '👍🏽'.repeat(100),
    });
  });

  test('対象が引けない・対象の表示が無い・対象のプロダクトが引けないときは対象の表示と抜粋をnullにし、匿名化で本文の無いコメントは抜粋だけをnullにする', async () => {
    const pending = [guest(1, 'guest@mail.example')];
    const unavailable = setupNotifier({
      caseRecord: commentCaseOf(),
      pending,
      view: UNAVAILABLE_VIEW,
    });
    const missing = setupNotifier({ pending, view: undefined });
    const productless = setupNotifier({
      caseRecord: commentCaseOf(),
      pending,
      view: { ...COMMENT_VIEW, productName: null, productHandle: null },
    });
    const anonymized = setupNotifier({
      caseRecord: commentCaseOf(),
      pending,
      view: { ...COMMENT_VIEW, excerpt: '' },
    });

    for (const harness of [unavailable, missing, productless, anonymized]) {
      await harness.notifier.dispatch(CASE_ID);
    }

    expect(unavailable.sent[0]?.input).toMatchObject({
      targetKind: 'comment',
      targetLabel: null,
      excerpt: null,
    });
    expect(missing.sent[0]?.input).toMatchObject({
      targetLabel: null,
      excerpt: null,
    });
    expect(productless.sent[0]?.input).toMatchObject({
      targetLabel: null,
      excerpt: null,
    });
    expect(anonymized.sent[0]?.input).toMatchObject({
      targetLabel: 'レトロボード',
      excerpt: null,
    });
  });

  test('表示名の照会は案件の対象の鍵で1回だけ行う', async () => {
    const { notifier, describedKeys } = setupNotifier({
      caseRecord: rejectedCaseOf({
        targetKind: 'comment',
        targetId: COMMENT_ID,
      }),
      pending: [member(1, MEMBER_A), guest(2, 'guest@mail.example')],
      posterPending: true,
      contacts: [contactOf(), OWNER_CONTACT],
      view: COMMENT_VIEW,
    });

    await notifier.dispatch(CASE_ID);

    expect(describedKeys).toEqual([
      [{ kind: 'comment', targetId: COMMENT_ID, productId: PRODUCT_ID }],
    ]);
  });

  test('送信の成功の後だけ、その宛先の通報を依頼済みにする', async () => {
    const { notifier, calls } = setupNotifier({
      pending: [member(1, MEMBER_A), guest(2, 'guest@mail.example')],
      contacts: [contactOf()],
    });

    await notifier.dispatch(CASE_ID);

    expect(calls).toEqual([
      'find',
      'listPendingOutcome',
      'describe',
      'findContact',
      'send',
      'markOutcome:requested',
      'send',
      'markOutcome:requested',
    ]);
  });

  test('送信の失敗では例外を投げ、失敗した宛先と残りの宛先と投稿者を依頼待ちのまま残す', async () => {
    const { notifier, outcomeMarks, posterMarks } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      pending: [
        guest(1, 'first@mail.example'),
        guest(2, 'second@mail.example'),
        guest(3, 'third@mail.example'),
      ],
      posterPending: true,
      contacts: [OWNER_CONTACT],
      failSendAt: 2,
    });

    expect(await caughtOf(notifier.dispatch(CASE_ID))).toBe(SEND_ERROR);
    expect(outcomeMarks).toEqual([
      { reportIds: [reportIdOf(1)], to: 'requested', at: NOW },
    ]);
    expect(posterMarks).toEqual([]);
  });
});

describe('EmailReportNotifier 完了していない案件', () => {
  test.each([
    ['未対応', caseOf({ status: 'open', closedAt: null, resolution: null })],
    [
      '対応中',
      caseOf({ status: 'in_progress', closedAt: null, resolution: null }),
    ],
    ['存在しない', undefined],
  ])('%sの案件では何もしない', async (_label, caseRecord) => {
    const { notifier, calls } = setupNotifier({
      caseRecord,
      pending: [guest(1, 'guest@mail.example')],
      posterPending: true,
      contacts: [OWNER_CONTACT],
    });

    expect(await notifier.dispatch(CASE_ID)).toEqual({
      requested: 0,
      skipped: 0,
    });
    expect(calls).toEqual(['find']);
  });

  test('理由の無い完了した案件は送らずに例外を投げる', async () => {
    const { notifier, sent, outcomeMarks } = setupNotifier({
      caseRecord: caseOf({ closingReason: null }),
      pending: [guest(1, 'guest@mail.example')],
    });

    expect(await caughtOf(notifier.dispatch(CASE_ID))).toBeInstanceOf(Error);
    expect(sent).toEqual([]);
    expect(outcomeMarks).toEqual([]);
  });

  test('依頼待ちの通知が無ければ表示名を照会せずに何もしない', async () => {
    const { notifier, calls } = setupNotifier({
      caseRecord: rejectedCaseOf(),
      pending: [],
      posterPending: false,
    });

    expect(await notifier.dispatch(CASE_ID)).toEqual({
      requested: 0,
      skipped: 0,
    });
    expect(calls).toEqual([
      'find',
      'listPendingOutcome',
      'posterNoticePending',
    ]);
  });
});
