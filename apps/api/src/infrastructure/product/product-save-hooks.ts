import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import {
  assertLifecycleHandlerName,
  LifecycleRegistrationError,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';

export interface ProductSaveStatementsInput {
  readonly productId: string;
  readonly at: Date;
}

export interface ProductSaveAfterCommitInput {
  readonly productId: string;
}

// 保存と同じ一括の書き込みに入る文を返す。読み取りはしてよいが、書き込みは返す文だけで行い、プロダクトIDを条件にした更新か挿入にする
export interface ProductSaveHook {
  statementsFor(
    input: ProductSaveStatementsInput,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
  // 確定の後に呼ぶ。失敗は保存を失敗させないため、後続の処理で回復できるよう冪等にする
  afterCommit(input: ProductSaveAfterCommitInput): Promise<void>;
}

export interface ProductSaveHookRegistration {
  // <spec名>.<名詞句>
  readonly name: string;
  readonly hook: ServiceIdentifier<ProductSaveHook>;
}

export interface ProductSaveHooks {
  statementsFor(
    input: ProductSaveStatementsInput,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
  runAfterCommit(input: ProductSaveAfterCommitInput): Promise<void>;
}

interface ResolvedProductSaveHook {
  readonly name: string;
  readonly hook: ProductSaveHook;
}

const PRODUCT_SAVE_HOOK_LABEL = 'プロダクトの保存の処理';

const logger = getAppLogger(['api', 'infrastructure', 'product']);

function assertRegistrations(
  registrations: readonly ProductSaveHookRegistration[],
): void {
  const names = new Set<string>();
  for (const { name } of registrations) {
    assertLifecycleHandlerName(name, PRODUCT_SAVE_HOOK_LABEL);
    if (names.has(name)) {
      throw new LifecycleRegistrationError(
        `${PRODUCT_SAVE_HOOK_LABEL}の名前が重複しています: ${JSON.stringify(name)}`,
      );
    }
    names.add(name);
  }
}

async function runOne(
  { name, hook }: ResolvedProductSaveHook,
  input: ProductSaveAfterCommitInput,
): Promise<void> {
  try {
    await hook.afterCommit(input);
  } catch {
    // 処理の例外は後続specの内部の値を含み得るため、処理の名前とプロダクトのIDだけを残す
    logger.warning('プロダクトの保存の確定の後の処理に失敗しました', {
      hookName: name,
      productId: input.productId,
    });
  }
}

export function createProductSaveHooks(
  registrations: readonly ProductSaveHookRegistration[],
  resolve: <T>(identifier: ServiceIdentifier<T>) => T,
): ProductSaveHooks {
  assertRegistrations(registrations);
  const hooks: readonly ResolvedProductSaveHook[] = Object.freeze(
    registrations.map(({ name, hook }) =>
      Object.freeze({ name, hook: resolve<ProductSaveHook>(hook) }),
    ),
  );

  return Object.freeze({
    async statementsFor(input: ProductSaveStatementsInput, db: Database) {
      const statements = await Promise.all(
        hooks.map(async ({ hook }) => hook.statementsFor(input, db)),
      );
      return statements.flat();
    },
    async runAfterCommit(input: ProductSaveAfterCommitInput) {
      for (const hook of hooks) {
        await runOne(hook, input);
      }
    },
  });
}
