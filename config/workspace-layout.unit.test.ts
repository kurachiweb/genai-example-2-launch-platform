import { describe, expect, expectTypeOf, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';

import { isGitIgnored } from '../test-support/git-ignore.ts';
import {
  APPS,
  EXTERNAL_SOURCE_DIRS,
  QUALITY_GATE_EXCLUDED_DIRS,
  SHARED_DIRS,
  type AppDefinition,
  type SharedDirDefinition,
} from './workspace-layout.ts';

const REPO_ROOT = join(import.meta.dir, '..');

interface ComposeFile {
  readonly services: Readonly<
    Record<
      string,
      { readonly working_dir: string; readonly volumes: readonly string[] }
    >
  >;
}

const toMountKey = (source: string, target: string): string =>
  `${source} -> ${target}`;

const readSubdirectoryBindMounts = (): readonly string[] => {
  const compose = Bun.YAML.parse(
    readFileSync(join(REPO_ROOT, 'compose.yaml'), 'utf8'),
  ) as ComposeFile;

  return Object.values(compose.services).flatMap((service) =>
    service.volumes
      .filter((volume) => volume.startsWith('./'))
      .map((volume) => {
        const [source = '', target = ''] = volume.split(':');
        return toMountKey(
          normalize(source),
          relative(service.working_dir, target),
        );
      }),
  );
};

describe('APPS', () => {
  test('一括実行の対象をapi・event・frontend-lib・client・adminの順に並べる', () => {
    expect(APPS.map((app) => app.name)).toEqual([
      'api',
      'event',
      'frontend-lib',
      'client',
      'admin',
    ]);
  });

  test('各アプリのディレクトリをリポジトリルートからの相対パスapps/<name>で持つ', () => {
    for (const app of APPS) {
      expect(app.dir).toBe(`apps/${app.name}`);
    }
  });

  test('型として変更不可の配列である', () => {
    expectTypeOf(APPS).toEqualTypeOf<readonly AppDefinition[]>();
  });
});

describe('SHARED_DIRS', () => {
  test('共有ディレクトリごとに配置元・配置先・検査担当を持つ', () => {
    expect(SHARED_DIRS).toEqual([
      {
        source: 'apps/db',
        mounts: [
          { consumer: 'api', target: 'apps/api/db' },
          { consumer: 'event', target: 'apps/event/db' },
        ],
        checkedBy: 'api',
      },
      {
        source: 'apps/backend-lib',
        mounts: [
          { consumer: 'api', target: 'apps/api/lib' },
          { consumer: 'event', target: 'apps/event/lib' },
        ],
        checkedBy: 'api',
      },
      {
        source: 'apps/frontend-lib',
        mounts: [
          { consumer: 'client', target: 'apps/client/lib' },
          { consumer: 'admin', target: 'apps/admin/lib' },
        ],
        checkedBy: 'self',
      },
    ]);
  });

  test('配置先は利用側アプリのディレクトリ配下にある', () => {
    const mountsOutsideConsumer = SHARED_DIRS.flatMap(
      (sharedDir) => sharedDir.mounts,
    ).filter(
      (mount) =>
        !APPS.some(
          (app) =>
            app.name === mount.consumer &&
            mount.target.startsWith(`${app.dir}/`),
        ),
    );

    expect(mountsOutsideConsumer).toEqual([]);
  });

  test('検査担当がアプリの共有ディレクトリは、検査担当アプリへの配置先を持つ', () => {
    const withoutCheckerMount = SHARED_DIRS.filter(
      (sharedDir) =>
        sharedDir.checkedBy !== 'self' &&
        !sharedDir.mounts.some(
          (mount) => mount.consumer === sharedDir.checkedBy,
        ),
    );

    expect(withoutCheckerMount).toEqual([]);
  });

  test('配置元と配置先の組がcompose.yamlのbind mountと完全に一致する', () => {
    const fromLayout = SHARED_DIRS.flatMap((sharedDir) =>
      sharedDir.mounts.map((mount) =>
        toMountKey(sharedDir.source, mount.target),
      ),
    );

    expect(readSubdirectoryBindMounts().toSorted()).toEqual(
      fromLayout.toSorted(),
    );
  });

  // 配置先の中身は配置元と同じファイルのため、Gitの一覧に現れると命名検査や整形検査が同じファイルを配置元と重ねて扱う
  test('すべての配置先がGit管理外である', () => {
    const notIgnored = SHARED_DIRS.flatMap(({ mounts }) =>
      mounts.map(({ target }) => target),
    ).filter((target) => !isGitIgnored(REPO_ROOT, target));

    expect(notIgnored).toEqual([]);
  });

  test('型として変更不可の配列である', () => {
    expectTypeOf(SHARED_DIRS).toEqualTypeOf<readonly SharedDirDefinition[]>();
  });
});

describe('QUALITY_GATE_EXCLUDED_DIRS', () => {
  test('品質ゲートの対象外としてmockupsだけを持つ', () => {
    expect(QUALITY_GATE_EXCLUDED_DIRS).toEqual(['mockups']);
  });

  test('型として変更不可の配列である', () => {
    expectTypeOf(QUALITY_GATE_EXCLUDED_DIRS).toEqualTypeOf<readonly string[]>();
  });
});

describe('EXTERNAL_SOURCE_DIRS', () => {
  test('原文のまま保つ外部由来として.claude・docs/ai-extensions・.kiro/settingsを持つ', () => {
    expect(EXTERNAL_SOURCE_DIRS).toEqual([
      '.claude',
      'docs/ai-extensions',
      '.kiro/settings',
    ]);
  });

  test('型として変更不可の配列である', () => {
    expectTypeOf(EXTERNAL_SOURCE_DIRS).toEqualTypeOf<readonly string[]>();
  });
});

test('定義モジュールは他のモジュールをimportしない', () => {
  const source = readFileSync(
    join(import.meta.dir, 'workspace-layout.ts'),
    'utf8',
  );

  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).not.toMatch(/\sfrom\s+['"]/);
  expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
});
