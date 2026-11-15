import { describe, expect, test } from 'bun:test';

import type { ServiceIdentifier } from 'inversify';

import {
  assertUltrasActivationHandlerName,
  createUltrasActivationRegistry,
  type UltrasActivationHandler,
  type UltrasActivationHandlerRegistration,
  UltrasActivationRegistrationError,
} from './activation-contract.ts';

function handlerId(name: string): ServiceIdentifier<UltrasActivationHandler> {
  return Symbol.for(`test.${name}`);
}

function registration(
  name: string,
  order: number,
): UltrasActivationHandlerRegistration {
  return { name, order, handler: handlerId(name) };
}

describe('assertUltrasActivationHandlerName', () => {
  test.each([
    'tournament-week.open-entry-checkout-expiry',
    'tournament-year.entry-grant',
    'ultras-subscription.noop',
    'tournament-week2.cleanup',
  ])('%sを受け付ける', (name) => {
    expect(() => {
      assertUltrasActivationHandlerName(name);
    }).not.toThrow();
  });

  test.each([
    ['空の名前', ''],
    ['ドットの無い名前', 'tournament-week'],
    ['ドットが2つの名前', 'a.b.c'],
    ['大文字だけの名前', 'Ultras'],
    ['spec名が空の名前', '.open-entry-checkout-expiry'],
    ['名詞句が空の名前', 'tournament-week.'],
    ['大文字を含む名前', 'Tournament-week.open-entry-checkout-expiry'],
    ['アンダースコアを含む名前', 'tournament_week.open-entry-checkout-expiry'],
    ['ハイフンが連続する名前', 'tournament--week.open-entry-checkout-expiry'],
    ['ハイフンで終わる部分を持つ名前', 'tournament-week.open-entry-'],
    ['ハイフンで始まる部分を持つ名前', 'tournament-week.-open-entry'],
    ['数字で始まる部分を持つ名前', 'tournament-week.1open-entry'],
    ['空白を含む名前', 'tournament-week.open entry'],
  ])('%sを拒否する', (_label, name) => {
    expect(() => {
      assertUltrasActivationHandlerName(name);
    }).toThrow(UltrasActivationRegistrationError);
  });
});

describe('createUltrasActivationRegistry', () => {
  test('登録の順ではなくorderの昇順で返す', () => {
    const year = registration('tournament-year.entry-grant', 300);
    const week = registration(
      'tournament-week.open-entry-checkout-expiry',
      100,
    );
    const yearExpiry = registration(
      'tournament-year.open-entry-checkout-expiry',
      200,
    );

    expect(createUltrasActivationRegistry([year, week, yearExpiry])).toEqual([
      week,
      yearExpiry,
      year,
    ]);
  });

  test('負のorderや0のorderも整数なら受け付け、昇順に並べる', () => {
    const zero = registration('tournament-week.zero', 0);
    const negative = registration('tournament-week.negative', -10);
    const positive = registration('tournament-week.positive', 100);

    expect(createUltrasActivationRegistry([zero, positive, negative])).toEqual([
      negative,
      zero,
      positive,
    ]);
  });

  test('登録が無ければ空の並びを返す', () => {
    const registry = createUltrasActivationRegistry([]);

    expect(registry).toEqual([]);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  test('返す並びは凍結されていて実行時に変えられない', () => {
    expect(
      Object.isFrozen(
        createUltrasActivationRegistry([
          registration('tournament-week.open-entry-checkout-expiry', 100),
        ]),
      ),
    ).toBe(true);
  });

  test('渡した登録の並びを変えない', () => {
    const input = [
      registration('tournament-year.entry-grant', 300),
      registration('tournament-week.open-entry-checkout-expiry', 100),
    ];
    const snapshot = [...input];

    createUltrasActivationRegistry(input);

    expect(input).toEqual(snapshot);
  });

  test('名前が<spec名>.<名詞句>の形でない登録を拒否する', () => {
    expect(() =>
      createUltrasActivationRegistry([registration('Ultras', 100)]),
    ).toThrow(UltrasActivationRegistrationError);
  });

  test('名前が重複する登録を、orderが異なっていても拒否する', () => {
    expect(() =>
      createUltrasActivationRegistry([
        registration('tournament-week.open-entry-checkout-expiry', 100),
        registration('tournament-week.open-entry-checkout-expiry', 200),
      ]),
    ).toThrow(
      new UltrasActivationRegistrationError(
        '加入の知らせの処理の名前が重複しています: "tournament-week.open-entry-checkout-expiry"',
      ),
    );
  });

  test('orderが重複する登録を拒否する', () => {
    expect(() =>
      createUltrasActivationRegistry([
        registration('tournament-week.open-entry-checkout-expiry', 100),
        registration('tournament-year.entry-grant', 100),
      ]),
    ).toThrow(
      new UltrasActivationRegistrationError(
        '加入の知らせの処理"tournament-week.open-entry-checkout-expiry"と"tournament-year.entry-grant"のorderが重複しています: 100',
      ),
    );
  });

  test.each([
    ['小数', 1.5],
    ['非数', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
  ])('orderが%sの登録を拒否する', (_label, order) => {
    expect(() =>
      createUltrasActivationRegistry([
        registration('tournament-week.open-entry-checkout-expiry', order),
      ]),
    ).toThrow(UltrasActivationRegistrationError);
  });

  test('エラーの名前はUltrasActivationRegistrationErrorである', () => {
    expect(new UltrasActivationRegistrationError('x').name).toBe(
      'UltrasActivationRegistrationError',
    );
  });
});
