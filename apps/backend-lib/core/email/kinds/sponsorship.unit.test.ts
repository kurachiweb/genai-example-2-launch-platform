import { describe, expect, test } from 'bun:test';

import {
  SPONSORSHIP_EMAIL_KINDS,
  SPONSORSHIP_END_NOTICE_EMAIL,
  SPONSORSHIP_START_NOTICE_EMAIL,
  SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
} from './sponsorship.ts';

const BASE_FIELDS = {
  nickname: '山田 はなこ',
  productName: 'Pitch Notes',
  tierLabel: 'Gold',
  startsOn: '2026-11-01',
  endsOn: '2026-11-07',
  days: 7,
  listUrl: 'https://client.example/settings/sponsorships',
};

const REFUND = { days: 3, amount: '$9.00' };

const END_FIELDS = { ...BASE_FIELDS, stopRefund: REFUND };

const TERMINATION_FIELDS = {
  ...BASE_FIELDS,
  terminatedOn: '2026-11-03',
  reason: '広告の内容が掲載の基準に合わないため',
  legalUrl: 'https://client.example/legal',
  terminationRefund: { days: 5, amount: '$15.00' },
  stopRefund: { days: 1, amount: '$3.00' },
};

const KINDS = [
  ['sponsorship.start-notice', SPONSORSHIP_START_NOTICE_EMAIL, BASE_FIELDS],
  ['sponsorship.end-notice', SPONSORSHIP_END_NOTICE_EMAIL, END_FIELDS],
  [
    'sponsorship.termination-notice',
    SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
    TERMINATION_FIELDS,
  ],
] as const;

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_DATES = [
  '',
  '2026-11-1',
  '2026/11/01',
  '2026-02-30',
  '2026-11-01T00:00:00.000Z',
  new Date('2026-11-01T00:00:00.000Z'),
  undefined,
  null,
];

const INVALID_URLS = [
  '',
  'http://client.example/settings/sponsorships',
  'javascript:alert(1)',
  '/settings/sponsorships',
  undefined,
];

const INVALID_REFUNDS = [
  undefined,
  { days: 3 },
  { amount: '$9.00' },
  { days: 0, amount: '$9.00' },
  { days: 1.5, amount: '$9.00' },
  { days: 367, amount: '$9.00' },
  { days: 3, amount: '' },
  { days: 3, amount: 900 },
];

describe.each(KINDS)('メール種別%s', (name, kind, fields) => {
  function accepts(input: unknown): boolean {
    return kind.inputSchema.safeParse(input).success;
  }

  function fieldsWith(key: string, value: unknown): unknown {
    return { ...fields, [key]: value };
  }

  test('トランザクションメールの凍結した種別である', () => {
    expect(kind.name).toBe(name);
    expect(kind.category).toBe('transactional');
    expect(Object.isFrozen(kind)).toBe(true);
  });

  test('本文の項目を受け付け、宛先や識別子などの他の項目を取り除く', () => {
    expect(
      kind.inputSchema.safeParse({
        ...fields,
        to: 'maker@launch.example',
        sponsorshipId: '01JD0SP0NS000000000000000A',
        amountPaid: 2100,
      }),
    ).toEqual({ success: true, data: fields });
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first = kind.inputSchema.parse(fields);

    expect(kind.inputSchema.parse(first)).toEqual(first);
  });

  test.each(['nickname', 'productName', 'tierLabel'])(
    '文字列の項目%sが空・欠落・文字列以外なら拒否する',
    (key) => {
      for (const value of INVALID_TEXTS) {
        expect(accepts(fieldsWith(key, value))).toBe(false);
      }
    },
  );

  test.each(['startsOn', 'endsOn'])(
    '実在するYYYY-MM-DDの日付でない%sを拒否する',
    (key) => {
      for (const value of INVALID_DATES) {
        expect(accepts(fieldsWith(key, value))).toBe(false);
      }
    },
  );

  test('1日だけの掲載期間を受け付ける', () => {
    expect(
      accepts({
        ...fields,
        startsOn: '2026-11-01',
        endsOn: '2026-11-01',
        days: 1,
        ...('terminatedOn' in fields ? { terminatedOn: '2026-11-01' } : {}),
      }),
    ).toBe(true);
  });

  test('年をまたぐ366日の掲載期間を受け付ける', () => {
    expect(
      accepts({
        ...fields,
        startsOn: '2027-01-01',
        endsOn: '2028-01-01',
        days: 366,
      }),
    ).toBe(true);
  });

  test.each([
    ['掲載期間の両端を含む日数と異なる日数', { days: 6 }],
    ['0日', { days: 0 }],
    ['整数でない日数', { days: 6.5 }],
    ['文字列の日数', { days: '7' }],
    [
      '終了日が開始日より前の期間',
      { startsOn: '2026-11-07', endsOn: '2026-11-01', days: 7 },
    ],
    [
      '上限の366日を超える期間',
      { startsOn: '2027-01-01', endsOn: '2028-01-02', days: 367 },
    ],
  ])('%sを拒否する', (_label, override) => {
    expect(accepts({ ...fields, ...override })).toBe(false);
  });

  test('ローカル環境の自分の広告一覧のURLをhttp://localhostで受け付ける', () => {
    expect(
      accepts(
        fieldsWith('listUrl', 'http://localhost:3000/settings/sponsorships'),
      ),
    ).toBe(true);
  });

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらない自分の広告一覧のURL%pを拒否する',
    (url) => {
      expect(accepts(fieldsWith('listUrl', url))).toBe(false);
    },
  );
});

