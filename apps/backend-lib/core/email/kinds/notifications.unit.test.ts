import { describe, expect, test } from 'bun:test';

import { createEmailKindRegistry } from '../email-kind.ts';
import {
  MATCH_RESULT_SUPPLEMENT_LIMIT,
  NOTIFICATION_EMAIL_KINDS,
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
} from './notifications.ts';

const LINKS = {
  settingsUrl: 'https://launch.example/settings/notifications',
  unsubscribeUrl: 'https://launch.example/unsubscribe#token=abc',
};

const PREVIEW_FIELDS = {
  ...LINKS,
  nickname: '山田',
  ownProductName: 'Pitch Notes',
  opponentProductName: 'Tactics Board',
  matchLabel: '予選',
  startsAt: '2026-10-25T08:00:00.000Z',
  endsAt: '2026-10-26T07:40:00.000Z',
  topPageUrl: 'https://launch.example/',
};

const SUPPLEMENT = {
  title: 'Weekトーナメントの参加費',
  lines: ['支払いの期限は10月26日07:40(UTC)です。'],
  action: {
    label: '参加費を支払う',
    url: 'https://launch.example/my/products',
  },
  emphasized: true,
};

const NEXT = {
  opponentProductName: 'Goal Line',
  roundName: '準決勝',
  matchLabel: 'Week 準決勝',
  startsAt: '2026-10-25T08:00:00.000Z',
  endsAt: '2026-10-26T07:40:00.000Z',
  unsubscribeUrl: 'https://launch.example/unsubscribe#token=def',
};

const RESULT_FIELDS = {
  ...LINKS,
  nickname: '山田',
  ownProductName: 'Pitch Notes',
  opponentProductName: 'Tactics Board',
  matchLabel: '予選',
  outcome: 'won',
  decidedByLastUpvote: false,
  ownVotes: 12,
  opponentVotes: 9,
  supplements: [SUPPLEMENT],
  action: {
    label: '参加費を支払う',
    url: 'https://launch.example/my/products',
  },
  next: null,
};

const ITEM = {
  productName: 'Pitch Notes',
  makerNickname: '佐藤',
  matchLabel: 'Week 準決勝',
  opponentProductName: 'Tactics Board',
};

const MATCHES_FIELDS = {
  ...LINKS,
  nickname: '山田',
  items: [ITEM],
  omittedCount: 0,
  topPageUrl: 'https://launch.example/',
};

const AWARD_FIELDS = {
  ...LINKS,
  nickname: '山田',
  productName: 'Pitch Notes',
  makerNickname: '佐藤',
  award: 'product_of_the_week',
  periodLabel: '2026年第37週(9/7〜9/13)',
  productUrl: 'https://launch.example/p/pitch-notes',
};

const KINDS = [
  [
    NOTIFICATION_MATCH_PREVIEW_KIND,
    'notifications.match-preview',
    PREVIEW_FIELDS,
  ],
  [NOTIFICATION_MATCH_RESULT_KIND, 'notifications.match-result', RESULT_FIELDS],
  [
    NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
    'notifications.followed-user-matches',
    MATCHES_FIELDS,
  ],
  [
    NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
    'notifications.followed-user-award',
    AWARD_FIELDS,
  ],
] as const;

const INVALID_URLS = [
  '',
  'http://launch.example/',
  'javascript:alert(1)',
  '/settings/notifications',
  undefined,
];

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_DATE_TIMES = [
  '',
  '2026-10-25',
  '2026-10-25T17:00:00+09:00',
  new Date('2026-10-25T08:00:00.000Z'),
  undefined,
];

const INVALID_COUNTS = [-1, 1.5, '1', undefined];

function fieldsWith(fields: object, key: string, value: unknown): unknown {
  return { ...fields, [key]: value };
}

