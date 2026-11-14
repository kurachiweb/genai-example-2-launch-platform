import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailCleanupCursors } from '../../../db/schema/email/email-cleanup-cursors.ts';
import { createCleanupCursorRepository } from './cleanup-cursor-repository.ts';

const NAME = 'email-delivery.unlinked-suppressions';

const NOW = new Date('2026-10-27T03:04:05.678Z');
const LATER = new Date(NOW.getTime() + 86_400_000);

const db = createDatabase(env.DB);

async function readRows() {
  return db
    .select({
      name: emailCleanupCursors.name,
      afterKey: emailCleanupCursors.afterKey,
      createdAt: emailCleanupCursors.createdAt,
      updatedAt: emailCleanupCursors.updatedAt,
    })
    .from(emailCleanupCursors)
    .orderBy(emailCleanupCursors.name);
}

beforeEach(async () => {
  await db.delete(emailCleanupCursors);
});

describe('createCleanupCursorRepository', () => {
  describe('read', () => {
    test('保存していない名前では、先頭から確かめることを表すundefinedを返す', async () => {
      const cursors = createCleanupCursorRepository(db);

      expect(await cursors.read(NAME)).toBeUndefined();
    });

    test('先頭に戻した位置はundefinedとして読み出す', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'middle@recipient.example', NOW);
      await cursors.save(NAME, undefined, LATER);

      expect(await cursors.read(NAME)).toBeUndefined();
    });
  });

  describe('save', () => {
    test('初めての名前では、位置と作成・更新日時を与えた時刻にした行を作る', async () => {
      const cursors = createCleanupCursorRepository(db);

      await cursors.save(NAME, 'middle@recipient.example', NOW);

      expect(await cursors.read(NAME)).toBe('middle@recipient.example');
      expect(await readRows()).toEqual([
        {
          name: NAME,
          afterKey: 'middle@recipient.example',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      const [row] = await db.select().from(emailCleanupCursors);
      expect(row?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    test('同じ名前に保存し直すと、1行のまま位置と更新日時を改め、作成日時を保つ', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'middle@recipient.example', NOW);

      await cursors.save(NAME, 'tail@recipient.example', LATER);

      expect(await readRows()).toEqual([
        {
          name: NAME,
          afterKey: 'tail@recipient.example',
          createdAt: NOW,
          updatedAt: LATER,
        },
      ]);
    });

    test('先頭に戻すと位置をNULLにする', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'middle@recipient.example', NOW);

      await cursors.save(NAME, undefined, LATER);

      expect(await readRows()).toEqual([
        { name: NAME, afterKey: null, createdAt: NOW, updatedAt: LATER },
      ]);
    });

    test('大文字小文字だけ違う名前は同じ位置として扱い、異なる名前の位置は互いに影響しない', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'middle@recipient.example', NOW);
      await cursors.save('email-other.cleanup', 'other@recipient.example', NOW);

      await cursors.save(
        'Email-Delivery.Unlinked-Suppressions',
        'tail@recipient.example',
        LATER,
      );

      expect(await cursors.read(NAME)).toBe('tail@recipient.example');
      expect(await cursors.read('email-other.cleanup')).toBe(
        'other@recipient.example',
      );
      expect(await readRows()).toHaveLength(2);
    });

    test('同じ名前へ同時に保存しても、行は1つだけになる', async () => {
      const cursors = createCleanupCursorRepository(db);

      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          cursors.save(NAME, `key-${String(index)}@recipient.example`, NOW),
        ),
      );

      expect(await readRows()).toHaveLength(1);
    });
  });

  describe('resetIfAt', () => {
    test('位置が与えた照合キーと同じなら位置の行を消し、次の読み出しは先頭からになる', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'leaving@recipient.example', NOW);

      await cursors.resetIfAt(NAME, 'leaving@recipient.example');

      expect(await readRows()).toEqual([]);
      expect(await cursors.read(NAME)).toBeUndefined();
    });

    test('大文字小文字だけ違う照合キーでも位置の行を消す', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'leaving@recipient.example', NOW);

      await cursors.resetIfAt(NAME, 'Leaving@Recipient.Example');

      expect(await readRows()).toEqual([]);
    });

    test('位置が違う照合キーなら、位置と更新日時を変えない', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(NAME, 'middle@recipient.example', NOW);

      await cursors.resetIfAt(NAME, 'leaving@recipient.example');

      expect(await readRows()).toEqual([
        {
          name: NAME,
          afterKey: 'middle@recipient.example',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
    });

    test('位置の行が無い、または先頭を指す場合も成功し、行を作らない', async () => {
      const cursors = createCleanupCursorRepository(db);

      await expect(
        cursors.resetIfAt(NAME, 'leaving@recipient.example'),
      ).resolves.toBeUndefined();
      expect(await readRows()).toEqual([]);

      await cursors.save(NAME, undefined, NOW);
      await cursors.resetIfAt(NAME, 'leaving@recipient.example');

      expect(await readRows()).toEqual([
        { name: NAME, afterKey: null, createdAt: NOW, updatedAt: NOW },
      ]);
    });

    test('異なる名前の位置は、同じ照合キーでも消さない', async () => {
      const cursors = createCleanupCursorRepository(db);
      await cursors.save(
        'email-other.cleanup',
        'leaving@recipient.example',
        NOW,
      );

      await cursors.resetIfAt(NAME, 'leaving@recipient.example');

      expect(await cursors.read('email-other.cleanup')).toBe(
        'leaving@recipient.example',
      );
    });
  });
});
