import { describe, expect, test } from 'bun:test';

import {
  ADMIN_PRODUCT_REPORT_SUMMARY_ARGS,
  ADMIN_REPORT_CASE_ARGS,
  ADMIN_REPORT_CASES_ARGS,
  CHANGE_REPORT_CASE_STATUS_ARGS,
  CREATE_REPORT_CATEGORY_ARGS,
  DELETE_REPORT_CATEGORY_ARGS,
  RENAME_REPORT_CATEGORY_ARGS,
  REPORT_CASE_CLOSING_ARGS,
  SEND_INFRINGEMENT_INQUIRY_ARGS,
  SUBMIT_REPORT_ARGS,
} from './inputs.ts';

const CASE_ID = '01JE0CASE00000000000000001';
const CATEGORY_ID = '01JE0000000000000000000003';
const PRODUCT_ID = '01JD0PRDCT0000000000000001';
const REPORTED_FROM = Date.UTC(2026, 10, 1, 15);
const REPORTED_BEFORE = Date.UTC(2026, 10, 8, 15);

const PAGE_SIZE_MESSAGE = '表示する件数は1〜50件の整数で指定してください。';
const TARGET_REF_MESSAGE =
  '通報の対象が見つかりません。ページを読み込み直してください。';
const REPORT_CATEGORY_MESSAGE = 'カテゴリを選んでください。';
const REASON_EMPTY_MESSAGE = '理由を入力してください。';
const REASON_TOO_LONG_MESSAGE = '理由は1,000文字以内で入力してください。';
const CONTACT_EMAIL_TOO_LONG_MESSAGE =
  'メールアドレスは254文字以内で入力してください。';
const CASE_ID_MESSAGE = '通報の案件が見つかりません。';
const CATEGORY_ID_MESSAGE = 'カテゴリが見つかりません。';
const PRODUCT_ID_MESSAGE = 'プロダクトが見つかりません。';
const PERIOD_MESSAGE = '終了日には開始日と同じか後の日付を入力してください。';
const ADMIN_REASON_MESSAGE = '理由は500文字以内で入力してください。';
const INQUIRY_MESSAGE_MESSAGE = '照会の内容は1,000文字以内で入力してください。';
const CATEGORY_NAME_MESSAGE = 'カテゴリ名は30文字以内で入力してください。';

// 家族の絵文字は1書記素で、UTF-16では11単位になる
const FAMILY = '👨‍👩‍👧‍👦';

const INVALID_IDS = [CASE_ID.toLowerCase(), 'not-a-ulid', '', `${CASE_ID}0`];

interface IssueSummary {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

function issuesOf(result: {
  readonly success: boolean;
  readonly error?: {
    readonly issues: readonly {
      readonly path: readonly PropertyKey[];
      readonly code: string;
      readonly message: string;
    }[];
  };
}): readonly IssueSummary[] {
  return (
    result.error?.issues.map(({ path, code, message }) => ({
      field: path.map(String).join('.'),
      code,
      message,
    })) ?? []
  );
}

const submitInputOf = (overrides: Record<string, unknown> = {}) => ({
  input: {
    targetKind: 'PRODUCT',
    targetRef: PRODUCT_ID,
    categoryId: CATEGORY_ID,
    reason: '他のサービスの画面をそのまま使っています',
    ...overrides,
  },
});

describe('SUBMIT_REPORT_ARGS', () => {
  test('対象の種類をユースケースの値に写し、理由を入力のまま渡し、連絡先の省略とnullを未指定にする', () => {
    expect(
      SUBMIT_REPORT_ARGS.parse(
        submitInputOf({ reason: '  改行を\n含む理由  ', contactEmail: null }),
      ),
    ).toEqual({
      input: {
        targetKind: 'product',
        targetRef: PRODUCT_ID,
        categoryId: CATEGORY_ID,
        reason: '  改行を\n含む理由  ',
        contactEmail: undefined,
      },
    });
    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf()).input.contactEmail,
    ).toBeUndefined();
  });