describe('通知メールの4つの種別', () => {
  test.each(KINDS)(
    '種別%#は通知メールの分類の凍結した種別で、名前が規則どおりである',
    (kind, name) => {
      expect(kind.name).toBe(name);
      expect(kind.category).toBe('notification');
      expect(Object.isFrozen(kind)).toBe(true);
    },
  );

  test.each(KINDS)(
    '種別%#は規則どおりの入力を受け付け、他の項目を取り除く',
    (kind, _name, fields) => {
      const result = kind.inputSchema.safeParse({
        ...fields,
        to: 'someone@mail.example',
        token: 'secret',
      });

      expect(result as unknown).toEqual({ success: true, data: fields });
    },
  );

  test.each(KINDS)(
    '種別%#は通知設定と配信停止のリンクを必須にし、https:以外のURLを拒否する',
    (kind, _name, fields) => {
      for (const key of ['settingsUrl', 'unsubscribeUrl']) {
        for (const value of INVALID_URLS) {
          expect(
            kind.inputSchema.safeParse(fieldsWith(fields, key, value)).success,
          ).toBe(false);
        }
      }
    },
  );

  test.each(KINDS)(
    '種別%#はローカル環境のリンクをhttp://localhostで受け付ける',
    (kind, _name, fields) => {
      expect(
        kind.inputSchema.safeParse(
          fieldsWith(
            fields,
            'settingsUrl',
            'http://localhost:3000/settings/notifications',
          ),
        ).success,
      ).toBe(true);
    },
  );

  test('通知の種別を集約点へ加えても名前の形式違反と重複が無い', () => {
    expect(NOTIFICATION_EMAIL_KINDS.map((kind) => kind.name)).toEqual(
      KINDS.map(([, name]) => name),
    );
    expect(() =>
      createEmailKindRegistry(NOTIFICATION_EMAIL_KINDS),
    ).not.toThrow();
    expect(Object.isFrozen(NOTIFICATION_EMAIL_KINDS)).toBe(true);
  });
});

describe('メール種別notifications.match-preview', () => {
  const accepts = (input: unknown): boolean =>
    NOTIFICATION_MATCH_PREVIEW_KIND.inputSchema.safeParse(input).success;

  test.each([
    'nickname',
    'ownProductName',
    'opponentProductName',
    'matchLabel',
  ])('文字列の項目%sが空・未指定・文字列以外なら拒否する', (key) => {
    for (const value of INVALID_TEXTS) {
      expect(accepts(fieldsWith(PREVIEW_FIELDS, key, value))).toBe(false);
    }
  });

  test.each(['startsAt', 'endsAt'])(
    '日時の項目%sはUTCのISO 8601の文字列だけを受け付ける',
    (key) => {
      for (const value of INVALID_DATE_TIMES) {
        expect(accepts(fieldsWith(PREVIEW_FIELDS, key, value))).toBe(false);
      }
    },
  );

  test('トップページのURLを検証する', () => {
    for (const value of INVALID_URLS) {
      expect(accepts(fieldsWith(PREVIEW_FIELDS, 'topPageUrl', value))).toBe(
        false,
      );
    }
  });
});

