import { describe, expect, test } from 'bun:test';

import { z } from './zod.ts';

describe('z', () => {
  test('読み込んだ時点でZodのJITを止める設定を済ませている', () => {
    expect(z.config().jitless).toBe(true);
  });

  test('スキーマを作って検証できる', () => {
    const schema = z.object({ name: z.string() });

    expect(schema.safeParse({ name: 'a' }).success).toBe(true);
    expect(schema.safeParse({ name: 1 }).success).toBe(false);
  });
});
