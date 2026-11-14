import { describe, expect, test } from 'bun:test';
import type { ServiceIdentifier } from 'inversify';

import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  assertItemMetricRegistrations,
  type DirectoryItemMetricRegistration,
  type DirectoryItemMetricSource,
  resolveItemMetricSources,
} from './item-metric-sources.ts';

const registration = (
  key: string,
  name: string,
  order: number,
): DirectoryItemMetricRegistration => ({
  key,
  name,
  order,
  source: Symbol.for(`test.${name}`),
});

const sourceOf = (value: number): DirectoryItemMetricSource => ({
  metrics: ({ productIds }) =>
    Promise.resolve(new Map(productIds.map((id) => [id, value]))),
});

describe('assertItemMetricRegistrations', () => {
  test('空の登録と、形式どおりで重複の無い登録を受け付ける', () => {
    expect(() => {
      assertItemMetricRegistrations([]);
    }).not.toThrow();
    expect(() => {
      assertItemMetricRegistrations([
        registration('comments', 'engagement.comment-count', 10),
        registration('review-score', 'engagement.review-score', 20),
      ]);
    }).not.toThrow();
  });

  test.each([
    ['名前の形式の違反', [registration('comments', 'comments', 10)]],
    [
      '名前の重複',
      [
        registration('comments', 'engagement.comment-count', 10),
        registration('reviews', 'engagement.comment-count', 20),
      ],
    ],
    [
      'orderの重複',
      [
        registration('comments', 'engagement.comment-count', 10),
        registration('reviews', 'engagement.review-count', 10),
      ],
    ],
    ['整数でないorder', [registration('comments', 'engagement.count', 1.5)]],
  ])('%sを登録口の呼び名を添えて拒否する', (_label, registrations) => {
    expect(() => {
      assertItemMetricRegistrations(registrations);
    }).toThrow(LifecycleRegistrationError);
    expect(() => {
      assertItemMetricRegistrations(registrations);
    }).toThrow('一覧の項目の値の供給元');
  });

  test('同じkeyの登録を拒否する', () => {
    expect(() => {
      assertItemMetricRegistrations([
        registration('comments', 'engagement.comment-count', 10),
        registration('comments', 'forum.comment-count', 20),
      ]);
    }).toThrow(
      new LifecycleRegistrationError(
        '一覧の項目の値の供給元"engagement.comment-count"と"forum.comment-count"のkeyが重複しています: "comments"',
      ),
    );
  });

  test.each(['', 'Comments', 'comment_count', '1comments', 'comments-'])(
    '小文字の英数字とハイフンの形でないkey%pを拒否する',
    (key) => {
      expect(() => {
        assertItemMetricRegistrations([
          registration(key, 'engagement.comment-count', 10),
        ]);
      }).toThrow(LifecycleRegistrationError);
    },
  );
});

describe('resolveItemMetricSources', () => {
  test('登録の識別子を解決し、orderの小さい順に名前・key・供給元を並べる', () => {
    const comments = sourceOf(3);
    const reviews = sourceOf(5);
    const sources = new Map<ServiceIdentifier, DirectoryItemMetricSource>([
      [Symbol.for('test.engagement.comment-count'), comments],
      [Symbol.for('test.engagement.review-count'), reviews],
    ]);

    const resolved = resolveItemMetricSources(
      [
        registration('reviews', 'engagement.review-count', 20),
        registration('comments', 'engagement.comment-count', 10),
      ],
      (identifier) => {
        const source = sources.get(identifier);
        if (source === undefined) {
          throw new Error('未登録の識別子');
        }
        return source;
      },
    );

    expect(resolved).toStrictEqual([
      { name: 'engagement.comment-count', key: 'comments', source: comments },
      { name: 'engagement.review-count', key: 'reviews', source: reviews },
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  test('登録が規則に反していれば、識別子を解決せずに拒否する', () => {
    const resolved: ServiceIdentifier[] = [];

    expect(() =>
      resolveItemMetricSources(
        [
          registration('comments', 'engagement.comment-count', 10),
          registration('comments', 'forum.comment-count', 20),
        ],
        (identifier) => {
          resolved.push(identifier);
          return sourceOf(0);
        },
      ),
    ).toThrow(LifecycleRegistrationError);
    expect(resolved).toStrictEqual([]);
  });
});