  test.each([
    ['USER', 'user'],
    ['PRODUCT', 'product'],
    ['COMMENT', 'comment'],
  ] as const)('対象の種類%sを%sに写す', (targetKind, expected) => {
    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf({ targetKind })).input.targetKind,
    ).toBe(expected);
  });

  test.each(['a', 'x'.repeat(100)])(
    '対象の参照の1文字と100文字(%#)を受け付ける',
    (targetRef) => {
      expect(
        SUBMIT_REPORT_ARGS.parse(submitInputOf({ targetRef })).input.targetRef,
      ).toBe(targetRef);
    },
  );

  test.each(['', 'x'.repeat(101)])(
    '対象の参照の空と101文字(%#)を、対象が見つからない文言の欄の誤りにする',
    (targetRef) => {
      expect(
        issuesOf(SUBMIT_REPORT_ARGS.safeParse(submitInputOf({ targetRef }))),
      ).toEqual([
        expect.objectContaining({
          field: 'input.targetRef',
          message: TARGET_REF_MESSAGE,
        }),
      ]);
    },
  );

  test.each(INVALID_IDS)(
    'カテゴリのIDの形式の誤り(%p)を、カテゴリの未選択と同じ文言の欄の誤り1件にする',
    (categoryId) => {
      expect(
        issuesOf(SUBMIT_REPORT_ARGS.safeParse(submitInputOf({ categoryId }))),
      ).toEqual([
        expect.objectContaining({
          field: 'input.categoryId',
          message: REPORT_CATEGORY_MESSAGE,
        }),
      ]);
    },
  );

  test.each(['', '   ', '　\t\n'])(
    '空と空白だけの理由(%p)を未入力の欄の誤りにする',
    (reason) => {
      expect(
        issuesOf(SUBMIT_REPORT_ARGS.safeParse(submitInputOf({ reason }))),
      ).toEqual([
        {
          field: 'input.reason',
          code: 'custom',
          message: REASON_EMPTY_MESSAGE,
        },
      ]);
    },
  );

  test('前後の空白を除いて1,000書記素の理由を受け付け、1,001書記素を上限の欄の誤りにする', () => {
    const atMax = `  ${FAMILY.repeat(1000)}  `;

    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf({ reason: atMax })).input.reason,
    ).toBe(atMax);
    expect(
      issuesOf(
        SUBMIT_REPORT_ARGS.safeParse(
          submitInputOf({ reason: FAMILY.repeat(1001) }),
        ),
      ),
    ).toEqual([
      {
        field: 'input.reason',
        code: 'custom',
        message: REASON_TOO_LONG_MESSAGE,
      },
    ]);
  });

  test('連絡先の前後の空白を除き、空白だけの連絡先を未指定にする', () => {
    expect(
      SUBMIT_REPORT_ARGS.parse(
        submitInputOf({ contactEmail: '  reporter@example.example ' }),
      ).input.contactEmail,
    ).toBe('reporter@example.example');
    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf({ contactEmail: ' 　 ' })).input
        .contactEmail,
    ).toBeUndefined();
  });

  test('前後の空白を除いて254文字の連絡先を受け付け、255文字を上限の欄の誤りにする。形式と要否は検証しない', () => {
    const domain = '@example.example';
    const atMax = `${'a'.repeat(254 - domain.length)}${domain}`;

    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf({ contactEmail: ` ${atMax} ` }))
        .input.contactEmail,
    ).toBe(atMax);
    expect(
      SUBMIT_REPORT_ARGS.parse(submitInputOf({ contactEmail: 'not-an-email' }))
        .input.contactEmail,
    ).toBe('not-an-email');
    expect(
      issuesOf(
        SUBMIT_REPORT_ARGS.safeParse(
          submitInputOf({ contactEmail: `a${atMax}` }),
        ),
      ),
    ).toEqual([
      {
        field: 'input.contactEmail',
        code: 'custom',
        message: CONTACT_EMAIL_TOO_LONG_MESSAGE,
      },
    ]);
  });
});

