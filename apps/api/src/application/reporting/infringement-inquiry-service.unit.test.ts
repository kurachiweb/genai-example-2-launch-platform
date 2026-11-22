import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { REPORT_INFRINGEMENT_INQUIRY_EMAIL } from '../../../lib/core/email/kinds/content-reporting.ts';
import {
  EmailSendError,
  type EmailSender,
  type EmailSendRequest,
} from '../../../lib/core/email/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../lib/core/identity/ports.ts';
import { DefaultInfringementInquiryService } from './infringement-inquiry-service.ts';
import type {
  InfringementInquiryCommand,
  ReportCaseInquiryRecord,
  ReportCaseRecord,
  ReportCaseStore,
  ReportCaseWriter,
  ReportIncident,
  ReportIncidentContext,
  ReportIncidentReporter,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
} from './ports.ts';
import { reportTargetKeyOf } from './report-target-resolver.ts';

const CASE_ID = '01JF0000000000000000CASE01';
const OWNER_ID = '01JF000000000000000OWNER01';
const PRODUCT_ID = '01JF00000000000000PRODUCT1';
const COMMENT_ID = '01JF00000000000000COMMENT1';
const ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';
const SENT_AT = new Date('2027-04-01T09:00:00.000Z');
const DEADLINE = new Date('2027-04-08T09:00:00.000Z');
const CLIENT_SITE_ORIGIN = 'https://client.example';

const CONTACT: UserContact = Object.freeze({
  userId: OWNER_ID,
  email: 'owner@mail.example',
  nickname: '投稿者のニックネーム',
  emailVerified: true,
});

const PRODUCT_CASE: ReportCaseRecord = Object.freeze({
  caseId: CASE_ID,
  targetKind: 'product',
  targetId: PRODUCT_ID,
  targetDetachedAt: null,
  targetOwnerUserId: OWNER_ID,
  productId: PRODUCT_ID,
  status: 'in_progress',
  statusChangedAt: new Date('2027-03-30T00:00:00.000Z'),
  infringementReportedAt: new Date('2027-03-29T00:00:00.000Z'),
  closedAt: null,
  resolution: null,
  closingReason: null,
  lastInquiredAt: null,
  lastInquiryMessage: null,
  reportCount: 2,
  firstReportedAt: new Date('2027-03-29T00:00:00.000Z'),
  lastReportedAt: new Date('2027-03-30T00:00:00.000Z'),
  categoryCounts: [],
});

const USER_CASE: ReportCaseRecord = Object.freeze({
  ...PRODUCT_CASE,
  targetKind: 'user',
  targetId: OWNER_ID,
  productId: null,
});

const COMMENT_CASE: ReportCaseRecord = Object.freeze({
  ...PRODUCT_CASE,
  targetKind: 'comment',
  targetId: COMMENT_ID,
});

const UNAVAILABLE_VIEW: ReportTargetView = Object.freeze({
  available: false,
  handle: null,
  label: null,
  excerpt: null,
  productName: null,
  productHandle: null,
  anonymized: false,
});

const PRODUCT_VIEW: ReportTargetView = Object.freeze({
  ...UNAVAILABLE_VIEW,
  available: true,
  handle: 'retro-board',
  label: 'レトロボード',
});

const USER_VIEW: ReportTargetView = Object.freeze({
  ...UNAVAILABLE_VIEW,
  available: true,
  handle: 'owner_handle',
  label: '投稿者のニックネーム',
});

const COMMENT_VIEW: ReportTargetView = Object.freeze({
  ...UNAVAILABLE_VIEW,
  available: true,
  excerpt: 'このコメントは他者の文章を無断で転載しています。',
  productName: 'レトロボード',
  productHandle: 'retro-board',
});

const COMMAND: InfringementInquiryCommand = Object.freeze({
  caseId: CASE_ID,
  operator: { adminId: ADMIN_ID },
  at: SENT_AT,
  message:
    '  掲載の画像が第三者の著作物と申し出を受けています。\n事情をお知らせください。  ',
  reason: '  申出の内容の確認のため  ',
});

const TRIMMED_MESSAGE =
  '掲載の画像が第三者の著作物と申し出を受けています。\n事情をお知らせください。';

type RecordResult = Awaited<ReturnType<ReportCaseWriter['recordInquiry']>>;

