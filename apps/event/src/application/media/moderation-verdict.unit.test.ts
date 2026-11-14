import { describe, expect, test } from 'bun:test';

import {
  MODERATION_CATEGORIES,
  type ModerationConfig,
  parseModerationConfig,
} from './moderation-config.ts';
import { judgeLabels } from './moderation-verdict.ts';
import type { ModerationLabel } from './ports.ts';

const label = (
  name: string,
  parentName: string,
  confidence: number,
  taxonomyLevel: number,
): ModerationLabel => ({ name, parentName, confidence, taxonomyLevel });

const config = (
  blockedCategories: readonly string[],
  minConfidence = 60,
): ModerationConfig => ({ minConfidence, blockedCategories });

describe('judgeLabels', () => {
  test('空のラベルは問題なしになる', () => {
    expect(judgeLabels([], config(MODERATION_CATEGORIES))).toEqual({
      verdict: 'passed',
    });
  });

  test('最上位のカテゴリのラベルが閾値ちょうどなら不適切になる', () => {
    expect(
      judgeLabels([label('Explicit', '', 60, 1)], config(['Explicit'])),
    ).toEqual({
      verdict: 'flagged',
      findings: [
        {
          source: 'labels',
          category: 'Explicit',
          label: 'Explicit',
          confidence: 60,
        },
      ],
    });
  });

  test('閾値をわずかに下回るラベルは問題なしになる', () => {
    expect(
      judgeLabels([label('Explicit', '', 59.99, 1)], config(['Explicit'])),
    ).toEqual({ verdict: 'passed' });
  });

  test('下位のラベルは親をたどった最上位のカテゴリで判定する', () => {
    const labels = [
      label('Exposed Male Genitalia', 'Explicit Nudity', 91, 3),
      label('Explicit Nudity', 'Explicit', 92, 2),
      label('Explicit', '', 93, 1),
    ];

    expect(judgeLabels(labels, config(['Explicit']))).toEqual({
      verdict: 'flagged',
      findings: [
        {
          source: 'labels',
          category: 'Explicit',
          label: 'Exposed Male Genitalia',
          confidence: 91,
        },
        {
          source: 'labels',
          category: 'Explicit',
          label: 'Explicit Nudity',
          confidence: 92,
        },
        {
          source: 'labels',
          category: 'Explicit',
          label: 'Explicit',
          confidence: 93,
        },
      ],
    });
  });

  test('親のラベルが応答に無い場合は親の名前を最上位のカテゴリとみなす', () => {
    expect(
      judgeLabels(
        [label('Graphic Violence', 'Violence', 80, 2)],
        config(['Violence']),
      ),
    ).toEqual({
      verdict: 'flagged',
      findings: [
        {
          source: 'labels',
          category: 'Violence',
          label: 'Graphic Violence',
          confidence: 80,
        },
      ],
    });
  });

  test('設定外のカテゴリのラベルは信頼度が高くても問題なしになる', () => {
    const labels = [
      label('Beer', 'Alcoholic Beverages', 99, 3),
      label('Alcoholic Beverages', 'Alcohol', 99, 2),
      label('Alcohol', '', 99, 1),
    ];

    expect(judgeLabels(labels, config(['Explicit', 'Violence']))).toEqual({
      verdict: 'passed',
    });
  });

  test('設定内と設定外のカテゴリが混ざると設定内で閾値以上のラベルだけを検出内容にする', () => {
    const labels = [
      label('Alcohol', '', 99, 1),
      label('Weapon Violence', 'Violence', 70, 2),
      label('Violence', '', 50, 1),
    ];

    expect(judgeLabels(labels, config(['Violence']))).toEqual({
      verdict: 'flagged',
      findings: [
        {
          source: 'labels',
          category: 'Violence',
          label: 'Weapon Violence',
          confidence: 70,
        },
      ],
    });
  });

  test('親の参照が循環していても判定が終わる', () => {
    const labels = [label('A', 'B', 99, 2), label('B', 'A', 99, 2)];

    expect(judgeLabels(labels, config(MODERATION_CATEGORIES))).toEqual({
      verdict: 'passed',
    });
  });

  test.each(MODERATION_CATEGORIES)(
    '初期値(全カテゴリ・60)では%sのラベルが不適切になる',
    (category) => {
      const initial = parseModerationConfig({
        MODERATION_MIN_CONFIDENCE: '60',
        MODERATION_BLOCKED_CATEGORIES: MODERATION_CATEGORIES.join(','),
      });

      expect(
        judgeLabels([label(`${category}の下位`, category, 60, 2)], initial),
      ).toEqual({
        verdict: 'flagged',
        findings: [
          {
            source: 'labels',
            category,
            label: `${category}の下位`,
            confidence: 60,
          },
        ],
      });
    },
  );
});
