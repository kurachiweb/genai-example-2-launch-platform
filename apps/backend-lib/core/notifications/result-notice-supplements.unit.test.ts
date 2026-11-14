import { describe, expect, test } from 'bun:test';

import { LifecycleRegistrationError } from '../identity/user-lifecycle.ts';
import {
  createResultNoticeSupplementRegistry,
  RESULT_NOTICE_SUPPLEMENT_LIMITS,
  RESULT_NOTICE_SUPPLEMENT_PROVIDER_LABEL,
  type ResultNoticeSupplement,
  type ResultNoticeSupplementRegistration,
  resultNoticeSupplementSchema,
} from './result-notice-supplements.ts';

const supplement: ResultNoticeSupplement = {
  title: 'Product of the Weekへの出場',
  lines: ['2026年10月25日 15:59までに出場の手続きをしてください。'],
  action: {
    label: '出場の手続きをする',
    url: 'https://launch.example/tournaments/week',
  },
  emphasized: true,
};

const registration = (
  overrides: Partial<ResultNoticeSupplementRegistration> = {},
): ResultNoticeSupplementRegistration => ({
  name: 'tournament-week.entry-deadline',
  kinds: ['qualifier'],
  order: 1500,
  provider: Symbol.for('tournament-week.EntryDeadlineSupplement'),
  ...overrides,
});

const repeat = (length: number): string => 'あ'.repeat(length);

describe('結果の追記の上限', () => {
  test('見出しは50文字・行は1〜5行で各200文字・ボタンのラベルは30文字までである', () => {
    expect(RESULT_NOTICE_SUPPLEMENT_LIMITS).toEqual({
      titleGraphemes: 50,
      minLines: 1,
      maxLines: 5,
      lineGraphemes: 200,
      actionLabelGraphemes: 30,
    });
    expect(Object.isFrozen(RESULT_NOTICE_SUPPLEMENT_LIMITS)).toBe(true);
  });
});

describe('resultNoticeSupplementSchema', () => {
  test.each([
    ['行動のボタンを持つ追記', supplement],
    [
      '行動のボタンを持たない強調しない追記',
      {
        title: '次の予定',
        lines: ['次のマッチは明後日です。'],
        emphasized: false,
      },
    ],
    [
      '上限ちょうどの追記',
      {
        title: repeat(50),
        lines: Array.from({ length: 5 }, () => repeat(200)),
        action: { label: repeat(30), url: 'https://launch.example/' },
        emphasized: false,
      },
    ],
    ['結合文字を1文字と数える追記', { ...supplement, title: '👨‍👩‍👧'.repeat(50) }],
    [
      'ローカルの画面のオリジンへのボタン',
      {
        ...supplement,
        action: { label: '確認する', url: 'http://localhost:48041/settings' },
      },
    ],
  ])('%sを受け付ける', (_label, value) => {
    expect(resultNoticeSupplementSchema.safeParse(value)).toEqual({
      success: true,
      data: value,
    });
  });

  test('契約に無い項目を除く', () => {
    expect(
      resultNoticeSupplementSchema.parse({
        ...supplement,
        html: '<b>強調</b>',
      }),
    ).toEqual(supplement);
  });

  test.each([
    ['空の見出し', { ...supplement, title: '' }],
    ['空白だけの見出し', { ...supplement, title: ' 　' }],
    ['51文字の見出し', { ...supplement, title: repeat(51) }],
    ['行の無い追記', { ...supplement, lines: [] }],
    [
      '6行の追記',
      { ...supplement, lines: Array.from({ length: 6 }, () => '行') },
    ],
    ['空の行', { ...supplement, lines: [''] }],
    ['201文字の行', { ...supplement, lines: [repeat(201)] }],
    [
      '31文字のボタンのラベル',
      { ...supplement, action: { ...supplement.action, label: repeat(31) } },
    ],
    [
      '空のボタンのラベル',
      { ...supplement, action: { ...supplement.action, label: '' } },
    ],
    [
      '相対URLのボタン',
      { ...supplement, action: { label: '確認する', url: '/tournaments' } },
    ],
    [
      'javascript:のボタン',
      {
        ...supplement,
        action: { label: '確認する', url: 'javascript:alert(1)' },
      },
    ],
    [
      'localhost以外へのhttp:のボタン',
      {
        ...supplement,
        action: { label: '確認する', url: 'http://launch.example/' },
      },
    ],
    ['強調の有無の欠落', { title: supplement.title, lines: supplement.lines }],
  ])('%sを拒否する', (_label, value) => {
    expect(resultNoticeSupplementSchema.safeParse(value).success).toBe(false);
  });
});

