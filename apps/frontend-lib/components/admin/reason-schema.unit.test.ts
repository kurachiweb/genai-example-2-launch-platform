import { describe, expect, test } from 'bun:test';

import {
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
} from '../../utilities/messages/admin-console-messages.ts';
import { REASON_SCHEMAS } from './reason-schema.ts';

const FAMILY = '👨‍👩‍👧';

const issuesOf = (
  schema: (typeof REASON_SCHEMAS)[keyof typeof REASON_SCHEMAS],
  value: string,
): readonly string[] => {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(({ message }) => message);
};

describe('理由の検証規則', () => {
  describe('必須', () => {
    test.each(['', ' 　\t\n'])(
      '空と空白だけの入力(%j)は、入力を求める文言だけを示す',
      (value) => {
        expect(issuesOf(REASON_SCHEMAS.required, value)).toStrictEqual([
          REASON_REQUIRED_MESSAGE,
        ]);
      },
    );

    test('前後の空白を除いた値を出力する', () => {
      expect(REASON_SCHEMAS.required.parse('  誤った投稿の対応 \n')).toBe(
        '誤った投稿の対応',
      );
    });
  });

  describe('任意', () => {
    test.each(['', ' 　\t\n'])(
      '空と空白だけの入力(%j)は、受け付けて未入力として出力する',
      (value) => {
        expect(REASON_SCHEMAS.optional.parse(value)).toBeUndefined();
      },
    );

    test('前後の空白を除いた値を出力する', () => {
      expect(REASON_SCHEMAS.optional.parse('　定期の見直し ')).toBe(
        '定期の見直し',
      );
    });
  });

  describe.each(['required', 'optional'] as const)('%sの上限', (kind) => {
    test('結合した絵文字を1文字と数え、前後の空白を除いて500文字ちょうどまで受け付ける', () => {
      const value = ` ${FAMILY.repeat(500)} `;

      expect(issuesOf(REASON_SCHEMAS[kind], value)).toStrictEqual([]);
      expect(REASON_SCHEMAS[kind].parse(value)).toBe(FAMILY.repeat(500));
    });

    test('501文字は、上限の文言だけを示す', () => {
      expect(issuesOf(REASON_SCHEMAS[kind], 'あ'.repeat(501))).toStrictEqual([
        REASON_TOO_LONG_MESSAGE,
      ]);
    });
  });
});
