import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { GuardedBatch, GuardedStatement } from './statement-contracts.ts';

// D1は`D1_ERROR: NOT NULL constraint failed: <テーブル>.<列>: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ。文の組み立ての失敗はDrizzleQueryErrorが包む
const NOT_NULL_VIOLATION_PATTERN =
  /NOT NULL constraint failed: ([a-z_]+\.[a-z_]+)(?::|$)/u;

const CONSTRAINT_VIOLATION_PATTERN = /SQLITE_CONSTRAINT|constraint failed/u;

function messagesOf(error: unknown): string[] {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages;
}

function violatesNotNull(error: unknown, column: string): boolean {
  return messagesOf(error).some(
    (message) => NOT_NULL_VIOLATION_PATTERN.exec(message)?.[1] === column,
  );
}

function violatesConstraint(error: unknown): boolean {
  return messagesOf(error).some((message) =>
    CONSTRAINT_VIOLATION_PATTERN.test(message),
  );
}

@injectable()
export class D1GuardedBatch implements GuardedBatch {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async run(input: {
    readonly guarded: GuardedStatement;
    readonly rest: readonly BatchItem<'sqlite'>[];
  }): Promise<'committed' | 'guard_failed' | 'constraint_failed'> {
    try {
      await this.db.batch([input.guarded.statement, ...input.rest]);
      return 'committed';
    } catch (error) {
      if (violatesNotNull(error, input.guarded.guardColumn)) {
        return 'guard_failed';
      }
      if (violatesConstraint(error)) {
        return 'constraint_failed';
      }
      throw error;
    }
  }
}
