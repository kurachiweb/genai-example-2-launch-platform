import type { ErrorEvent, Exception } from '@sentry/core';
import { resetSync } from '@logtape/logtape';
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { REDACTED } from '../../core/logging/redaction.ts';
import { scrubEvent } from '../../core/observability/scrub-event.ts';
import { ensureLoggingConfigured } from './configure-logging.ts';

const PROBE_TABLE = 'query_error_redaction_probe';
const INSERT_QUERY = `insert into "${PROBE_TABLE}" ("body") values (?)`;
const USER_INPUT =
  '検索語の入力\n本文の2行目\n    at 本文に書いたフレームの形の行';
const USER_INPUT_FRAGMENTS = ['検索語', '本文'];

const logger = getAppLogger(['api', 'application', 'query-error-test']);

type Database = Pick<DrizzleD1Database, 'run'>;

async function insertProbe(db: Database): Promise<void> {
  await db.run(
    sql`insert into ${sql.identifier(PROBE_TABLE)} ("body") values (${USER_INPUT})`,
  );
}

// 一意制約の違反で、利用者の入力に見立てた値をバインドした単文のクエリを失敗させる
async function failedInsert(db: Database): Promise<Error> {
  await insertProbe(db);
  try {
    await insertProbe(db);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('一意制約の違反が起きませんでした');
}

function errorChain(error: unknown): Error[] {
  return error instanceof Error ? [error, ...errorChain(error.cause)] : [];
}

// Sentryは例外と原因の連鎖を、種類(name)と値(message)の組として送る
function errorEventOf(error: Error): ErrorEvent {
  const values: Exception[] = errorChain(error).map(({ name, message }) => ({
    type: name,
    value: message,
  }));
  return { type: undefined, exception: { values } };
}

function expectNoUserInput(output: string): void {
  for (const fragment of USER_INPUT_FRAGMENTS) {
    expect(output).not.toContain(fragment);
  }
}

beforeAll(async () => {
  await env.DB.prepare(
    `create table if not exists "${PROBE_TABLE}" ("body" text not null unique)`,
  ).run();
});

afterAll(async () => {
  resetSync();
  await env.DB.prepare(`drop table if exists "${PROBE_TABLE}"`).run();
});

describe('データベースのクエリの失敗の例外の伏せ字', () => {
  test('既定のデータベースの接続では、失敗の例外の文言にバインドした値を含めない', async () => {
    await env.DB.prepare(`delete from "${PROBE_TABLE}"`).run();

    const error = await failedInsert(createDatabase(env.DB));

    expect(error.name).toBe('DrizzleQueryError');
    expect(error.message).toBe(`Failed query: ${INSERT_QUERY}`);
    expectNoUserInput(error.stack ?? '');
  });

  test('バインドした値を文言に含める設定でも、ログとエラーイベントには値を残さず、SQL文とフレームは残す', async () => {
    await env.DB.prepare(`delete from "${PROBE_TABLE}"`).run();
    const error = await failedInsert(drizzle(env.DB, { paramsInErrors: true }));
    const redactedMessage = `Failed query: ${INSERT_QUERY}\nparams: ${REDACTED}`;
    const outputs: unknown[] = [];
    const recorder = {
      error: (...args: unknown[]) => {
        outputs.push(...args);
      },
    };
    ensureLoggingConfigured({
      appName: 'api',
      level: 'info',
      console: recorder as unknown as Console,
    });

    logger.error('操作の実行に失敗しました: {failure}', {
      error: new Error('操作の実行に失敗しました', { cause: error }),
      failure: error,
    });
    const scrubbed = scrubEvent(errorEventOf(error), {
      originalException: error,
    });

    expect(error.name).toBe('DrizzleQueryError');
    expect(error.message).toContain(USER_INPUT);
    expect(outputs).toHaveLength(1);
    const [logged] = outputs as [Record<string, unknown>];
    const failure = logged.failure as Readonly<Record<string, string>>;
    expect(failure.name).toBe('DrizzleQueryError');
    expect(failure.message).toBe(redactedMessage);
    expect(failure.stack).toContain(`${redactedMessage}\n    at `);
    expect(logged.error).toMatchObject({
      cause: { message: redactedMessage },
    });
    expect(logged.message).toContain(redactedMessage);
    expectNoUserInput(JSON.stringify(logged));
    expect(scrubbed?.exception?.values?.[0]).toStrictEqual({
      type: 'DrizzleQueryError',
      value: redactedMessage,
    });
    expectNoUserInput(JSON.stringify(scrubbed));
  });
});
