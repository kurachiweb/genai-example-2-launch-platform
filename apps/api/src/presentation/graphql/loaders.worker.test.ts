import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import {
  createLoaderRegistry,
  DEFAULT_LOADER_MAX_BATCH_SIZE,
  defineLoader,
  type LoaderDefinition,
  type LoaderScope,
} from './loaders.ts';

interface RecordedLoader<K, V, C = K> {
  readonly definition: LoaderDefinition<K, V, C>;
  readonly batches: (readonly K[])[];
}

interface Greeting {
  readonly prefix: string;
}

const GREETING = Symbol.for('test.loaders.Greeting');

function createScope(prefix = 'scope'): LoaderScope {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-loaders',
        clientIp: undefined,
      },
    },
    [
      {
        bindings: new ContainerModule(({ bind }) => {
          bind<Greeting>(GREETING).toConstantValue({ prefix });
        }),
      },
    ],
  );
  return { resolve: (identifier) => container.get(identifier) };
}

function recordedUpperCaseLoader(
  options: { maxBatchSize?: number } = {},
): RecordedLoader<string, string> {
  const batches: (readonly string[])[] = [];
  const definition = defineLoader<string, string>({
    name: 'upperCase',
    ...options,
    batch: (keys) => {
      batches.push([...keys]);
      return Promise.resolve(keys.map((key) => key.toUpperCase()));
    },
  });
  return { definition, batches };
}

function keysOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `key-${String(index)}`);
}

describe('LoaderRegistry', () => {
  test('同じ処理単位で同時に読み込んだ3件を1回の一括読み込みにまとめる', async () => {
    const { definition, batches } = recordedUpperCaseLoader();
    const registry = createLoaderRegistry(createScope());

    const values = await Promise.all([
      registry.get(definition).load('a'),
      registry.get(definition).load('b'),
      registry.get(definition).load('c'),
    ]);

    expect(values).toEqual(['A', 'B', 'C']);
    expect(batches).toEqual([['a', 'b', 'c']]);
  });

  test('同じ処理単位では同じ定義に対して同じ読み込み器を返す', () => {
    const { definition } = recordedUpperCaseLoader();
    const registry = createLoaderRegistry(createScope());

    expect(registry.get(definition)).toBe(registry.get(definition));
  });

  test('同じ処理単位で読み込み済みのキーは一括読み込みを繰り返さない', async () => {
    const { definition, batches } = recordedUpperCaseLoader();
    const registry = createLoaderRegistry(createScope());

    await registry.get(definition).load('a');
    const value = await registry.get(definition).load('a');

    expect(value).toBe('A');
    expect(batches).toEqual([['a']]);
  });

  test('別の処理単位とは読み込み器も読み込み結果も共有しない', async () => {
    const { definition, batches } = recordedUpperCaseLoader();
    const first = createLoaderRegistry(createScope());
    const second = createLoaderRegistry(createScope());

    await first.get(definition).load('a');
    await second.get(definition).load('a');

    expect(first.get(definition)).not.toBe(second.get(definition));
    expect(batches).toEqual([['a'], ['a']]);
  });

  test('件数の上限を指定しない場合は50件ごとに分割する', async () => {
    const { definition, batches } = recordedUpperCaseLoader();
    const registry = createLoaderRegistry(createScope());

    await registry.get(definition).loadMany(keysOf(120));

    expect(DEFAULT_LOADER_MAX_BATCH_SIZE).toBe(50);
    expect(batches.map((keys) => keys.length)).toEqual([50, 50, 20]);
  });

  test('指定した件数の上限ごとに分割する', async () => {
    const { definition, batches } = recordedUpperCaseLoader({
      maxBatchSize: 2,
    });
    const registry = createLoaderRegistry(createScope());

    await registry.get(definition).loadMany(['a', 'b', 'c', 'd', 'e']);

    expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  test('一括読み込みの関数が処理単位のコンテナから依存を取得できる', async () => {
    const definition = defineLoader<string, string>({
      name: 'greeting',
      batch: (keys, scope) => {
        const { prefix } = scope.resolve<Greeting>(GREETING);
        return Promise.resolve(keys.map((key) => `${prefix}:${key}`));
      },
    });

    const [first, second] = await Promise.all([
      createLoaderRegistry(createScope('first')).get(definition).load('a'),
      createLoaderRegistry(createScope('second')).get(definition).load('a'),
    ]);

    expect(first).toBe('first:a');
    expect(second).toBe('second:a');
  });

  test('キーごとのErrorはそのキーの読み込みだけを失敗させる', async () => {
    const failure = new Error('見つかりません');
    const definition = defineLoader<string, string>({
      name: 'partial',
      batch: (keys) =>
        Promise.resolve(keys.map((key) => (key === 'missing' ? failure : key))),
    });
    const loader = createLoaderRegistry(createScope()).get(definition);

    const [found, missing] = await Promise.allSettled([
      loader.load('found'),
      loader.load('missing'),
    ]);

    expect(found).toEqual({ status: 'fulfilled', value: 'found' });
    expect(missing).toEqual({ status: 'rejected', reason: failure });
  });

  test('キャッシュのキーが同じ読み込みを1件にまとめる', async () => {
    const batches: (readonly { readonly id: string }[])[] = [];
    const definition = defineLoader<{ readonly id: string }, string, string>({
      name: 'byObject',
      cacheKey: (key) => key.id,
      batch: (keys) => {
        batches.push([...keys]);
        return Promise.resolve(keys.map((key) => key.id));
      },
    });
    const loader = createLoaderRegistry(createScope()).get(definition);

    const values = await Promise.all([
      loader.load({ id: 'a' }),
      loader.load({ id: 'a' }),
    ]);

    expect(values).toEqual(['a', 'a']);
    expect(batches).toEqual([[{ id: 'a' }]]);
  });
});
