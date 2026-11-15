import DataLoader from 'dataloader';

// D1の1文のバインド変数の上限(100個)に、キーの一覧と他の条件の値を合わせて収めるため
export const DEFAULT_LOADER_MAX_BATCH_SIZE = 50;

export interface LoaderScope {
  // 識別子のシンボルは取得する値の型を持たないため、コンテナのgetと同じく呼び出し側が型を指定する
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  resolve<T>(identifier: symbol): T;
}

export interface LoaderDefinition<K, V, C = K> {
  readonly name: string;
  readonly batch: (
    keys: readonly K[],
    scope: LoaderScope,
  ) => Promise<readonly (V | Error)[]>;
  readonly cacheKey?: (key: K) => C;
  readonly maxBatchSize?: number;
}

export interface LoaderRegistry {
  get<K, V, C>(definition: LoaderDefinition<K, V, C>): DataLoader<K, V, C>;
}

export function defineLoader<K, V, C = K>(
  definition: LoaderDefinition<K, V, C>,
): LoaderDefinition<K, V, C> {
  return definition;
}

function createLoader<K, V, C>(
  definition: LoaderDefinition<K, V, C>,
  scope: LoaderScope,
): DataLoader<K, V, C> {
  return new DataLoader<K, V, C>((keys) => definition.batch(keys, scope), {
    name: definition.name,
    maxBatchSize: definition.maxBatchSize ?? DEFAULT_LOADER_MAX_BATCH_SIZE,
    ...(definition.cacheKey === undefined
      ? {}
      : { cacheKeyFn: definition.cacheKey }),
  });
}

export function createLoaderRegistry(scope: LoaderScope): LoaderRegistry {
  const loaders = new Map<object, unknown>();
  return {
    get<K, V, C>(definition: LoaderDefinition<K, V, C>): DataLoader<K, V, C> {
      const existing = loaders.get(definition);
      if (existing !== undefined) {
        return existing as DataLoader<K, V, C>;
      }
      const loader = createLoader(definition, scope);
      loaders.set(definition, loader);
      return loader;
    },
  };
}