describe('ADMIN_REPORT_CASES_ARGS', () => {
  test.each([1, 50])(
    '件数%iを受け付け、絞り込みと位置の省略とnullを未指定にする',
    (first) => {
      expect(
        ADMIN_REPORT_CASES_ARGS.parse({ filter: null, first, after: null }),
      ).toEqual({ filter: {}, first, after: undefined });
      expect(ADMIN_REPORT_CASES_ARGS.parse({ first })).toEqual({
        filter: {},
        first,
        after: undefined,
      });
    },
  );

  test.each([0, 51, 1.5, -1])('件数%pを件数の欄の誤りにする', (first) => {
    expect(issuesOf(ADMIN_REPORT_CASES_ARGS.safeParse({ first }))).toEqual([
      expect.objectContaining({ field: 'first', message: PAGE_SIZE_MESSAGE }),
    ]);
  });

  test('位置を入力のまま渡す', () => {
    expect(
      ADMIN_REPORT_CASES_ARGS.parse({ first: 50, after: 'cursor' }).after,
    ).toBe('cursor');
  });

  test('絞り込みの状態・対象の種類をユースケースの値に写し、受付期間を日時にし、nullの項目を除く', () => {
    expect(
      ADMIN_REPORT_CASES_ARGS.parse({
        first: 50,
        filter: {
          status: 'IN_PROGRESS',
          targetKind: 'COMMENT',
          categoryId: CATEGORY_ID,
          reportedFrom: REPORTED_FROM,
          reportedBefore: REPORTED_BEFORE,
        },
      }).filter,
    ).toEqual({
      status: 'in_progress',
      targetKind: 'comment',
      categoryId: CATEGORY_ID,
      reportedFrom: new Date(REPORTED_FROM),
      reportedBefore: new Date(REPORTED_BEFORE),
    });
    expect(
      ADMIN_REPORT_CASES_ARGS.parse({
        first: 50,
        filter: {
          status: null,
          targetKind: null,
          categoryId: null,
          reportedFrom: null,
          reportedBefore: REPORTED_BEFORE,
        },
      }).filter,
    ).toEqual({ reportedBefore: new Date(REPORTED_BEFORE) });
  });

  test.each([
    ['OPEN', 'open'],
    ['IN_PROGRESS', 'in_progress'],
    ['RESOLVED', 'resolved'],
    ['REJECTED', 'rejected'],
  ] as const)('状態%sの絞り込みを%sに写す', (status, expected) => {
    expect(
      ADMIN_REPORT_CASES_ARGS.parse({ first: 1, filter: { status } }).filter,
    ).toEqual({ status: expected });
  });

  test.each(INVALID_IDS)(
    'カテゴリのIDの形式の誤り(%p)を、カテゴリが見つからない文言の欄の誤り1件にする',
    (categoryId) => {
      expect(
        issuesOf(
          ADMIN_REPORT_CASES_ARGS.safeParse({
            first: 50,
            filter: { categoryId },
          }),
        ),
      ).toEqual([
        expect.objectContaining({
          field: 'filter.categoryId',
          message: CATEGORY_ID_MESSAGE,
        }),
      ]);
    },
  );

  test.each([
    ['同じ日時', REPORTED_FROM],
    ['開始より前', REPORTED_FROM - 1],
  ])(
    '受付期間の終了が%sなら終了の欄の誤りにする(開始は含み、終了は含まない)',
    (_label, reportedBefore) => {
      expect(
        issuesOf(
          ADMIN_REPORT_CASES_ARGS.safeParse({
            first: 50,
            filter: { reportedFrom: REPORTED_FROM, reportedBefore },
          }),
        ),
      ).toEqual([
        {
          field: 'filter.reportedBefore',
          code: 'custom',
          message: PERIOD_MESSAGE,
        },
      ]);
    },
  );

  test('受付期間の開始が終了より前なら受け付ける', () => {
    expect(
      ADMIN_REPORT_CASES_ARGS.safeParse({
        first: 50,
        filter: {
          reportedFrom: REPORTED_FROM,
          reportedBefore: REPORTED_FROM + 1,
        },
      }).success,
    ).toBe(true);
  });
});

