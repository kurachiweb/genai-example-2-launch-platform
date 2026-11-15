import { describe, expect, test } from 'bun:test';

import {
  checkHandleFormat,
  isReservedHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import {
  GENERATED_HANDLE_ALPHABET,
  GENERATED_HANDLE_LENGTH,
} from '../../domain/identity/handle.ts';
import { UserHandleAvailability } from './user-handle-availability.ts';
import {
  createFakeProfileStore,
  type FakeProfileStoreOptions,
} from './testing/profile-fakes.ts';

function setup(options: FakeProfileStoreOptions = {}) {
  const store = createFakeProfileStore([], options);
  return { availability: new UserHandleAvailability(store), store };
}

describe('登録時の初期ハンドルの形式と利用者のハンドルの規則', () => {
  test('初期ハンドルの長さと文字の一覧から作ったハンドルは、利用者のハンドルの形式を満たす', () => {
    const handles = [
      GENERATED_HANDLE_ALPHABET.slice(0, GENERATED_HANDLE_LENGTH),
      GENERATED_HANDLE_ALPHABET.slice(-GENERATED_HANDLE_LENGTH),
      GENERATED_HANDLE_ALPHABET[0]?.repeat(GENERATED_HANDLE_LENGTH),
      GENERATED_HANDLE_ALPHABET.at(-1)?.repeat(GENERATED_HANDLE_LENGTH),
    ];

    for (const handle of handles) {
      expect(handle).toHaveLength(GENERATED_HANDLE_LENGTH);
      expect(checkHandleFormat(handle ?? '', USER_HANDLE_RULE)).toBe('ok');
    }
  });

  test('文字の一覧のすべての文字が、先頭にも末尾にも置けるハンドルの文字である', () => {
    for (const character of GENERATED_HANDLE_ALPHABET) {
      const handle = `${character}${GENERATED_HANDLE_ALPHABET.slice(0, GENERATED_HANDLE_LENGTH - 2)}${character}`;

      expect(checkHandleFormat(handle, USER_HANDLE_RULE)).toBe('ok');
    }
  });

  test('初期ハンドルの長さは利用者のハンドルの上限に収まる', () => {
    expect(GENERATED_HANDLE_LENGTH).toBeLessThanOrEqual(
      USER_HANDLE_RULE.maxLength,
    );
  });

  test('予約語に初期ハンドルと同じ長さのものは無く、文字の一覧から作れるハンドルは予約語にならない', () => {
    const reservedLengths = USER_HANDLE_RULE.reservedWords.map(
      (word) => word.length,
    );

    expect(reservedLengths).not.toContain(GENERATED_HANDLE_LENGTH);
    expect(
      isReservedHandle(
        GENERATED_HANDLE_ALPHABET.slice(0, GENERATED_HANDLE_LENGTH),
        USER_HANDLE_RULE,
      ),
    ).toBe(false);
  });
});

describe('UserHandleAvailability.isAvailable', () => {
  test('誰も使っていないハンドルは使える。他人の旧ハンドルを含めて問い合わせる', async () => {
    const { availability, store } = setup();

    expect(await availability.isAvailable('abc123def456')).toBe(true);
    expect(store.occupiedQueries).toEqual([
      { handle: 'abc123def456', options: { includePrevious: true } },
    ]);
  });

  test('他人の現在のハンドルまたは旧ハンドルで使用中なら使えない', async () => {
    const { availability } = setup({ occupiedHandles: ['Taken0Handle'] });

    expect(await availability.isAvailable('taken0handle')).toBe(false);
  });

  test.each(['admin', 'ADMIN', 'Launch-Stadium', 'support'])(
    '予約語(%s)は、使用中の問い合わせをせずに使えない',
    async (handle) => {
      const { availability, store } = setup();

      expect(await availability.isAvailable(handle)).toBe(false);
      expect(store.occupiedQueries).toEqual([]);
    },
  );
});
