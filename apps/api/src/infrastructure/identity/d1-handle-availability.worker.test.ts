import { beforeEach, describe, expect, test } from 'vitest';

import {
  clearIdentityTables,
  db,
  insertUser,
  T0,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { HandleAvailability } from '../../application/identity/ports.ts';
import { D1HandleAvailability } from './d1-handle-availability.ts';

function createAvailability(): HandleAvailability {
  return new D1HandleAvailability(db);
}

beforeEach(async () => {
  await clearIdentityTables();
});

describe('D1HandleAvailability', () => {
  test('どの利用者も使っていないハンドルは使える', async () => {
    await insertUser(1, { handle: 'taken0handle' });

    expect(await createAvailability().isAvailable('free0handle1')).toBe(true);
  });

  test.each([
    { label: '有効', columns: {} },
    { label: '停止中', columns: { status: 'suspended' } },
    { label: '退会後に物理削除されていない', columns: { deletedAt: T0 } },
  ] as const)(
    '$labelの利用者が使うハンドルは、大文字小文字を区別せずに使えない',
    async ({ columns }) => {
      await insertUser(1, { handle: 'Taken0Handle', ...columns });

      const availability = createAvailability();

      expect(await availability.isAvailable('Taken0Handle')).toBe(false);
      expect(await availability.isAvailable('taken0handle')).toBe(false);
      expect(await availability.isAvailable('TAKEN0HANDLE')).toBe(false);
    },
  );
});