describe('案件と対象のIDの引数', () => {
  test('案件のIDとプロダクトのIDを受け付ける', () => {
    expect(ADMIN_REPORT_CASE_ARGS.parse({ id: CASE_ID })).toEqual({
      id: CASE_ID,
    });
    expect(
      ADMIN_PRODUCT_REPORT_SUMMARY_ARGS.parse({ productId: PRODUCT_ID }),
    ).toEqual({ productId: PRODUCT_ID });
  });

  test.each(INVALID_IDS)(
    '案件のIDの形式の誤り(%p)を、案件が見つからない文言の欄の誤り1件にする',
    (id) => {
      for (const schema of [
        ADMIN_REPORT_CASE_ARGS,
        REPORT_CASE_CLOSING_ARGS,
        CHANGE_REPORT_CASE_STATUS_ARGS,
        SEND_INFRINGEMENT_INQUIRY_ARGS,
      ]) {
        expect(
          issuesOf(
            schema.safeParse({
              id,
              from: 'OPEN',
              to: 'IN_PROGRESS',
              reason: '確認する',
              message: '権利を確認できる資料を示してください',
            }),
          ),
        ).toEqual([
          expect.objectContaining({ field: 'id', message: CASE_ID_MESSAGE }),
        ]);
      }
    },
  );

  test.each(INVALID_IDS)(
    'プロダクトのIDの形式の誤り(%p)を、プロダクトが見つからない文言の欄の誤り1件にする',
    (productId) => {
      expect(
        issuesOf(ADMIN_PRODUCT_REPORT_SUMMARY_ARGS.safeParse({ productId })),
      ).toEqual([
        expect.objectContaining({
          field: 'productId',
          message: PRODUCT_ID_MESSAGE,
        }),
      ]);
    },
  );
});

