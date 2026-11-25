import { describe, expect, test } from 'bun:test';

import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  assertTrophySourceRegistrations,
  resolveTrophySources,
  type TrophySource,
  type TrophySourceRegistration,
} from './trophy-source.ts';

const registration = (
  name: string,
  order: number,
): TrophySourceRegistration => ({
  name,
  order,
  source: Symbol.for(`test.${name}`),
});

const sourceOf = (): TrophySource => ({
  listTrophies: () => Promise.resolve([]),
});

describe('assertTrophySourceRegistrations', () => {
  test('空の登録と、形式どおりで重複の無い登録を受け付ける', () => {
    expect(() => {
      assertTrophySourceRegistrations([]);
    }).not.toThrow();
    expect(() => {
      assertTrophySourceRegistrations([
        registration('tournament-year.year-trophies', 10),
        registration('tournament-week.week-trophies', 20),
      ]);
    }).not.toThrow();
  });

  test('名前が<spec名>.<名詞句>の形でなければ、トロフィーの供給元の登録の誤りとして拒否する', () => {
    expect(() => {
      assertTrophySourceRegistrations([registration('week-trophies', 20)]);
    }).toThrow(
      new LifecycleRegistrationError(
        'トロフィーの供給元の名前は<spec名>.<名詞句>の形で指定してください: "week-trophies"',
      ),
    );
  });

  test('同じ名前の登録を拒否する', () => {
    expect(() => {
      assertTrophySourceRegistrations([
        registration('tournament-week.week-trophies', 10),
        registration('tournament-week.week-trophies', 20),
      ]);
    }).toThrow(
      new LifecycleRegistrationError(
        'トロフィーの供給元の名前が重複しています: "tournament-week.week-trophies"',
      ),
    );
  });

  test('同じorderの登録を拒否する', () => {
    expect(() => {
      assertTrophySourceRegistrations([
        registration('tournament-week.week-trophies', 20),
        registration('tournament-year.year-trophies', 20),
      ]);
    }).toThrow(
      new LifecycleRegistrationError(
        'トロフィーの供給元"tournament-week.week-trophies"と"tournament-year.year-trophies"のorderが重複しています: 20',
      ),
    );
  });

  test('整数でないorderを拒否する', () => {
    expect(() => {
      assertTrophySourceRegistrations([
        registration('tournament-week.week-trophies', 1.5),
      ]);
    }).toThrow(LifecycleRegistrationError);
  });
});

describe('resolveTrophySources', () => {
  test('orderの昇順に並べ、識別子を解決した供給元を名前と組にする', () => {
    const week = sourceOf();
    const year = sourceOf();
    const byIdentifier = new Map<symbol, TrophySource>([
      [Symbol.for('test.tournament-week.week-trophies'), week],
      [Symbol.for('test.tournament-year.year-trophies'), year],
    ]);

    const resolved = resolveTrophySources(
      [
        registration('tournament-week.week-trophies', 20),
        registration('tournament-year.year-trophies', 10),
      ],
      (identifier) => {
        const source =
          typeof identifier === 'symbol'
            ? byIdentifier.get(identifier)
            : undefined;
        if (source === undefined) {
          throw new Error('登録に無い識別子');
        }
        return source;
      },
    );

    expect(resolved).toStrictEqual([
      { name: 'tournament-year.year-trophies', source: year },
      { name: 'tournament-week.week-trophies', source: week },
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  test('登録に誤りがあれば識別子を解決せずに拒否する', () => {
    const resolved: unknown[] = [];

    expect(() =>
      resolveTrophySources(
        [
          registration('tournament-week.week-trophies', 20),
          registration('tournament-week.week-trophies', 30),
        ],
        (identifier) => {
          resolved.push(identifier);
          return sourceOf();
        },
      ),
    ).toThrow(LifecycleRegistrationError);
    expect(resolved).toStrictEqual([]);
  });
});
