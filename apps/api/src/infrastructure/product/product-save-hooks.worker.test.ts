import { resetSync } from '@logtape/logtape';
import { eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { products } from '../../../db/schema/product/products.ts';
import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  after,
  clearProductTables,
  db,
  insertProduct,
  insertUser,
  productIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../../test/support/observability-recording.ts';
import {
  createProductSaveHooks,
  type ProductSaveHook,
  type ProductSaveHookRegistration,
} from './product-save-hooks.ts';

const SAVE_HOOKS_CATEGORY = 'api.infrastructure.product';

const PRODUCT = 1;

const OWNER = 1;

const AT = after(60_000);

const SECRET_DETAIL = '後続specの内部の値';

interface HookCall {
  readonly name: string;
  readonly phase: 'statements' | 'after-commit';
  readonly input: unknown;
  readonly db?: Database;
}

// 呼び出しを記録し、プロダクトの名称の末尾に自分の印を足す文を返す偽の保存の処理
function recordingHook(
  name: string,
  mark: string,
  calls: HookCall[],
): ProductSaveHook {
  return {
    statementsFor: (input, database) => {
      calls.push({ name, phase: 'statements', input, db: database });
      const statements: BatchItem<'sqlite'>[] = [
        database
          .update(products)
          .set({ name: sql`${products.name} || ${mark}` })
          .where(eq(products.id, input.productId)),
      ];
      return Promise.resolve(statements);
    },
    afterCommit: (input) => {
      calls.push({ name, phase: 'after-commit', input });
      return Promise.resolve();
    },
  };
}

function failingAfterCommitHook(
  name: string,
  calls: HookCall[],
): ProductSaveHook {
  return {
    statementsFor: () => Promise.resolve([]),
    afterCommit: (input) => {
      calls.push({ name, phase: 'after-commit', input });
      return Promise.reject(new Error(SECRET_DETAIL));
    },
  };
}

function hookIdentifier(name: string): ServiceIdentifier<ProductSaveHook> {
  return Symbol.for(`test.product-save-hook.${name}`);
}

function registrationOf(name: string): ProductSaveHookRegistration {
  return { name, hook: hookIdentifier(name) };
}

function resolverOf(hooks: Readonly<Record<string, ProductSaveHook>>) {
  const byIdentifier = new Map<unknown, ProductSaveHook>(
    Object.entries(hooks).map(([name, hook]) => [hookIdentifier(name), hook]),
  );
  return <T>(identifier: ServiceIdentifier<T>): T => {
    const hook = byIdentifier.get(identifier);
    if (hook === undefined) {
      throw new Error('未登録の識別子です');
    }
    return hook as T;
  };
}

function saveHookLogs(logs: readonly LoggedObject[]): LoggedObject[] {
  return logs.filter((log) => log.category === SAVE_HOOKS_CATEGORY);
}

async function readProductName(): Promise<string | undefined> {
  const [row] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productIdOf(PRODUCT)));
  return row?.name;
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER);
  await insertProduct(PRODUCT, OWNER, { name: '名称' });
});

afterEach(() => {
  resetSync();
});