describe('createResultNoticeSupplementRegistry', () => {
  test('初版の空の登録口では、どの種別にも追記の提供元が無い', () => {
    const registry = createResultNoticeSupplementRegistry([]);

    expect(registry.providersFor('qualifier')).toEqual([]);
    expect(registry.providersFor('week')).toEqual([]);
    expect(registry.providersFor('year')).toEqual([]);
  });

  test('マッチの種別で絞り込み、同じ種別の中をorderの昇順に並べる', () => {
    const yearDeadline = registration({
      name: 'tournament-year.entry-deadline',
      kinds: ['qualifier', 'week'],
      order: 1700,
    });
    const weekDeadline = registration({
      name: 'tournament-week.entry-deadline',
      kinds: ['qualifier'],
      order: 1500,
    });
    const yearFinal = registration({
      name: 'tournament-year.final-notice',
      kinds: ['year'],
      order: 1700,
    });

    const registry = createResultNoticeSupplementRegistry([
      yearDeadline,
      weekDeadline,
      yearFinal,
    ]);

    expect(registry.providersFor('qualifier')).toEqual([
      weekDeadline,
      yearDeadline,
    ]);
    expect(registry.providersFor('week')).toEqual([yearDeadline]);
    expect(registry.providersFor('year')).toEqual([yearFinal]);
  });

  test('返す一覧は凍結されている', () => {
    const registry = createResultNoticeSupplementRegistry([registration()]);

    expect(Object.isFrozen(registry.providersFor('qualifier'))).toBe(true);
    expect(Object.isFrozen(registry.providersFor('week'))).toBe(true);
  });

  test.each([
    ['ピリオドの無い名前', 'tournament-week'],
    ['大文字を含む名前', 'Tournament-week.entry-deadline'],
    ['3つに区切った名前', 'tournament-week.entry.deadline'],
  ])('%sの登録を登録口の呼び名とともに拒否する', (_label, name) => {
    const register = (): unknown =>
      createResultNoticeSupplementRegistry([registration({ name })]);

    expect(register).toThrow(LifecycleRegistrationError);
    expect(register).toThrow(RESULT_NOTICE_SUPPLEMENT_PROVIDER_LABEL);
  });

  test('同じ名前の登録を拒否する', () => {
    expect(() =>
      createResultNoticeSupplementRegistry([
        registration({ kinds: ['qualifier'], order: 1500 }),
        registration({ kinds: ['week'], order: 1501 }),
      ]),
    ).toThrow('名前が重複しています');
  });

  test('同じ種別でorderが重複する登録を拒否する', () => {
    expect(() =>
      createResultNoticeSupplementRegistry([
        registration({ kinds: ['qualifier', 'week'], order: 1500 }),
        registration({
          name: 'tournament-year.entry-deadline',
          kinds: ['week'],
          order: 1500,
        }),
      ]),
    ).toThrow('orderが重複しています');
  });

  test('別の種別ならorderが同じ登録を受け付ける', () => {
    expect(() =>
      createResultNoticeSupplementRegistry([
        registration({ kinds: ['qualifier'], order: 1500 }),
        registration({
          name: 'tournament-year.entry-deadline',
          kinds: ['week'],
          order: 1500,
        }),
      ]),
    ).not.toThrow();
  });

  test.each([
    ['整数でないorder', registration({ order: 1500.5 })],
    ['種別を重ねて挙げた登録', registration({ kinds: ['week', 'week'] })],
  ])('%sを拒否する', (_label, invalid) => {
    expect(() => createResultNoticeSupplementRegistry([invalid])).toThrow(
      LifecycleRegistrationError,
    );
  });
});