describe('案件の操作の引数', () => {
  test('手での状態の変更の前後の状態をユースケースの値に写し、理由の省略とnullを未指定にする', () => {
    expect(
      CHANGE_REPORT_CASE_STATUS_ARGS.parse({
        id: CASE_ID,
        from: 'RESOLVED',
        to: 'OPEN',
        reason: null,
      }),
    ).toEqual({
      id: CASE_ID,
      from: 'resolved',
      to: 'open',
      reason: undefined,
    });
  });

  test('理由の要否と前後の空白はユースケースが扱うため、空の理由と空白を含む理由を入力のまま渡す', () => {
    expect(
      REPORT_CASE_CLOSING_ARGS.parse({ id: CASE_ID, reason: '' }).reason,
    ).toBe('');
    expect(
      CHANGE_REPORT_CASE_STATUS_ARGS.parse({
        id: CASE_ID,
        from: 'OPEN',
        to: 'REJECTED',
        reason: '  却下する  ',
      }).reason,
    ).toBe('  却下する  ');
  });

  test('前後の空白を除いて500書記素の管理者の理由を受け付け、501書記素を上限の欄の誤りにする', () => {
    const atMax = ` ${FAMILY.repeat(500)} `;
    const overMax = FAMILY.repeat(501);

    expect(
      REPORT_CASE_CLOSING_ARGS.parse({ id: CASE_ID, reason: atMax }).reason,
    ).toBe(atMax);
    for (const [schema, args] of [
      [REPORT_CASE_CLOSING_ARGS, { id: CASE_ID }],
      [
        CHANGE_REPORT_CASE_STATUS_ARGS,
        { id: CASE_ID, from: 'OPEN', to: 'IN_PROGRESS' },
      ],
      [
        SEND_INFRINGEMENT_INQUIRY_ARGS,
        { id: CASE_ID, message: '資料を示してください' },
      ],
      [CREATE_REPORT_CATEGORY_ARGS, { name: '詐欺' }],
      [RENAME_REPORT_CATEGORY_ARGS, { id: CATEGORY_ID, name: '詐欺' }],
      [DELETE_REPORT_CATEGORY_ARGS, { id: CATEGORY_ID }],
    ] as const) {
      expect(issuesOf(schema.safeParse({ ...args, reason: overMax }))).toEqual([
        { field: 'reason', code: 'custom', message: ADMIN_REASON_MESSAGE },
      ]);
    }
  });

  test('照会の内容の空はユースケースが扱うため入力のまま渡し、前後の空白を除いて1,000書記素を受け付け、1,001書記素を上限の欄の誤りにする', () => {
    expect(
      SEND_INFRINGEMENT_INQUIRY_ARGS.parse({ id: CASE_ID, message: '' }),
    ).toEqual({ id: CASE_ID, message: '', reason: undefined });
    const atMax = `\n${FAMILY.repeat(1000)}\n`;
    expect(
      SEND_INFRINGEMENT_INQUIRY_ARGS.parse({ id: CASE_ID, message: atMax })
        .message,
    ).toBe(atMax);
    expect(
      issuesOf(
        SEND_INFRINGEMENT_INQUIRY_ARGS.safeParse({
          id: CASE_ID,
          message: FAMILY.repeat(1001),
        }),
      ),
    ).toEqual([
      { field: 'message', code: 'custom', message: INQUIRY_MESSAGE_MESSAGE },
    ]);
  });
});

describe('カテゴリの操作の引数', () => {
  test('名前の空と前後の空白はユースケースが扱うため入力のまま渡し、理由の省略を未指定にする', () => {
    expect(CREATE_REPORT_CATEGORY_ARGS.parse({ name: '' })).toEqual({
      name: '',
      reason: undefined,
    });
    expect(
      RENAME_REPORT_CATEGORY_ARGS.parse({
        id: CATEGORY_ID,
        name: ' 詐欺 ',
        reason: null,
      }),
    ).toEqual({ id: CATEGORY_ID, name: ' 詐欺 ', reason: undefined });
    expect(DELETE_REPORT_CATEGORY_ARGS.parse({ id: CATEGORY_ID })).toEqual({
      id: CATEGORY_ID,
      reason: undefined,
    });
  });

  test('前後の空白を除いて30書記素のカテゴリ名を受け付け、31書記素を上限の欄の誤りにする', () => {
    const atMax = ` ${FAMILY.repeat(30)} `;

    expect(CREATE_REPORT_CATEGORY_ARGS.parse({ name: atMax }).name).toBe(atMax);
    for (const [schema, args] of [
      [CREATE_REPORT_CATEGORY_ARGS, {}],
      [RENAME_REPORT_CATEGORY_ARGS, { id: CATEGORY_ID }],
    ] as const) {
      expect(
        issuesOf(schema.safeParse({ ...args, name: FAMILY.repeat(31) })),
      ).toEqual([
        { field: 'name', code: 'custom', message: CATEGORY_NAME_MESSAGE },
      ]);
    }
  });

  test.each(INVALID_IDS)(
    'カテゴリのIDの形式の誤り(%p)を、カテゴリが見つからない文言の欄の誤り1件にする',
    (id) => {
      for (const schema of [
        RENAME_REPORT_CATEGORY_ARGS,
        DELETE_REPORT_CATEGORY_ARGS,
      ]) {
        expect(issuesOf(schema.safeParse({ id, name: '詐欺' }))).toEqual([
          expect.objectContaining({
            field: 'id',
            message: CATEGORY_ID_MESSAGE,
          }),
        ]);
      }
    },
  );
});