describe('createProductSaveHooks', () => {
  test('登録が無ければ文を返さず、確定の後の処理も何もしない', async () => {
    const hooks = createProductSaveHooks([], resolverOf({}));

    await expect(
      hooks.statementsFor({ productId: productIdOf(PRODUCT), at: AT }, db),
    ).resolves.toStrictEqual([]);
    await expect(
      hooks.runAfterCommit({ productId: productIdOf(PRODUCT) }),
    ).resolves.toBeUndefined();
  });

  test.each([
    ['区切りの無い名前', 'product-index-refresh'],
    ['大文字を含む名前', 'Directory-discovery.product-index-refresh'],
    ['名詞句が空の名前', 'directory-discovery.'],
  ])('%sの登録は保存の処理の呼び名を付けた例外になる', (_case, name) => {
    expect(() =>
      createProductSaveHooks([registrationOf(name)], resolverOf({})),
    ).toThrow(
      new LifecycleRegistrationError(
        `プロダクトの保存の処理の名前は<spec名>.<名詞句>の形で指定してください: ${JSON.stringify(name)}`,
      ),
    );
  });

  test('同じ名前の2つの登録は重複の例外になる', () => {
    const name = 'directory-discovery.product-index-refresh';

    expect(() =>
      createProductSaveHooks(
        [registrationOf(name), registrationOf(name)],
        resolverOf({}),
      ),
    ).toThrow(
      new LifecycleRegistrationError(
        `プロダクトの保存の処理の名前が重複しています: ${JSON.stringify(name)}`,
      ),
    );
  });

  test('各処理に保存の入力と接続を渡し、同時の文を登録の順に連結する', async () => {
    const calls: HookCall[] = [];
    const hooks = createProductSaveHooks(
      [registrationOf('spec-b.second'), registrationOf('spec-a.first')],
      resolverOf({
        'spec-a.first': recordingHook('spec-a.first', 'A', calls),
        'spec-b.second': recordingHook('spec-b.second', 'B', calls),
      }),
    );
    const input = { productId: productIdOf(PRODUCT), at: AT };

    const statements = await hooks.statementsFor(input, db);
    const [first, ...rest] = statements;
    if (first === undefined) {
      throw new Error('文が返っていません');
    }
    await db.batch([first, ...rest]);

    expect(statements).toHaveLength(2);
    expect(await readProductName()).toBe('名称BA');
    expect(
      calls.map(({ name, input: received, db: database }) => ({
        name,
        received,
        sameDb: database === db,
      })),
    ).toStrictEqual([
      { name: 'spec-b.second', received: input, sameDb: true },
      { name: 'spec-a.first', received: input, sameDb: true },
    ]);
  });

  test('同時の文を返す処理の例外はそのまま呼び出し元へ伝わる', async () => {
    const failure = new Error(SECRET_DETAIL);
    const calls: HookCall[] = [];
    const hooks = createProductSaveHooks(
      [registrationOf('spec-a.first'), registrationOf('spec-b.failing')],
      resolverOf({
        'spec-a.first': recordingHook('spec-a.first', 'A', calls),
        'spec-b.failing': {
          statementsFor: () => Promise.reject(failure),
          afterCommit: () => Promise.resolve(),
        },
      }),
    );

    await expect(
      hooks.statementsFor({ productId: productIdOf(PRODUCT), at: AT }, db),
    ).rejects.toBe(failure);
  });

  test('確定の後の処理を登録の順に呼ぶ', async () => {
    const calls: HookCall[] = [];
    const hooks = createProductSaveHooks(
      [
        registrationOf('spec-c.third'),
        registrationOf('spec-a.first'),
        registrationOf('spec-b.second'),
      ],
      resolverOf({
        'spec-a.first': recordingHook('spec-a.first', 'A', calls),
        'spec-b.second': recordingHook('spec-b.second', 'B', calls),
        'spec-c.third': recordingHook('spec-c.third', 'C', calls),
      }),
    );

    await hooks.runAfterCommit({ productId: productIdOf(PRODUCT) });

    expect(calls).toStrictEqual([
      {
        name: 'spec-c.third',
        phase: 'after-commit',
        input: { productId: productIdOf(PRODUCT) },
      },
      {
        name: 'spec-a.first',
        phase: 'after-commit',
        input: { productId: productIdOf(PRODUCT) },
      },
      {
        name: 'spec-b.second',
        phase: 'after-commit',
        input: { productId: productIdOf(PRODUCT) },
      },
    ]);
  });

  test('確定の後の処理の例外は処理の名前とプロダクトのIDだけを警告のログに残し、次の処理へ進み、呼び出し元へ返さない', async () => {
    const logs = configureRecordingLogs();
    const calls: HookCall[] = [];
    const hooks = createProductSaveHooks(
      [
        registrationOf('spec-a.failing'),
        registrationOf('spec-b.throwing'),
        registrationOf('spec-c.after'),
      ],
      resolverOf({
        'spec-a.failing': failingAfterCommitHook('spec-a.failing', calls),
        'spec-b.throwing': {
          statementsFor: () => Promise.resolve([]),
          afterCommit: () => {
            calls.push({
              name: 'spec-b.throwing',
              phase: 'after-commit',
              input: undefined,
            });
            throw new Error(SECRET_DETAIL);
          },
        },
        'spec-c.after': recordingHook('spec-c.after', 'C', calls),
      }),
    );

    await expect(
      hooks.runAfterCommit({ productId: productIdOf(PRODUCT) }),
    ).resolves.toBeUndefined();

    expect(calls.map(({ name }) => name)).toStrictEqual([
      'spec-a.failing',
      'spec-b.throwing',
      'spec-c.after',
    ]);
    const warnings = saveHookLogs(logs);
    expect(warnings).toMatchObject(
      ['spec-a.failing', 'spec-b.throwing'].map((hookName) => ({
        level: 'warning',
        message: 'プロダクトの保存の確定の後の処理に失敗しました',
        hookName,
        productId: productIdOf(PRODUCT),
      })),
    );
    expect(warnings.map((warning) => Object.hasOwn(warning, 'error'))).toEqual([
      false,
      false,
    ]);
    expect(JSON.stringify(logs)).not.toContain(SECRET_DETAIL);
  });

  test('組み立てた部品は実行時に書き換えられない', () => {
    const hooks = createProductSaveHooks([], resolverOf({}));

    expect(Object.isFrozen(hooks)).toBe(true);
  });
});