describe('メール種別notifications.match-result', () => {
  const accepts = (input: unknown): boolean =>
    NOTIFICATION_MATCH_RESULT_KIND.inputSchema.safeParse(input).success;

  test.each(['won', 'lost', 'no_votes', 'bye'])(
    '結果%sを受け付ける',
    (outcome) => {
      expect(accepts(fieldsWith(RESULT_FIELDS, 'outcome', outcome))).toBe(true);
    },
  );

  test('結果の写像に無い値を拒否する', () => {
    for (const outcome of ['walkover', 'both_forfeited', '', undefined]) {
      expect(accepts(fieldsWith(RESULT_FIELDS, 'outcome', outcome))).toBe(
        false,
      );
    }
  });

  test.each(['ownVotes', 'opponentVotes'])(
    '票数%sは0以上の整数だけを受け付ける',
    (key) => {
      expect(accepts(fieldsWith(RESULT_FIELDS, key, 0))).toBe(true);
      for (const value of INVALID_COUNTS) {
        expect(accepts(fieldsWith(RESULT_FIELDS, key, value))).toBe(false);
      }
    },
  );

  test('最終Upvote時間で決まったかを真偽値で受け付ける', () => {
    expect(
      accepts(fieldsWith(RESULT_FIELDS, 'decidedByLastUpvote', true)),
    ).toBe(true);
    expect(
      accepts(fieldsWith(RESULT_FIELDS, 'decidedByLastUpvote', 'true')),
    ).toBe(false);
  });

  test(`追記は0〜${String(MATCH_RESULT_SUPPLEMENT_LIMIT)}件で、追記の検証規則に合うものだけを受け付ける`, () => {
    expect(MATCH_RESULT_SUPPLEMENT_LIMIT).toBe(3);
    expect(accepts(fieldsWith(RESULT_FIELDS, 'supplements', []))).toBe(true);
    expect(
      accepts(
        fieldsWith(RESULT_FIELDS, 'supplements', Array(3).fill(SUPPLEMENT)),
      ),
    ).toBe(true);
    expect(
      accepts(
        fieldsWith(RESULT_FIELDS, 'supplements', Array(4).fill(SUPPLEMENT)),
      ),
    ).toBe(false);
    expect(
      accepts(
        fieldsWith(RESULT_FIELDS, 'supplements', [
          { ...SUPPLEMENT, lines: [] },
        ]),
      ),
    ).toBe(false);
  });

  test('主要な行動のボタンはラベルとリンクのURLを求める', () => {
    expect(
      accepts(
        fieldsWith(RESULT_FIELDS, 'action', {
          label: '',
          url: LINKS.settingsUrl,
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        fieldsWith(RESULT_FIELDS, 'action', {
          label: '自分のプロダクトを見る',
          url: 'http://launch.example/my/products',
        }),
      ),
    ).toBe(false);
    expect(accepts(fieldsWith(RESULT_FIELDS, 'action', undefined))).toBe(false);
  });

  test.each(['won', 'bye'])('結果%sは翌日の予告と統合できる', (outcome) => {
    expect(accepts({ ...RESULT_FIELDS, outcome, next: NEXT })).toBe(true);
  });

  test.each(['lost', 'no_votes'])(
    '結果%sは翌日の予告と統合できない',
    (outcome) => {
      expect(accepts({ ...RESULT_FIELDS, outcome, next: NEXT })).toBe(false);
    },
  );

  test('翌日の予告の各項目を検証する', () => {
    const withNext = (key: string, value: unknown): unknown => ({
      ...RESULT_FIELDS,
      next: { ...NEXT, [key]: value },
    });

    for (const key of ['opponentProductName', 'roundName', 'matchLabel']) {
      expect(accepts(withNext(key, ''))).toBe(false);
    }
    for (const key of ['startsAt', 'endsAt']) {
      expect(accepts(withNext(key, '2026-10-25'))).toBe(false);
    }
    expect(accepts(withNext('unsubscribeUrl', 'http://launch.example/'))).toBe(
      false,
    );
    expect(accepts(fieldsWith(RESULT_FIELDS, 'next', undefined))).toBe(false);
  });
});

describe('メール種別notifications.followed-user-matches', () => {
  const accepts = (input: unknown): boolean =>
    NOTIFICATION_FOLLOWED_USER_MATCHES_KIND.inputSchema.safeParse(input)
      .success;

  test('項目は1〜30件だけを受け付ける', () => {
    expect(accepts(fieldsWith(MATCHES_FIELDS, 'items', []))).toBe(false);
    expect(
      accepts(fieldsWith(MATCHES_FIELDS, 'items', Array(30).fill(ITEM))),
    ).toBe(true);
    expect(
      accepts(fieldsWith(MATCHES_FIELDS, 'items', Array(31).fill(ITEM))),
    ).toBe(false);
  });

  test.each([
    'productName',
    'makerNickname',
    'matchLabel',
    'opponentProductName',
  ])('項目の%sが空なら拒否する', (key) => {
    expect(
      accepts(fieldsWith(MATCHES_FIELDS, 'items', [{ ...ITEM, [key]: '' }])),
    ).toBe(false);
  });

  test('残りの件数は0以上の整数だけを受け付ける', () => {
    expect(accepts(fieldsWith(MATCHES_FIELDS, 'omittedCount', 12))).toBe(true);
    for (const value of INVALID_COUNTS) {
      expect(accepts(fieldsWith(MATCHES_FIELDS, 'omittedCount', value))).toBe(
        false,
      );
    }
  });
});

describe('メール種別notifications.followed-user-award', () => {
  const accepts = (input: unknown): boolean =>
    NOTIFICATION_FOLLOWED_USER_AWARD_KIND.inputSchema.safeParse(input).success;

  test('賞の種類はWeekとYearだけを受け付ける', () => {
    expect(
      accepts(fieldsWith(AWARD_FIELDS, 'award', 'product_of_the_year')),
    ).toBe(true);
    expect(
      accepts(fieldsWith(AWARD_FIELDS, 'award', 'product_of_the_day')),
    ).toBe(false);
  });

  test.each(['nickname', 'productName', 'makerNickname', 'periodLabel'])(
    '文字列の項目%sが空・未指定なら拒否する',
    (key) => {
      for (const value of INVALID_TEXTS) {
        expect(accepts(fieldsWith(AWARD_FIELDS, key, value))).toBe(false);
      }
    },
  );

  test('プロダクト詳細のURLを検証する', () => {
    for (const value of INVALID_URLS) {
      expect(accepts(fieldsWith(AWARD_FIELDS, 'productUrl', value))).toBe(
        false,
      );
    }
  });
});
