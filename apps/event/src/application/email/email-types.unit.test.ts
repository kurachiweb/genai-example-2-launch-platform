import { describe, expect, test } from 'bun:test';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { EVENT_EMAIL_TYPES } from './email-types.ts';

const EXPECTED_NAMES = [
  'EmailProvider',
  'EmailRenderer',
  'EmailIncidentReporter',
  'EmailRuntimeConfig',
  'SendEmailHandler',
  'DeliveryEventHandler',
] as const;

describe('EVENT_EMAIL_TYPES', () => {
  test('イベントサーバーだけが束縛する6種の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_EMAIL_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のemail.<名前>である',
    (name) => {
      expect<symbol>(EVENT_EMAIL_TYPES[name]).toBe(Symbol.for(`email.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(EVENT_EMAIL_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(EMAIL_TYPES));

    expect(
      Object.values(EVENT_EMAIL_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_EMAIL_TYPES)).toBe(true);
  });
});