interface FakeOptions {
  readonly caseRecord?: ReportCaseRecord | undefined;
  readonly view?: ReportTargetView;
  readonly contact?: UserContact | undefined;
  readonly sendError?: Error;
  readonly recordResult?: RecordResult;
  readonly recordError?: Error;
  readonly prepareError?: Error;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prepared: AuditEntryInput[] = [];
  const sent: EmailSendRequest<unknown>[] = [];
  const recorded: ReportCaseInquiryRecord[] = [];
  const describedKeys: (readonly ReportTargetKey[])[] = [];
  const contactLookups: string[] = [];
  const incidents: {
    readonly incident: ReportIncident;
    readonly context: ReportIncidentContext;
  }[] = [];
  const caseRecord =
    'caseRecord' in options ? options.caseRecord : PRODUCT_CASE;
  const contact = 'contact' in options ? options.contact : CONTACT;
  const unexpected = () =>
    Promise.reject(new Error('照会では呼ばれない想定です'));
  const cases: ReportCaseStore = {
    search: unexpected,
    find: (caseId) => {
      calls.push('find');
      return Promise.resolve(
        caseRecord?.caseId === caseId ? caseRecord : undefined,
      );
    },
    listReports: unexpected,
    countUnhandled: unexpected,
    productSummary: unexpected,
  };
  const writer: ReportCaseWriter = {
    changeStatus: unexpected,
    close: unexpected,
    recordInquiry: (input) => {
      calls.push('recordInquiry');
      recorded.push(input);
      if (options.recordError !== undefined) {
        return Promise.reject(options.recordError);
      }
      return Promise.resolve(options.recordResult ?? 'committed');
    },
  };
  const contacts: UserContactDirectory = {
    findContact: (userId) => {
      calls.push('findContact');
      contactLookups.push(userId);
      return Promise.resolve(contact);
    },
  };
  const targets: ReportTargetResolver = {
    resolveForSubmission: unexpected,
    describe: (keys) => {
      calls.push('describe');
      describedKeys.push(keys);
      const view =
        options.view ??
        { product: PRODUCT_VIEW, user: USER_VIEW, comment: COMMENT_VIEW }[
          caseRecord?.targetKind ?? 'product'
        ];
      return Promise.resolve(
        new Map(keys.map((key) => [reportTargetKeyOf(key), view])),
      );
    },
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。記録の検証そのものは監査ログのテストが確かめる
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('prepare');
      prepared.push(entry);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
      return Object.freeze({
        id: 'audit-1',
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'report',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      }) as PreparedAuditEntry;
    },
    record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
  };
  const emails: EmailSender = {
    send: (request) => {
      calls.push('send');
      sent.push(request);
      if (options.sendError !== undefined) {
        return Promise.reject(options.sendError);
      }
      return Promise.resolve('request-1');
    },
  };
  const incidentReporter: ReportIncidentReporter = {
    report: (incident, context) => {
      calls.push('report');
      incidents.push({ incident, context });
    },
  };
  const service = new DefaultInfringementInquiryService(
    cases,
    writer,
    targets,
    contacts,
    auditLog,
    emails,
    incidentReporter,
    { CLIENT_SITE_ORIGIN },
  );
  return {
    service,
    calls,
    prepared,
    sent,
    recorded,
    describedKeys,
    contactLookups,
    incidents,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('拒否される想定です');
    },
    (reason: unknown) => reason,
  );
}

async function appErrorOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await rejectionOf(promise);
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否される想定です', { cause: error });
  }
  return error;
}

const summaryOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
  details: error.details,
});

const NOT_APPLICABLE = {
  kind: 'unprocessable',
  code: 'report_inquiry_not_applicable',
  message: 'この案件では照会を送れません。',
  details: undefined,
} as const;

const STATE_CONFLICT = {
  kind: 'conflict',
  code: 'report_case_state_conflict',
  message:
    '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
  details: undefined,
} as const;

const CASE_NOT_FOUND = {
  kind: 'not_found',
  code: 'report_case_not_found',
  message: '通報の案件が見つかりません。',
  details: undefined,
} as const;

