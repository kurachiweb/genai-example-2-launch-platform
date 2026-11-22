import { describe, expect, test } from 'bun:test';

import type { ArchivePlan } from '../export-plan.ts';
import type {
  ExportInquiry,
  ExportPayment,
  ExportSnapshot,
  ExportSponsorship,
} from '../export-snapshot.ts';
import {
  buildInquiriesDocument,
  buildPaymentsDocument,
  buildSponsorshipsDocument,
} from './exchange-documents.ts';
import type { DocumentInput } from './file-reference.ts';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('先頭の要素が無い');
  }
  return head;
}

function documentInput(
  inquiries: readonly ExportInquiry[],
  paths: Readonly<Record<string, string>>,
  stored: readonly string[],
): DocumentInput {
  const plan: ArchivePlan = {
    binaries: [],
    pathByFileId: new Map(Object.entries(paths)),
    productDirectories: new Map(),
    markdown: [],
  };
  return {
    snapshot: { inquiries } as unknown as ExportSnapshot,
    plan,
    stored: new Set(stored),
  };
}

function inquiry(overrides: Partial<ExportInquiry> = {}): ExportInquiry {
  return {
    id: '01J9J0G2M4P6R8T0V2X4Z6B8D0',
    category: '決済について',
    status: 'resolved',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    messages: [
      {
        id: '01J9B2Y4DAK2GX4GTJXFA87YZT',
        sender: 'user',
        adminNickname: null,
        body: '領収書の宛名を変更できますか？',
        attachments: [
          {
            fileId: 'F1',
            originalFileName: 'receipt.pdf',
            contentType: 'application/pdf',
            size: 48_213,
          },
        ],
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      },
      {
        id: '01J9B2Y4DBQ27HNVTEAP0Q8TK6',
        sender: 'admin',
        adminNickname: 'サポート担当A',
        body: 'Stripeの領収書ページから変更できます。',
        attachments: [],
        createdAt: new Date('2026-08-01T12:30:00.000Z'),
      },
    ],
    ...overrides,
  };
}

const RECEIPT_PATH =
  'inquiries/01J9J0G2M4P6R8T0V2X4Z6B8D0/01J9B2Y4DAK2GX4GTJXFA87YZT/receipt.pdf';

describe('buildInquiriesDocument', () => {
  test('文書の例と同じ形で問い合わせとメッセージを写す', () => {
    const input = documentInput([inquiry()], { F1: RECEIPT_PATH }, ['F1']);

    expect(buildInquiriesDocument(input)).toStrictEqual([
      {
        id: '01J9J0G2M4P6R8T0V2X4Z6B8D0',
        category: '決済について',
        status: 'resolved',
        createdAt: '2026-08-01T10:00:00.000Z',
        messages: [
          {
            id: '01J9B2Y4DAK2GX4GTJXFA87YZT',
            sender: 'user',
            adminNickname: null,
            body: '領収書の宛名を変更できますか？',
            attachments: [
              {
                path: RECEIPT_PATH,
                contentType: 'application/pdf',
                size: 48_213,
              },
            ],
            createdAt: '2026-08-01T10:00:00.000Z',
          },
          {
            id: '01J9B2Y4DBQ27HNVTEAP0Q8TK6',
            sender: 'admin',
            adminNickname: 'サポート担当A',
            body: 'Stripeの領収書ページから変更できます。',
            attachments: [],
            createdAt: '2026-08-01T12:30:00.000Z',
          },
        ],
      },
    ]);
  });

  test('格納できなかった添付はパスをnullにして残す', () => {
    const input = documentInput([inquiry()], { F1: RECEIPT_PATH }, []);

    const attachment = first(
      first(first(buildInquiriesDocument(input)).messages).attachments,
    );

    expect(attachment).toStrictEqual({
      path: null,
      contentType: 'application/pdf',
      size: 48_213,
    });
  });

  test('計画にパスが無い添付は格納できた集合にあってもパスをnullにする', () => {
    const input = documentInput([inquiry()], {}, ['F1']);

    const attachment = first(
      first(first(buildInquiriesDocument(input)).messages).attachments,
    );

    expect(attachment.path).toBeNull();
  });

  test('問い合わせが無ければ空配列を返す', () => {
    expect(buildInquiriesDocument(documentInput([], {}, []))).toStrictEqual([]);
  });

  test('並び順は入力のまま変えない', () => {
    const input = documentInput(
      [inquiry({ id: 'B' }), inquiry({ id: 'A' })],
      {},
      [],
    );

    expect(
      buildInquiriesDocument(input).map((entry) => entry.id),
    ).toStrictEqual(['B', 'A']);
  });

  test('上流の余分な項目は出力へ出さない', () => {
    const polluted = {
      ...inquiry(),
      internalNote: 'secret',
    } as unknown as ExportInquiry;

    expect(
      Object.keys(
        first(buildInquiriesDocument(documentInput([polluted], {}, []))),
      ),
    ).toStrictEqual(['id', 'category', 'status', 'createdAt', 'messages']);
  });
});

