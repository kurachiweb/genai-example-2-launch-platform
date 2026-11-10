import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { createMatchEventRegistry } from '../../lib/core/match/match-events.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { EVENT_DIRECTORY_TYPES } from '../application/directory/event-directory-types.ts';
import { QualifierListingHandler } from '../application/directory/qualifier-listing-handler.ts';
import { D1ProductIndexPendingMarker } from '../infrastructure/directory/d1-product-index-pending-marker.ts';
import { EVENT_DIRECTORY_MODULE } from './directory-module.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';
import { MODULES } from './modules.ts';

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
    '%s経路の処理単位のコンテナから、掲載の記録の処理と更新待ちの書き込みの単位を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get(EVENT_DIRECTORY_TYPES.QualifierListingHandler),
      ).toBeInstanceOf(QualifierListingHandler);
      expect(
        container.get(EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker),
      ).toBeInstanceOf(D1ProductIndexPendingMarker);
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