describe('DefaultInfringementInquiryService.send', () => {
  test('投稿者の登録メールアドレスへ、内容・対象の表示とURL・期限を載せた照会のメールを依頼し、送信の日時と期限を返す', async () => {
    const { service, sent, contactLookups } = setup();

    const result = await service.send(COMMAND);

    expect(result).toEqual({ sentAt: SENT_AT, deadline: DEADLINE });
    expect(contactLookups).toEqual([OWNER_ID]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe(REPORT_INFRINGEMENT_INQUIRY_EMAIL);
    expect(sent[0]?.to).toBe('owner@mail.example');
    expect(sent[0]?.input).toEqual({
      nickname: '投稿者のニックネーム',
      targetKind: 'product',
      targetLabel: 'レトロボード',
      excerpt: null,
      targetUrl: 'https://client.example/p/retro-board',
      message: TRIMMED_MESSAGE,
      sentAt: '2027-04-01T09:00:00.000Z',
      deadline: '2027-04-08T09:00:00.000Z',
      contactUrl: 'https://client.example/contact',
    });
    expect(
      REPORT_INFRINGEMENT_INQUIRY_EMAIL.inputSchema.safeParse(sent[0]?.input)
        .success,
    ).toBe(true);
  });

  test('照会は管理者がその都度送り送り直しのジョブが無いため、冪等のキーも送信期限も付けない', async () => {
    const { service, sent } = setup();

    await service.send(COMMAND);

    expect(sent[0]).not.toHaveProperty('idempotencyKey');
    expect(sent[0]).not.toHaveProperty('deadline');
  });

  test('申出者を特定できる情報と申出者の理由をメールに含めない', async () => {
    const { service, sent } = setup();

    await service.send(COMMAND);

    expect(Object.keys(sent[0]?.input as object).sort()).toEqual(
      [
        'contactUrl',
        'deadline',
        'excerpt',
        'message',
        'nickname',
        'sentAt',
        'targetKind',
        'targetLabel',
        'targetUrl',
      ].sort(),
    );
  });

  test('ユーザーの対象はニックネームを表示名にし、プロフィールのURLを載せる', async () => {
    const { service, sent } = setup({ caseRecord: USER_CASE });

    await service.send(COMMAND);

    expect(sent[0]?.input).toMatchObject({
      targetKind: 'user',
      targetLabel: '投稿者のニックネーム',
      excerpt: null,
      targetUrl: 'https://client.example/@owner_handle',
    });
  });

  test('コメントの対象は対象のプロダクトの名称を表示名にし、プロダクトのURLと抜粋を載せる', async () => {
    const { service, sent, describedKeys } = setup({
      caseRecord: COMMENT_CASE,
    });

    await service.send(COMMAND);

    expect(describedKeys).toEqual([
      [{ kind: 'comment', targetId: COMMENT_ID, productId: PRODUCT_ID }],
    ]);
    expect(sent[0]?.input).toMatchObject({
      targetKind: 'comment',
      targetLabel: 'レトロボード',
      excerpt: 'このコメントは他者の文章を無断で転載しています。',
      targetUrl: 'https://client.example/p/retro-board',
    });
  });

  test('100書記素を超えるコメントの抜粋は、99書記素で切って末尾に「…」を付け、合計100書記素にする', async () => {
    const { service, sent } = setup({
      caseRecord: COMMENT_CASE,
      view: { ...COMMENT_VIEW, excerpt: '👍🏽'.repeat(101) },
    });

    await service.send(COMMAND);

    const { excerpt } = sent[0]?.input as { readonly excerpt: string };
    expect(countGraphemes(excerpt)).toBe(100);
    expect(excerpt).toBe(`${'👍🏽'.repeat(99)}…`);
  });

  test('ちょうど100書記素のコメントの抜粋は、切らずに「…」も付けない', async () => {
    const { service, sent } = setup({
      caseRecord: COMMENT_CASE,
      view: { ...COMMENT_VIEW, excerpt: '👍🏽'.repeat(100) },
    });

    await service.send(COMMAND);

    expect(sent[0]?.input).toMatchObject({ excerpt: '👍🏽'.repeat(100) });
  });

  test('本文の無いコメントの抜粋は載せない', async () => {
    const { service, sent } = setup({
      caseRecord: COMMENT_CASE,
      view: { ...COMMENT_VIEW, excerpt: '' },
    });

    await service.send(COMMAND);

    expect(sent[0]?.input).toMatchObject({ excerpt: null });
  });

  test('送信の依頼の後に、送信の日時と内容と照会の監査ログを書き込みの単位のポートで記録する', async () => {
    const { service, calls, prepared, recorded } = setup();

    await service.send(COMMAND);

    expect(calls).toEqual([
      'find',
      'findContact',
      'describe',
      'prepare',
      'send',
      'recordInquiry',
    ]);
    expect(prepared).toEqual([
      {
        operatorAdminId: ADMIN_ID,
        action: 'report.inquire',
        targetIds: [CASE_ID],
        reason: '申出の内容の確認のため',
        occurredAt: SENT_AT,
      },
    ]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      caseId: CASE_ID,
      message: TRIMMED_MESSAGE,
      at: SENT_AT,
    });
    expect(recorded[0]?.audit).toMatchObject({
      id: 'audit-1',
      action: 'report.inquire',
    });
  });

  test.each([
    ['理由を省いた', undefined],
    ['空白だけの理由の', ' 　 '],
  ] as const)('%s照会は監査ログに理由を残さない', async (_label, reason) => {
    const { service, prepared } = setup();

    await service.send({ ...COMMAND, reason });

    expect(prepared[0]).not.toHaveProperty('reason');
  });

  test('照会を送った案件にも再び送れ、回答の期限は最後の照会から求める', async () => {
    const resentAt = new Date('2027-04-05T12:30:00.000Z');
    const { service, recorded } = setup({
      caseRecord: {
        ...PRODUCT_CASE,
        lastInquiredAt: SENT_AT,
        lastInquiryMessage: TRIMMED_MESSAGE,
      },
    });

    const result = await service.send({ ...COMMAND, at: resentAt });

    expect(result).toEqual({
      sentAt: resentAt,
      deadline: new Date('2027-04-12T12:30:00.000Z'),
    });
    expect(recorded[0]?.at).toEqual(resentAt);
  });

  test.each([
    ['空白だけの', ' \n　 ', 'empty', '照会の内容を入力してください。'],
    [
      '1,000書記素を超える',
      '👍🏽'.repeat(1001),
      'too-long',
      '照会の内容は1,000文字以内で入力してください。',
    ],
  ] as const)(
    '%s内容は内容の欄の検証のエラーにし、何も読まない',
    async (_label, message, code, detailMessage) => {
      const { service, calls } = setup();

      const error = await appErrorOf(service.send({ ...COMMAND, message }));

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        message: '入力内容を確認してください。',
        details: [{ field: 'message', code, message: detailMessage }],
      });
      expect(calls).toEqual([]);
    },
  );

  test('前後の空白を除いて1,000書記素の内容は送れる', async () => {
    const { service, sent } = setup();

    await service.send({ ...COMMAND, message: ` ${'👍🏽'.repeat(1000)} ` });

    expect(sent[0]?.input).toMatchObject({ message: '👍🏽'.repeat(1000) });
  });

  test('500書記素を超える理由は理由の欄の検証のエラーにし、何も読まない', async () => {
    const { service, calls } = setup();

    const error = await appErrorOf(
      service.send({ ...COMMAND, reason: 'あ'.repeat(501) }),
    );

    expect(summaryOf(error)).toEqual({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
      details: [
        {
          field: 'reason',
          code: 'too-long',
          message: '理由は500文字以内で入力してください。',
        },
      ],
    });
    expect(calls).toEqual([]);
  });

  test('500書記素の理由は送れる', async () => {
    const { service, prepared } = setup();

    await service.send({ ...COMMAND, reason: 'あ'.repeat(500) });

    expect(prepared[0]?.reason).toBe('あ'.repeat(500));
  });

  test('案件が無ければreport_case_not_foundを返す', async () => {
    const { service, calls } = setup({ caseRecord: undefined });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
    expect(calls).toEqual(['find']);
  });

  test.each(['resolved', 'rejected'] as const)(
    '完了(%s)した案件はreport_case_closedで拒否する',
    async (status) => {
      const { service, calls } = setup({
        caseRecord: {
          ...PRODUCT_CASE,
          status,
          closedAt: new Date('2027-03-31T00:00:00.000Z'),
        },
      });

      const error = await appErrorOf(service.send(COMMAND));

      expect(summaryOf(error)).toEqual({
        kind: 'unprocessable',
        code: 'report_case_closed',
        message:
          'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。',
        details: undefined,
      });
      expect(calls).toEqual(['find']);
    },
  );

  test.each([
    ['権利侵害の案件でない', { ...PRODUCT_CASE, infringementReportedAt: null }],
    ['未対応の', { ...PRODUCT_CASE, status: 'open' as const }],
    ['投稿者がいない', { ...PRODUCT_CASE, targetOwnerUserId: null }],
    [
      '対象への参照を消した',
      {
        ...PRODUCT_CASE,
        targetId: null,
        targetDetachedAt: new Date('2027-03-31T00:00:00.000Z'),
      },
    ],
  ])(
    '%s案件はreport_inquiry_not_applicableで拒否し、宛先を引かない',
    async (_label, caseRecord) => {
      const { service, calls } = setup({ caseRecord });

      const error = await appErrorOf(service.send(COMMAND));

      expect(summaryOf(error)).toEqual(NOT_APPLICABLE);
      expect(calls).toEqual(['find']);
    },
  );

  test('投稿者の宛先が無ければ(退会・物理削除)report_inquiry_not_applicableで拒否し、送らない', async () => {
    const { service, calls } = setup({ contact: undefined });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(NOT_APPLICABLE);
    expect(calls).toEqual(['find', 'findContact']);
  });

  test.each([
    ['表示できない対象', UNAVAILABLE_VIEW],
    ['ハンドルの無い対象', { ...PRODUCT_VIEW, handle: null }],
  ])(
    '利用者側のURLを示せない%sはreport_inquiry_not_applicableで拒否し、送らない',
    async (_label, view) => {
      const { service, calls } = setup({ view });

      const error = await appErrorOf(service.send(COMMAND));

      expect(summaryOf(error)).toEqual(NOT_APPLICABLE);
      expect(calls).toEqual(['find', 'findContact', 'describe']);
    },
  );

  test('コメントの対象のプロダクトを表示できなければreport_inquiry_not_applicableで拒否する', async () => {
    const { service, calls } = setup({
      caseRecord: COMMENT_CASE,
      view: { ...COMMENT_VIEW, productName: null, productHandle: null },
    });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(NOT_APPLICABLE);
    expect(calls).not.toContain('send');
  });

  test('監査ログの準備の違反は送らずにそのまま返す', async () => {
    const violation = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: '入力内容を確認してください。',
    });
    const { service, calls } = setup({ prepareError: violation });

    const error = await rejectionOf(service.send(COMMAND));

    expect(error).toBe(violation);
    expect(calls).not.toContain('send');
  });

  test('送信の依頼に失敗すれば、記録せずにreport_inquiry_send_failedを返す', async () => {
    const { service, calls, incidents } = setup({
      sendError: new Error('Queueへの送信に失敗しました'),
    });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual({
      kind: 'unavailable',
      code: 'report_inquiry_send_failed',
      message: '照会を送れませんでした。時間をおいてやり直してください。',
      details: undefined,
    });
    expect(calls).not.toContain('recordInquiry');
    expect(incidents).toEqual([]);
  });

  test('送信の要求の不備(EmailSendError)は呼び出し側の不具合のため、想定内の失敗に変えずに投げ、記録しない', async () => {
    const sendError = new EmailSendError('invalid-input');
    const { service, calls } = setup({ sendError });

    const error = await rejectionOf(service.send(COMMAND));

    expect(error).toBe(sendError);
    expect(calls).not.toContain('recordInquiry');
  });

  test('送信の後の記録が競合すれば、エラートラッキングへ知らせてreport_case_state_conflictを返す', async () => {
    const { service, calls, incidents } = setup({ recordResult: 'conflict' });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(STATE_CONFLICT);
    expect(incidents).toEqual([
      { incident: 'inquiry-record-failed', context: { caseId: CASE_ID } },
    ]);
    expect(calls.slice(-3)).toEqual(['send', 'recordInquiry', 'report']);
  });

  test('送信の後の記録が例外で失敗すれば、エラートラッキングへ知らせてreport_case_state_conflictを返す', async () => {
    const { service, incidents } = setup({
      recordError: new Error('D1_ERROR: database is locked'),
    });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(STATE_CONFLICT);
    expect(incidents).toEqual([
      { incident: 'inquiry-record-failed', context: { caseId: CASE_ID } },
    ]);
  });

  test('送信の後に案件が物理削除されていれば、エラートラッキングへ知らせてreport_case_not_foundを返す', async () => {
    const { service, incidents } = setup({ recordResult: 'not-found' });

    const error = await appErrorOf(service.send(COMMAND));

    expect(summaryOf(error)).toEqual(CASE_NOT_FOUND);
    expect(incidents).toEqual([
      { incident: 'inquiry-record-failed', context: { caseId: CASE_ID } },
    ]);
  });
});
