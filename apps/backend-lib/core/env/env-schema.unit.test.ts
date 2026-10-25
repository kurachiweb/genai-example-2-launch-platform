import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { EnvValidationError, validateEnv } from './env-schema.ts';

const SECRET_PEPPER = 'pepper-value-must-not-leak';
const INVALID_LOG_LEVEL = 'verbose-value-must-not-leak';

const schema = z.object({
  HASH_PEPPER: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']),
  SENTRY_ENVIRONMENT: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
});

const validEnv = (): Record<string, unknown> => ({
  HASH_PEPPER: SECRET_PEPPER,
  LOG_LEVEL: 'info',
  SENTRY_ENVIRONMENT: 'local',
});

const captureEnvError = (
  targetSchema: z.ZodType,
  env: unknown,
): EnvValidationError => {
  try {
    validateEnv(targetSchema, env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('環境の検証が失敗しませんでした。');
};

describe('validateEnv', () => {
  test('検証に成功すると、スキーマで変換した環境を返す', () => {
    const env = validEnv();

    const result = validateEnv(schema, env);

    expect(result).toEqual({
      HASH_PEPPER: SECRET_PEPPER,
      LOG_LEVEL: 'info',
      SENTRY_ENVIRONMENT: 'local',
    });
  });

  test('欠けたキーと不正なキーの名前を分けて、名前順に重複なく列挙する', () => {
    const env = { LOG_LEVEL: INVALID_LOG_LEVEL, SENTRY_DSN: 42 };

    const error = captureEnvError(schema, env);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EnvValidationError');
    expect(error.missingKeys).toEqual(['HASH_PEPPER', 'SENTRY_ENVIRONMENT']);
    expect(error.invalidKeys).toEqual(['LOG_LEVEL', 'SENTRY_DSN']);
    expect(Object.isFrozen(error.missingKeys)).toBe(true);
    expect(Object.isFrozen(error.invalidKeys)).toBe(true);
  });

  test('値がundefinedのキーは欠けたキーとして扱う', () => {
    const env = { ...validEnv(), HASH_PEPPER: undefined };

    const error = captureEnvError(schema, env);

    expect(error.missingKeys).toEqual(['HASH_PEPPER']);
    expect(error.invalidKeys).toEqual([]);
  });

  test('失敗のメッセージはキー名だけを含む', () => {
    const env = { LOG_LEVEL: INVALID_LOG_LEVEL, SENTRY_ENVIRONMENT: 'local' };

    const error = captureEnvError(schema, env);

    expect(error.message).toContain('HASH_PEPPER');
    expect(error.message).toContain('LOG_LEVEL');
    expect(error.message).not.toContain(INVALID_LOG_LEVEL);
  });

  test('失敗は値もZodの入力値も保持しない', () => {
    const env = {
      HASH_PEPPER: SECRET_PEPPER,
      LOG_LEVEL: INVALID_LOG_LEVEL,
      SENTRY_ENVIRONMENT: 'local',
    };

    const error = captureEnvError(schema, env);

    expect(error.invalidKeys).toEqual(['LOG_LEVEL']);
    expect(error.cause).toBeUndefined();
    const serialized = [
      error.message,
      String(error.stack),
      JSON.stringify(error),
      Bun.inspect(error),
      ...Object.getOwnPropertyNames(error).map((property) =>
        Bun.inspect(Reflect.get(error, property)),
      ),
    ].join('\n');
    expect(serialized).not.toContain(SECRET_PEPPER);
    expect(serialized).not.toContain(INVALID_LOG_LEVEL);
  });

  test('厳密なスキーマが拒否した余分なキーを不正なキーとして列挙する', () => {
    const strictSchema = z.strictObject({ HASH_PEPPER: z.string() });
    const env = { HASH_PEPPER: SECRET_PEPPER, EXTRA_SECRET: 'extra-value' };

    const error = captureEnvError(strictSchema, env);

    expect(error.missingKeys).toEqual([]);
    expect(error.invalidKeys).toEqual(['EXTRA_SECRET']);
    expect(Bun.inspect(error)).not.toContain('extra-value');
  });

  test('環境がオブジェクトでなければ、キーを列挙せずに失敗する', () => {
    const error = captureEnvError(schema, undefined);

    expect(error.missingKeys).toEqual([]);
    expect(error.invalidKeys).toEqual([]);
  });

  test('同じ環境オブジェクトの2回目以降は検証せず、1回目の結果を返す', () => {
    let parseCount = 0;
    const countingSchema = schema.transform((value) => {
      parseCount += 1;
      return value;
    });
    const env = validEnv();

    const first = validateEnv(countingSchema, env);
    const second = validateEnv(countingSchema, env);

    expect(parseCount).toBe(1);
    expect(second).toBe(first);
  });

  test('別の環境オブジェクトは改めて検証する', () => {
    let parseCount = 0;
    const countingSchema = schema.transform((value) => {
      parseCount += 1;
      return value;
    });

    validateEnv(countingSchema, validEnv());
    validateEnv(countingSchema, validEnv());

    expect(parseCount).toBe(2);
  });

  test('同じ環境オブジェクトでも、別のスキーマでは改めて検証する', () => {
    const env = validEnv();
    validateEnv(schema, env);

    const error = captureEnvError(
      z.object({ TURNSTILE_SECRET_KEY: z.string() }),
      env,
    );

    expect(error.missingKeys).toEqual(['TURNSTILE_SECRET_KEY']);
  });

  test('失敗した結果は覚えず、同じ環境オブジェクトを次も検証する', () => {
    const env: Record<string, unknown> = { LOG_LEVEL: 'info' };
    captureEnvError(schema, env);

    env.HASH_PEPPER = SECRET_PEPPER;
    env.SENTRY_ENVIRONMENT = 'local';

    expect(validateEnv(schema, env)).toEqual({
      HASH_PEPPER: SECRET_PEPPER,
      LOG_LEVEL: 'info',
      SENTRY_ENVIRONMENT: 'local',
    });
  });
});

describe('EnvValidationError', () => {
  test('欠けたキーも不正なキーも無ければ、メッセージでその旨を示す', () => {
    const error = new EnvValidationError([], []);

    expect(error.missingKeys).toEqual([]);
    expect(error.invalidKeys).toEqual([]);
    expect(error.message).toContain('なし');
  });
});
