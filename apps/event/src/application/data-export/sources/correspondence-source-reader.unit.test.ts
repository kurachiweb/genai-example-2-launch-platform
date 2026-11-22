import { describe, expect, test } from 'bun:test';

import type {
  InquiryExport,
  InquiryExportItem,
  InquiryExportPage,
} from '../../../../lib/core/inquiry/ports.ts';
import type {
  PaymentHistoryExport,
  PaymentHistoryExportItem,
} from '../../../../lib/core/payments/ports.ts';
import type {
  ReportExport,
  ReportExportRecord,
} from '../../../../lib/core/reporting/ports.ts';
import type {
  SponsorshipExport,
  SponsorshipExportRecord,
} from '../../../../lib/core/sponsorship/ports.ts';
import { CorrespondenceSourceReader } from './correspondence-source-reader.ts';

const USER_ID = '01JD0USER00000000000000001';
const PSEUDONYMOUS_ID = 'PSEUDONYM-1';
const NOW = new Date('2026-11-22T00:00:00.000Z');
const AT = new Date('2026-11-01T00:00:00.000Z');

function reportRecord(id: string): ReportExportRecord {
  return {
    id,
    targetType: 'comment',
    targetRef: 'C-1',
    category: 'スパム',
    reason: '宣伝です',
    createdAt: AT,
  };
}

function inquiryItem(id: string): InquiryExportItem {
  return {
    id,
    category: '不具合',
    status: 'in_progress',
    createdAt: '2026-11-01T10:00:00.123Z',
    messages: [
      {
        id: `${id}-M1`,
        sender: 'user',
        adminNickname: null,
        body: '困っています',
        attachments: [
          {
            fileId: 'F-ATT-1',
            originalFileName: 'screen.png',
            contentType: 'image/png',
            size: 1234,
          },
        ],
        createdAt: '2026-11-01T10:00:00.123Z',
      },
      {
        id: `${id}-M2`,
        sender: 'admin',
        adminNickname: '運営',
        body: '確認します',
        attachments: [],
        createdAt: '2026-11-01T11:30:45.678Z',
      },
    ],
  };
}

function sponsorshipRecord(): SponsorshipExportRecord {
  return {
    id: 'S-1',
    product: { name: 'プロダクト', handle: 'product-one' },
    tier: 'gold',
    startsOn: '2026-12-01',
    endsOn: '2026-12-07',
    days: 7,
    status: 'scheduled',
    paymentId: 'PAY-1',
    createdAt: AT,
  };
}

function paymentItem(): PaymentHistoryExportItem {
  return {
    id: 'PAY-1',
    kind: 'one_time',
    purpose: 'sponsorship',
    amount: 4900,
    currency: 'usd',
    quantity: 7,
    status: 'succeeded',
    stripeReference: 'pi_example_1',
    relatedId: 'S-1',
    occurredAt: '2026-11-02T03:04:05.006Z',
  };
}

interface Pages {
  readonly reports: readonly (readonly ReportExportRecord[])[];
  readonly inquiries: readonly (readonly InquiryExportItem[])[];
}

interface Calls {
  readonly reports: { userId: string; after?: string; limit: number }[];
  readonly inquiries: [string, string | undefined][];
  readonly sponsorships: [string, Date][];
  readonly payments: string[];
}

function build(
  pages: Pages = {
    reports: [[reportRecord('R-1')]],
    inquiries: [[inquiryItem('I-1')]],
  },
): { readonly reader: CorrespondenceSourceReader; readonly calls: Calls } {
  const calls: Calls = {
    reports: [],
    inquiries: [],
    sponsorships: [],
    payments: [],
  };
  const reports: ReportExport = {
    listPage: (input) => {
      calls.reports.push({ ...input });
      const index = calls.reports.length - 1;
      const last = index === pages.reports.length - 1;
      return Promise.resolve({
        records: pages.reports[index] ?? [],
        nextAfter: last ? null : `R-CURSOR-${String(index)}`,
      });
    },
  };
  const inquiries: InquiryExport = {
    listPage: (userId, after) => {
      calls.inquiries.push([userId, after]);
      const index = calls.inquiries.length - 1;
      const last = index === pages.inquiries.length - 1;
      const page: InquiryExportPage = {
        items: pages.inquiries[index] ?? [],
        nextCursor: last ? null : `I-CURSOR-${String(index)}`,
      };
      return Promise.resolve(page);
    },
  };
  const sponsorships: SponsorshipExport = {
    listByUser: (userId, now) => {
      calls.sponsorships.push([userId, now]);
      return Promise.resolve([sponsorshipRecord()]);
    },
  };
  const payments: PaymentHistoryExport = {
    listAll: (pseudonymousId) => {
      calls.payments.push(pseudonymousId);
      return Promise.resolve([paymentItem()]);
    },
  };
  return {
    reader: new CorrespondenceSourceReader(
      reports,
      inquiries,
      sponsorships,
      payments,
    ),
    calls,
  };
}

