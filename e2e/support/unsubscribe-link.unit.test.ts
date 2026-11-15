import { describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import {
  createUnsubscribeSeed,
  deriveUnsubscribeToken,
  oneClickUnsubscribeUrl,
  type UnsubscribeTokenInput,
} from './unsubscribe-link.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const INPUT: UnsubscribeTokenInput = {
  pepper: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  userId: '01JC0RCPT00000000000000001',
  topic: 'match_result',
  seed: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

// backend-libの導出を読み込むとルートの型検査とカバレッジの分母に入るため、子プロセスで実行した結果と比べる
const REFERENCE_SCRIPT = `
const { createKeyedHasher } = await import(process.argv[1] + '/apps/backend-lib/core/crypto/keyed-hasher.ts');
const tokenModule = await import(process.argv[1] + '/apps/backend-lib/core/notifications/unsubscribe-token.ts');
const input = JSON.parse(process.argv[2]);
const hasher = createKeyedHasher(input.pepper);
const token = await hasher.hash(tokenModule.UNSUBSCRIBE_TOKEN_PURPOSE, tokenModule.unsubscribeTokenSource(input));
const tokenHash = await hasher.hash(tokenModule.UNSUBSCRIBE_LOOKUP_PURPOSE, token);
process.stdout.write(JSON.stringify({
  token,
  tokenHash,
  wellFormed: tokenModule.isWellFormedUnsubscribeToken(token),
  seedBytes: tokenModule.UNSUBSCRIBE_SEED_BYTES,
  oneClickUrl: tokenModule.oneClickUnsubscribeUrl('http://localhost:48043', token),
}));
`;

interface ReferenceResult {
  readonly token: string;
  readonly tokenHash: string;
  readonly wellFormed: boolean;
  readonly seedBytes: number;
  readonly oneClickUrl: string;
}

const referenceOf = (input: UnsubscribeTokenInput): ReferenceResult => {
  const result = Bun.spawnSync([
    process.execPath,
    '--eval',
    REFERENCE_SCRIPT,
    REPO_ROOT,
    JSON.stringify(input),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `backend-libの配信停止のトークンの導出が終了コード${String(result.exitCode)}で失敗しました: ${result.stderr.toString()}`,
    );
  }
  return JSON.parse(result.stdout.toString()) as ReferenceResult;
};

describe('deriveUnsubscribeToken', () => {
  test('backend-libの導出と同じトークンと照合用のハッシュを返す', () => {
    const reference = referenceOf(INPUT);

    expect(reference.wellFormed).toBe(true);
    expect(deriveUnsubscribeToken(INPUT)).toEqual({
      token: reference.token,
      tokenHash: reference.tokenHash,
    });
  });

  test('作った種からもbackend-libと同じトークンを導出する', () => {
    const input = { ...INPUT, topic: 'followed_user_award' as const };
    const seeded = { ...input, seed: createUnsubscribeSeed() };

    const reference = referenceOf(seeded);

    expect(deriveUnsubscribeToken(seeded).token).toBe(reference.token);
  });

  test('ペッパーが空なら注入付きの実行の形を示して失敗する', () => {
    expect(() => deriveUnsubscribeToken({ ...INPUT, pepper: '' })).toThrow(
      'infisical',
    );
  });
});

describe('createUnsubscribeSeed', () => {
  test('backend-libの種の長さの乱数をパディングなしのbase64urlで返し、毎回異なる', () => {
    const { seedBytes } = referenceOf(INPUT);

    const seed = createUnsubscribeSeed();

    expect(Buffer.from(seed, 'base64url')).toHaveLength(seedBytes);
    expect(seed).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(createUnsubscribeSeed()).not.toBe(seed);
  });
});

describe('oneClickUnsubscribeUrl', () => {
  test('backend-libと同じワンクリックの配信停止のURLを返す', () => {
    const { token, oneClickUrl } = referenceOf(INPUT);

    expect(oneClickUnsubscribeUrl('http://localhost:48043', token)).toBe(
      oneClickUrl,
    );
  });
});