describe('メール種別sponsorship.end-notice', () => {
  function accepts(input: unknown): boolean {
    return SPONSORSHIP_END_NOTICE_EMAIL.inputSchema.safeParse(input).success;
  }

  test('表示停止の返金が無い入力をnullで受け付ける', () => {
    expect(accepts({ ...END_FIELDS, stopRefund: null })).toBe(true);
  });

  test('残りの全額で依頼した返金の金額の表記を受け付ける', () => {
    expect(
      accepts({ ...END_FIELDS, stopRefund: { days: 3, amount: '残りの全額' } }),
    ).toBe(true);
  });

  test.each(INVALID_REFUNDS)('表示停止の返金の値%pを拒否する', (stopRefund) => {
    expect(accepts({ ...END_FIELDS, stopRefund })).toBe(false);
  });
});

describe('メール種別sponsorship.termination-notice', () => {
  function accepts(input: unknown): boolean {
    return SPONSORSHIP_TERMINATION_NOTICE_EMAIL.inputSchema.safeParse(input)
      .success;
  }

  test.each([
    ['強制終了の返金だけ', { stopRefund: null }],
    ['表示停止の返金だけ', { terminationRefund: null }],
    ['返金なし', { terminationRefund: null, stopRefund: null }],
  ])('%sの入力を受け付ける', (_label, override) => {
    expect(accepts({ ...TERMINATION_FIELDS, ...override })).toBe(true);
  });

  test('掲載開始日より前の強制終了日を受け付ける', () => {
    expect(accepts({ ...TERMINATION_FIELDS, terminatedOn: '2026-10-30' })).toBe(
      true,
    );
  });

  test.each(INVALID_DATES)(
    '実在するYYYY-MM-DDの日付でない強制終了日%pを拒否する',
    (terminatedOn) => {
      expect(accepts({ ...TERMINATION_FIELDS, terminatedOn })).toBe(false);
    },
  );

  test('掲載終了日より後の強制終了日を拒否する', () => {
    expect(accepts({ ...TERMINATION_FIELDS, terminatedOn: '2026-11-08' })).toBe(
      false,
    );
  });

  test('500文字の理由を受け付け、501文字・空・欠落の理由を拒否する', () => {
    expect(accepts({ ...TERMINATION_FIELDS, reason: 'あ'.repeat(500) })).toBe(
      true,
    );
    expect(accepts({ ...TERMINATION_FIELDS, reason: '👨‍👩‍👧'.repeat(500) })).toBe(
      true,
    );
    for (const reason of ['あ'.repeat(501), '', undefined]) {
      expect(accepts({ ...TERMINATION_FIELDS, reason })).toBe(false);
    }
  });

  test.each(INVALID_URLS)(
    'https:かhttp://localhostで始まらない法的通知のURL%pを拒否する',
    (legalUrl) => {
      expect(accepts({ ...TERMINATION_FIELDS, legalUrl })).toBe(false);
    },
  );

  test.each(INVALID_REFUNDS)(
    '強制終了の返金の値%pを拒否する',
    (terminationRefund) => {
      expect(accepts({ ...TERMINATION_FIELDS, terminationRefund })).toBe(false);
    },
  );

  test.each(INVALID_REFUNDS)('表示停止の返金の値%pを拒否する', (stopRefund) => {
    expect(accepts({ ...TERMINATION_FIELDS, stopRefund })).toBe(false);
  });
});

describe('SPONSORSHIP_EMAIL_KINDS', () => {
  test('開始・終了・強制終了の通知の3種をこの順に凍結して持つ', () => {
    expect(SPONSORSHIP_EMAIL_KINDS).toEqual([
      SPONSORSHIP_START_NOTICE_EMAIL,
      SPONSORSHIP_END_NOTICE_EMAIL,
      SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
    ]);
    expect(Object.isFrozen(SPONSORSHIP_EMAIL_KINDS)).toBe(true);
  });
});