describe('CorrespondenceSourceReader.read', () => {
  test('通報をスナップショットの形へ写す', async () => {
    const { reader } = build();

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(source.reports).toStrictEqual([
      {
        id: 'R-1',
        targetType: 'comment',
        targetRef: 'C-1',
        category: 'スパム',
        reason: '宣伝です',
        createdAt: AT,
      },
    ]);
  });

  test('通報を20件ずつ、次のページが無くなるまで読む', async () => {
    const { reader, calls } = build({
      reports: [[reportRecord('R-1')], [reportRecord('R-2')], []],
      inquiries: [[]],
    });

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(calls.reports).toStrictEqual([
      { userId: USER_ID, after: undefined, limit: 20 },
      { userId: USER_ID, after: 'R-CURSOR-0', limit: 20 },
      { userId: USER_ID, after: 'R-CURSOR-1', limit: 20 },
    ]);
    expect(source.reports.map(({ id }) => id)).toStrictEqual(['R-1', 'R-2']);
  });

  test('問い合わせを次のページが無くなるまで読み、順に連結する', async () => {
    const { reader, calls } = build({
      reports: [[]],
      inquiries: [[inquiryItem('I-1')], [inquiryItem('I-2')]],
    });

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(calls.inquiries).toStrictEqual([
      [USER_ID, undefined],
      [USER_ID, 'I-CURSOR-0'],
    ]);
    expect(source.inquiries.map(({ id }) => id)).toStrictEqual(['I-1', 'I-2']);
  });

  test('問い合わせの文字列の日時をDateへ写し、添付とメッセージの項目を明示して写す', async () => {
    const { reader } = build();

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(source.inquiries).toStrictEqual([
      {
        id: 'I-1',
        category: '不具合',
        status: 'in_progress',
        createdAt: new Date('2026-11-01T10:00:00.123Z'),
        messages: [
          {
            id: 'I-1-M1',
            sender: 'user',
            adminNickname: null,
            body: '困っています',
            attachments: [
              {
                fileId: 'F-ATT-1',
                originalFileName: 'screen.png',
                contentType: 'image/png',
                size: 1234,
              },
            ],
            createdAt: new Date('2026-11-01T10:00:00.123Z'),
          },
          {
            id: 'I-1-M2',
            sender: 'admin',
            adminNickname: '運営',
            body: '確認します',
            attachments: [],
            createdAt: new Date('2026-11-01T11:30:45.678Z'),
          },
        ],
      },
    ]);
  });

  test('スポンサー広告を現在時刻で読み、スナップショットの形へ写す', async () => {
    const { reader, calls } = build();

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(calls.sponsorships).toStrictEqual([[USER_ID, NOW]]);
    expect(source.sponsorships).toStrictEqual([
      {
        id: 'S-1',
        product: { name: 'プロダクト', handle: 'product-one' },
        tier: 'gold',
        startsOn: '2026-12-01',
        endsOn: '2026-12-07',
        days: 7,
        status: 'scheduled',
        paymentId: 'PAY-1',
        createdAt: AT,
      },
    ]);
  });

  test('決済履歴をアカウントの仮名化IDで求め、日時をDateへ写す', async () => {
    const { reader, calls } = build();

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(calls.payments).toStrictEqual([PSEUDONYMOUS_ID]);
    expect(source.payments).toStrictEqual([
      {
        id: 'PAY-1',
        kind: 'one_time',
        purpose: 'sponsorship',
        amount: 4900,
        currency: 'usd',
        quantity: 7,
        status: 'succeeded',
        stripeReference: 'pi_example_1',
        relatedId: 'S-1',
        occurredAt: new Date('2026-11-02T03:04:05.006Z'),
      },
    ]);
  });

  test('疎通確認用の購入の種別(payments_smoke)の決済は利用者の取引ではないため除く', async () => {
    const smoke: PaymentHistoryExportItem = {
      ...paymentItem(),
      id: 'PAY-SMOKE',
      purpose: 'payments_smoke',
    };
    const reader = new CorrespondenceSourceReader(
      { listPage: () => Promise.resolve({ records: [], nextAfter: null }) },
      { listPage: () => Promise.resolve({ items: [], nextCursor: null }) },
      { listByUser: () => Promise.resolve([]) },
      { listAll: () => Promise.resolve([paymentItem(), smoke]) },
    );

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(source.payments.map(({ id }) => id)).toStrictEqual(['PAY-1']);
  });

  test('仮名化IDを結果へ入れない', async () => {
    const { reader } = build();

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(JSON.stringify(source)).not.toContain(PSEUDONYMOUS_ID);
  });

  test('上流の余分な項目を漏らさない', async () => {
    const { reader } = build({
      reports: [[{ ...reportRecord('R-1'), extra: 'leak' } as never]],
      inquiries: [
        [
          {
            ...inquiryItem('I-1'),
            extra: 'leak',
            messages: [
              {
                ...inquiryItem('I-1').messages[0],
                extra: 'leak',
                attachments: [
                  {
                    ...inquiryItem('I-1').messages[0]?.attachments[0],
                    extra: 'leak',
                  },
                ],
              },
            ],
          } as never,
        ],
      ],
    });

    const source = await reader.read(USER_ID, PSEUDONYMOUS_ID, NOW);

    expect(JSON.stringify(source)).not.toContain('leak');
  });

  test('部品の例外をそのまま投げる', async () => {
    const failure = new Error('決済履歴の取得に失敗');
    const reader = new CorrespondenceSourceReader(
      { listPage: () => Promise.resolve({ records: [], nextAfter: null }) },
      { listPage: () => Promise.resolve({ items: [], nextCursor: null }) },
      { listByUser: () => Promise.resolve([]) },
      { listAll: () => Promise.reject(failure) },
    );

    const caught = await reader
      .read(USER_ID, PSEUDONYMOUS_ID, NOW)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });

  test('通報のページの取得の失敗もそのまま投げ、問い合わせ以降を呼ばない', async () => {
    const failure = new Error('通報の取得に失敗');
    let inquiriesCalled = false;
    const reader = new CorrespondenceSourceReader(
      { listPage: () => Promise.reject(failure) },
      {
        listPage: () => {
          inquiriesCalled = true;
          return Promise.resolve({ items: [], nextCursor: null });
        },
      },
      { listByUser: () => Promise.resolve([]) },
      { listAll: () => Promise.resolve([]) },
    );

    const caught = await reader
      .read(USER_ID, PSEUDONYMOUS_ID, NOW)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(inquiriesCalled).toBe(false);
  });
});
