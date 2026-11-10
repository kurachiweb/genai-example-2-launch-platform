import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { createAsyncLifecycleRegistry } from '../../lib/core/identity/user-lifecycle.ts';
import { createMatchEventRegistry } from '../../lib/core/match/match-events.ts';
import { createProductLifecycleRegistry } from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { AccountIndexRestoreHandler } from '../application/directory/account-index-restore-handler.ts';
import { EntryErasureHandler } from '../application/directory/entry-erasure-handler.ts';
import { EVENT_DIRECTORY_TYPES } from '../application/directory/event-directory-types.ts';
import { ProductIndexRestoreHandler } from '../application/directory/product-index-restore-handler.ts';
import { QualifierListingHandler } from '../application/directory/qualifier-listing-handler.ts';
import { D1ProductIndexPendingMarker } from '../infrastructure/directory/d1-product-index-pending-marker.ts';
import { EVENT_DIRECTORY_MODULE } from './directory-module.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

describe('イベントサーバーのモジュールの一覧へのディレクトリの登録', () => {
  test('eventのディレクトリのモジュールを、ディレクトリの共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(EVENT_DIRECTORY_MODULE.name).toBe('event-directory');
    expect(
      MODULES.filter((module) => module === EVENT_DIRECTORY_MODULE),
    ).toHaveLength(1);
    expect(names.indexOf('event-directory')).toBeGreaterThan(
      names.indexOf('directory-platform'),
    );
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、掲載と索引の処理と更新待ちの書き込みの単位を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get(EVENT_DIRECTORY_TYPES.QualifierListingHandler),
      ).toBeInstanceOf(QualifierListingHandler);
      expect(
        container.get(EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker),
      ).toBeInstanceOf(D1ProductIndexPendingMarker);
      expect(
        container.get(EVENT_DIRECTORY_TYPES.ProductIndexRestoreHandler),
      ).toBeInstanceOf(ProductIndexRestoreHandler);
      expect(
        container.get(EVENT_DIRECTORY_TYPES.EntryErasureHandler),
      ).toBeInstanceOf(EntryErasureHandler);
      expect(
        container.get(EVENT_DIRECTORY_TYPES.AccountIndexRestoreHandler),
      ).toBeInstanceOf(AccountIndexRestoreHandler);
    },
  );
});

describe('マッチイベントの処理の登録口へのディレクトリの登録', () => {
  test('掲載の記録の処理を、予選の確定のイベントに帯の1200で登録する', () => {
    expect(
      MATCH_EVENT_HANDLERS.filter(({ name }) =>
        name.startsWith('directory-discovery.'),
      ),
    ).toStrictEqual([
      {
        name: 'directory-discovery.qualifier-listing',
        events: ['decided'],
        kinds: ['qualifier'],
        order: 1200,
        handler: EVENT_DIRECTORY_TYPES.QualifierListingHandler,
      },
    ]);
  });

  test('予選の確定のイベントでは、予選の結果の記録の処理の後に動く', () => {
    const names = createMatchEventRegistry(MATCH_EVENT_HANDLERS)
      .handlersFor({ type: 'decided', kind: 'qualifier' })
      .map(({ name }) => name);

    expect(names.indexOf('directory-discovery.qualifier-listing')).toBe(
      names.indexOf('match-engine.qualifier-outcome') + 1,
    );
  });

  test.each(['week', 'year'] as const)(
    '%sのトーナメントの確定のイベントでは動かない',
    (kind) => {
      const names = createMatchEventRegistry(MATCH_EVENT_HANDLERS)
        .handlersFor({ type: 'decided', kind })
        .map(({ name }) => name);

      expect(names).not.toContain('directory-discovery.qualifier-listing');
    },
  );
});

describe('プロダクトライフサイクルの非同期の処理の登録口へのディレクトリの登録', () => {
  test('復元に索引の作り直しを、物理削除の時期の到来に記録の削除を、帯の1200で登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('directory-discovery.'),
      ),
    ).toStrictEqual([
      {
        name: 'directory-discovery.product-index-restore',
        events: ['unhidden'],
        order: 1200,
        handler: EVENT_DIRECTORY_TYPES.ProductIndexRestoreHandler,
      },
      {
        name: 'directory-discovery.entry-erasure',
        events: ['purge_due'],
        order: 1200,
        handler: EVENT_DIRECTORY_TYPES.EntryErasureHandler,
      },
    ]);
  });

  test('登録の検証を通り、復元と物理削除の時期の到来の最後の処理として並ぶ', () => {
    const registry = createProductLifecycleRegistry(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS,
    );

    expect(registry.handlersFor('unhidden').at(-1)?.name).toBe(
      'directory-discovery.product-index-restore',
    );
    expect(registry.handlersFor('purge_due').at(-1)?.name).toBe(
      'directory-discovery.entry-erasure',
    );
  });

  test.each(['hidden', 'deleted'] as const)('%sでは動かない', (type) => {
    const names = createProductLifecycleRegistry(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS,
    )
      .handlersFor(type)
      .map(({ name }) => name);

    expect(
      names.filter((name) => name.startsWith('directory-discovery.')),
    ).toStrictEqual([]);
  });
});

describe('ユーザーライフサイクルの非同期の波及処理の登録口へのディレクトリの登録', () => {
  test('停止の解除に索引の作り直しを帯の1200で登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('directory-discovery.'),
      ),
    ).toStrictEqual([
      {
        name: 'directory-discovery.account-index-restore',
        events: ['unsuspended'],
        order: 1200,
        handler: EVENT_DIRECTORY_TYPES.AccountIndexRestoreHandler,
      },
    ]);
  });

  test('登録の検証を通り、停止の解除のアカウントの機能より前の処理の最後に並ぶ', () => {
    const names = createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS)
      .handlersFor('unsuspended')
      .filter(({ order }) => order < 10000)
      .map(({ name }) => name);

    expect(names.at(-1)).toBe('directory-discovery.account-index-restore');
  });
});
