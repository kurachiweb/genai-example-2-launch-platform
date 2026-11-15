import { describe, expect, test } from 'bun:test';

import { decodeTime, isValid } from 'ulid';

import type { Clock } from '../time/clock.ts';
import { createUlidGenerator } from './id-generator.ts';

const FIXED_TIME = new Date('2026-10-25T08:00:00.000Z');

const fixedClock = (date: Date): Clock => ({
  now: () => new Date(date.getTime()),
});

const isStrictlyAscending = (values: readonly string[]): boolean =>
  values.every((value, index) => {
    const previous = values[index - 1];
    return previous === undefined || previous < value;
  });

describe('createUlidGenerator', () => {
  test('時計の時刻を時刻部に持つ26文字のULIDを採番する', () => {
    const generator = createUlidGenerator(fixedClock(FIXED_TIME));

    const id = generator.generate();

    expect(id).toHaveLength(26);
    expect(isValid(id)).toBe(true);
    expect(decodeTime(id)).toBe(FIXED_TIME.getTime());
  });

  test('同一ミリ秒に採番しても、採番した順に昇順で重複しない', () => {
    const generator = createUlidGenerator(fixedClock(FIXED_TIME));

    const ids = Array.from({ length: 1000 }, () => generator.generate());

    expect(isStrictlyAscending(ids)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => decodeTime(id) === FIXED_TIME.getTime())).toBe(
      true,
    );
  });

  test('時計が戻っても、直前のIDより大きいIDを採番する', () => {
    let current = FIXED_TIME.getTime();
    const generator = createUlidGenerator({ now: () => new Date(current) });
    const first = generator.generate();

    current -= 1000;
    const second = generator.generate();

    expect(second > first).toBe(true);
  });

  test('時刻が進めば、新しい時刻を時刻部に持つIDを採番する', () => {
    let current = FIXED_TIME.getTime();
    const generator = createUlidGenerator({ now: () => new Date(current) });
    const first = generator.generate();

    current += 1;
    const second = generator.generate();

    expect(second > first).toBe(true);
    expect(decodeTime(second)).toBe(FIXED_TIME.getTime() + 1);
  });
});
