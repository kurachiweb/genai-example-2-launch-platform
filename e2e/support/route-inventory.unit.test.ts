import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROUTE_INVENTORY,
  routeTreeFullPaths,
  routesMissingFromInventory,
} from './route-inventory.ts';

const WORKSPACE_ROOT = join(import.meta.dir, '..', '..');

const readRouteTree = (app: 'client' | 'admin'): string =>
  readFileSync(
    join(WORKSPACE_ROOT, 'apps', app, 'src', 'routeTree.gen.ts'),
    'utf8',
  );

const SYNTHETIC_ROUTE_TREE = `
export interface RootRouteTypes {
  fullPaths:
    | '/'
    | '/accounts/'
    | '/p/$handle'
  fileRoutesByTo: FileRoutesByTo
}
`;

const exportedNamesUnder = (directory: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const name of exportedNamesUnder(path)) {
        names.add(name);
      }
      continue;
    }
    if (!path.endsWith('.ts') || /\.(unit|e2e)\.test\.ts$/.test(path)) {
      continue;
    }
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(
      /^export (?:async )?(?:function|const) (\w+)/gm,
    )) {
      names.add(match[1] ?? '');
    }
  }
  return names;
};

const backtickedNamesOf = (text: string): readonly string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');

const inventoryPathsOf = (app: 'client' | 'admin'): ReadonlySet<string> =>
  new Set(
    ROUTE_INVENTORY.filter((entry) => entry.app === app).map(
      (entry) => entry.path,
    ),
  );

describe('routeTreeFullPaths', () => {
  test('fullPathsの型の和から全ての経路を重複なく読む', () => {
    expect(routeTreeFullPaths(SYNTHETIC_ROUTE_TREE)).toEqual([
      '/',
      '/accounts/',
      '/p/$handle',
    ]);
  });

  test('先頭の縦棒が無い1つだけの和も読む', () => {
    expect(routeTreeFullPaths("  fullPaths: '/'\n  fileRoutesByTo: X")).toEqual(
      ['/'],
    );
  });

  test('fullPathsが無い本文は黙って空にせず例外にする', () => {
    expect(() => routeTreeFullPaths('export const x = 1;')).toThrow(
      'fullPaths',
    );
  });

  test('実際のclientとadminのルートの木から経路を読める', () => {
    expect(routeTreeFullPaths(readRouteTree('client'))).toContain('/p/$handle');
    expect(routeTreeFullPaths(readRouteTree('admin'))).toContain(
      '/help-articles/order',
    );
  });
});

describe('routesMissingFromInventory', () => {
  test('生成されたclientのルートの木の全経路が一覧にある', () => {
    expect(
      routesMissingFromInventory('client', readRouteTree('client')),
    ).toEqual([]);
  });

  test('生成されたadminのルートの木の全経路が一覧にある', () => {
    expect(routesMissingFromInventory('admin', readRouteTree('admin'))).toEqual(
      [],
    );
  });

  test('一覧に無い経路を返す', () => {
    const source = `fullPaths:
    | '/'
    | '/not-in-inventory'
    | '/also/$missing'
  fileRoutesByTo: X`;

    expect(routesMissingFromInventory('client', source)).toEqual([
      '/not-in-inventory',
      '/also/$missing',
    ]);
  });

  test('別のアプリの一覧にだけある経路は一覧に無いものとして返す', () => {
    const source = `fullPaths:
    | '/'
    | '/accounts/'
  fileRoutesByTo: X`;

    expect(routesMissingFromInventory('client', source)).toEqual([
      '/accounts/',
    ]);
  });
});

describe('ROUTE_INVENTORY', () => {
  test('アプリと経路の組が重複しない', () => {
    const keys = ROUTE_INVENTORY.map((entry) => `${entry.app} ${entry.path}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('一覧の全ての経路が生成されたルートの木に実在する', () => {
    for (const app of ['client', 'admin'] as const) {
      const existing = new Set(routeTreeFullPaths(readRouteTree(app)));
      const stale = [...inventoryPathsOf(app)].filter(
        (path) => !existing.has(path),
      );

      expect(stale).toEqual([]);
    }
  });

  test('検査しない経路には理由があり状態が空で、検査する経路には状態と用意の方法がある', () => {
    for (const entry of ROUTE_INVENTORY) {
      if (entry.excluded === undefined) {
        expect(entry.states.length).toBeGreaterThan(0);
        expect(entry.prepare.trim()).not.toBe('');
        continue;
      }
      expect(entry.excluded.trim()).not.toBe('');
      expect(entry.states).toEqual([]);
    }
  });

  test('同じ経路の状態が重複しない', () => {
    for (const entry of ROUTE_INVENTORY) {
      expect(new Set(entry.states).size).toBe(entry.states.length);
    }
  });

  test('管理者側の経路にログイン済みの状態を置かない(ログイン済みはロールの状態で表す)', () => {
    const adminStates = ROUTE_INVENTORY.filter(
      (entry) => entry.app === 'admin',
    ).flatMap((entry) => entry.states);

    expect(adminStates).not.toContain('signed-in');
  });

  test('利用者側の経路にロールの状態を置かない', () => {
    const clientStates = ROUTE_INVENTORY.filter(
      (entry) => entry.app === 'client',
    ).flatMap((entry) => entry.states);

    expect(clientStates).not.toContain('role-viewer');
    expect(clientStates).not.toContain('role-moderator');
  });

  test.each(['/help-articles/order', '/categories/'])(
    '管理者側の%sは閲覧のみとモデレーターの2つのロールの状態を持つ',
    (path) => {
      const entry = ROUTE_INVENTORY.find(
        (candidate) => candidate.app === 'admin' && candidate.path === path,
      );

      expect(entry?.states).toContain('role-viewer');
      expect(entry?.states).toContain('role-moderator');
    },
  );

  test('並べ替えの画面の用意の方法はカテゴリと2件以上の記事である', () => {
    const entry = ROUTE_INVENTORY.find(
      (candidate) =>
        candidate.app === 'admin' && candidate.path === '/help-articles/order',
    );

    expect(entry?.prepare).toContain('カテゴリ');
    expect(entry?.prepare).toContain('2件以上');
  });

  test('動的な経路は代表の値の用意の方法を持つか、検査しない理由を持つ', () => {
    const dynamic = ROUTE_INVENTORY.filter((entry) => entry.path.includes('$'));

    expect(dynamic.length).toBeGreaterThan(0);
    for (const entry of dynamic) {
      expect(entry.excluded ?? entry.prepare).not.toBe('');
    }
  });

  test('用意の方法に書いた補助の名前が上流のE2Eの補助に実在する', () => {
    const exported = exportedNamesUnder(join(WORKSPACE_ROOT, 'e2e'));
    const unknown = ROUTE_INVENTORY.flatMap((entry) =>
      backtickedNamesOf(entry.prepare).filter((name) => !exported.has(name)),
    );

    expect(unknown).toEqual([]);
  });
});