describe('buildSponsorshipsDocument', () => {
  const sponsorship: ExportSponsorship = {
    id: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
    product: { name: 'Pitch Notes', handle: 'pitch-notes' },
    tier: 'gold',
    startsOn: '2026-09-07',
    endsOn: '2026-09-13',
    days: 7,
    status: 'terminated',
    paymentId: '01J9B2Y4DDKYB9KA41TCHRDN3D',
    createdAt: new Date('2026-09-06T09:00:00.000Z'),
  };

  test('文書の例と同じ形で写す', () => {
    expect(buildSponsorshipsDocument([sponsorship])).toStrictEqual([
      {
        id: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        product: { name: 'Pitch Notes', handle: 'pitch-notes' },
        tier: 'gold',
        startsOn: '2026-09-07',
        endsOn: '2026-09-13',
        days: 7,
        status: 'terminated',
        paymentId: '01J9B2Y4DDKYB9KA41TCHRDN3D',
        createdAt: '2026-09-06T09:00:00.000Z',
      },
    ]);
  });

  test('未決済の広告はpaymentIdをnullで残す', () => {
    const entry = first(
      buildSponsorshipsDocument([
        { ...sponsorship, status: 'pending_payment', paymentId: null },
      ]),
    );

    expect(entry.paymentId).toBeNull();
  });

  test('0件なら空配列を返す', () => {
    expect(buildSponsorshipsDocument([])).toStrictEqual([]);
  });

  test('上流の余分な項目は出力へ出さない', () => {
    const polluted = {
      ...sponsorship,
      product: { ...sponsorship.product, id: 'internal' },
      stripeCustomerId: 'cus_x',
    } as unknown as ExportSponsorship;

    const entry = first(buildSponsorshipsDocument([polluted]));

    expect(Object.keys(entry)).not.toContain('stripeCustomerId');
    expect(entry.product).toStrictEqual({
      name: 'Pitch Notes',
      handle: 'pitch-notes',
    });
  });
});

describe('buildPaymentsDocument', () => {
  const payment: ExportPayment = {
    id: '01J9B2Y4DDKYB9KA41TCHRDN3D',
    kind: 'one_time',
    purpose: 'sponsorship',
    amount: 5600,
    currency: 'usd',
    quantity: 7,
    status: 'succeeded',
    stripeReference: 'cs_live_a1B2c3D4e5F6g7H8i9J0',
    relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
    occurredAt: new Date('2026-09-06T09:01:12.000Z'),
  };

  test('文書の例と同じ形で写す', () => {
    expect(buildPaymentsDocument([payment])).toStrictEqual([
      {
        id: '01J9B2Y4DDKYB9KA41TCHRDN3D',
        kind: 'one_time',
        purpose: 'sponsorship',
        amount: 5600,
        currency: 'usd',
        quantity: 7,
        status: 'succeeded',
        stripeReference: 'cs_live_a1B2c3D4e5F6g7H8i9J0',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        occurredAt: '2026-09-06T09:01:12.000Z',
      },
    ]);
  });

  test('返金の負数・quantityとrelatedIdのnullをそのまま写す', () => {
    const [entry] = buildPaymentsDocument([
      {
        ...payment,
        kind: 'refund',
        amount: -4800,
        quantity: null,
        relatedId: null,
      },
    ]);

    expect(entry).toMatchObject({
      kind: 'refund',
      amount: -4800,
      quantity: null,
      relatedId: null,
    });
  });

  test('敗訴のチャージバックの0円を写す', () => {
    const [entry] = buildPaymentsDocument([
      { ...payment, kind: 'dispute', status: 'dispute_lost', amount: 0 },
    ]);

    expect(entry).toMatchObject({ amount: 0, status: 'dispute_lost' });
  });

  test('0件なら空配列を返す', () => {
    expect(buildPaymentsDocument([])).toStrictEqual([]);
  });

  test('並び順は入力のまま変えない', () => {
    const entries = buildPaymentsDocument([
      { ...payment, id: 'B' },
      { ...payment, id: 'A' },
    ]);

    expect(entries.map((entry) => entry.id)).toStrictEqual(['B', 'A']);
  });

  test('上流の余分な項目は出力へ出さない', () => {
    const polluted = {
      ...payment,
      customerEmail: 'x@mail.example',
    } as unknown as ExportPayment;

    expect(Object.keys(first(buildPaymentsDocument([polluted])))).toStrictEqual(
      [
        'id',
        'kind',
        'purpose',
        'amount',
        'currency',
        'quantity',
        'status',
        'stripeReference',
        'relatedId',
        'occurredAt',
      ],
    );
  });
});
