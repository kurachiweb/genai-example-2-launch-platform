import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BASE_SECURITY_HEADERS } from '../../lib/server/http/security-headers.ts';
import {
  buildPermissionsPolicy,
  NON_PAGE_CONTENT_SECURITY_POLICY,
} from '../../lib/server/http/security-policy.ts';

const HEADERS_FILE_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  '_headers',
);

const LONG_TERM_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type HeaderRules = ReadonlyMap<string, Readonly<Record<string, string>>>;

// Workers Static Assetsの_headersの形式: 字下げの無い行が経路のパターン、字下げした行がその経路の「名前: 値」
const parseHeadersFile = (source: string): HeaderRules => {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of source.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!/^\s/.test(line)) {
      current = {};
      rules.set(line.trim(), current);
      continue;
    }
    const separator = line.indexOf(':');
    if (current === undefined || separator === -1) {
      throw new Error(`経路の無いヘッダーか、形式の不正な行です: ${line}`);
    }
    current[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return rules;
};

const readHeaderRules = async (): Promise<HeaderRules> =>
  parseHeadersFile(await readFile(HEADERS_FILE_PATH, 'utf8'));

describe('静的なファイルのヘッダー(public/_headers)', () => {
  test('経路のパターンはすべてのファイルと/assets/*の2つだけである', async () => {
    const rules = await readHeaderRules();

    expect([...rules.keys()]).toEqual(['/*', '/assets/*']);
  });

  test('すべてのファイルに、共通部品の定数と同じセキュリティヘッダー・すべて拒否のPermissions-Policy・ページ以外のCSPを付ける', async () => {
    const rules = await readHeaderRules();

    expect(rules.get('/*')).toStrictEqual({
      ...BASE_SECURITY_HEADERS,
      'Permissions-Policy': buildPermissionsPolicy({}),
      'Content-Security-Policy': NON_PAGE_CONTENT_SECURITY_POLICY,
    });
  });

  test('内容ごとに名前の変わる/assets/*のファイルを1年間・変更なしとして長期キャッシュさせる', async () => {
    const rules = await readHeaderRules();

    expect(rules.get('/assets/*')).toStrictEqual({
      'Cache-Control': LONG_TERM_CACHE_CONTROL,
    });
  });

  test('すべてのファイルの規則でキャッシュを指定せず、/assets/*以外を長期キャッシュさせない', async () => {
    const rules = await readHeaderRules();

    expect(Object.keys(rules.get('/*') ?? {})).not.toContain('Cache-Control');
  });
});
