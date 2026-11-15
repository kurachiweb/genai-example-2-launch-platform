import { describe, expect, test } from 'bun:test';

import { createKeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import type {
  SecretBox,
  SecretGenerator,
  TotpAuthenticator,
} from '../auth/ports.ts';
import { HashingRecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type {
  RecoveryCodeStore,
  TotpCredential,
  TotpCredentialStore,
} from './ports.ts';
import {
  checkSecondFactor,
  isTotpEnabled,
  USER_RECOVERY_CODE_HASH_PURPOSE,
} from './second-factor-check.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const USER_ID = '01JUSER000000000000000000A';

const TEST_PEPPER = ['second', 'factor', 'check', 'unit'].join('-');

const TOTP_SECRET = ['totp', 'secret', 'of', 'user'].join('-');

const VALID_CODE = ['123', '456'].join('');

const VALID_STEP = 59_000_000;

const RAW_RECOVERY_CODE = 'abcd'.repeat(4);

const FORMATTED_RECOVERY_CODE = ['abcd', 'abcd', 'abcd', 'abcd'].join('-');

const sealedFor = (userId: string): string => `sealed(${userId})`;

const ENABLED: TotpCredential = {
  sealedSecret: sealedFor(USER_ID),
  enabledAt: new Date('2026-10-01T00:00:00.000Z'),
  pendingExpiresAt: null,
  lastUsedStep: VALID_STEP - 1,
};

const notUsed = (): never => {
  throw new Error('第2要素の照合では使わない');
};

interface FakeOptions {
  readonly credential?: TotpCredential;
  readonly recoveryHashes?: readonly string[];
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const keyedHasher = createKeyedHasher(TEST_PEPPER);
  let credential = options.credential;
  const recoveryHashes = new Set(options.recoveryHashes ?? []);
  const opened: { sealed: string; context: string }[] = [];
  const verified: { secret: string; code: string; now: Date }[] = [];
  const consumed: { userId: string; codeHash: string }[] = [];

  const totpCredentials: TotpCredentialStore = {
    find(userId) {
      calls.push('totpCredentials.find');
      return Promise.resolve(userId === USER_ID ? credential : undefined);
    },
    savePending: notUsed,
    enableRevokingSessions: notUsed,
    advanceStep(userId, step) {
      calls.push('totpCredentials.advanceStep');
      if (
        userId !== USER_ID ||
        credential === undefined ||
        (credential.lastUsedStep !== null && credential.lastUsedStep >= step)
      ) {
        return Promise.resolve(false);
      }
      credential = { ...credential, lastUsedStep: step };
      return Promise.resolve(true);
    },
    disableRevokingSessions: notUsed,
    deleteExpiredPending: notUsed,
  };

  const secretBox: SecretBox = {
    seal: notUsed,
    open(sealed, context) {
      calls.push('secretBox.open');
      opened.push({ sealed, context });
      if (sealed !== sealedFor(context)) {
        return Promise.reject(new Error('文脈が一致しない'));
      }
      return Promise.resolve(TOTP_SECRET);
    },
  };

  const totp: TotpAuthenticator = {
    generateSecret: notUsed,
    buildUri: notUsed,
    verify(secret, code, now) {
      calls.push('totp.verify');
      verified.push({ secret, code, now });
      return secret === TOTP_SECRET && code === VALID_CODE
        ? { ok: true, step: VALID_STEP }
        : { ok: false };
    },
  };

  const generator: SecretGenerator = {
    token: notUsed,
    randomString: notUsed,
    uuid: notUsed,
  };

  const recoveryCodes: RecoveryCodeStore = {
    consume(userId, codeHash) {
      calls.push('recoveryCodes.consume');
      consumed.push({ userId, codeHash });
      if (userId !== USER_ID || !recoveryHashes.has(codeHash)) {
        return Promise.resolve(false);
      }
      recoveryHashes.delete(codeHash);
      return Promise.resolve(true);
    },
    count: notUsed,
    replaceAllRevokingSessions: notUsed,
  };

  const dependencies = {
    totpCredentials,
    secretBox,
    totp,
    recoveryCodeIssuer: new HashingRecoveryCodeIssuer(generator, keyedHasher),
    recoveryCodes,
  };

  const check = (input: SecondFactorInput): Promise<boolean> =>
    checkSecondFactor(dependencies, USER_ID, input, NOW);

  return { calls, opened, verified, consumed, keyedHasher, check };
}

async function recoveryHash(pepper: string, raw: string): Promise<string> {
  return createKeyedHasher(pepper).hash(USER_RECOVERY_CODE_HASH_PURPOSE, raw);
}

describe('isTotpEnabled', () => {
  test('有効化済みの資格情報だけを有効とし、設定の途中(保留)や資格情報が無いときは無効とする', () => {
    expect(isTotpEnabled(ENABLED)).toBe(true);
    expect(
      isTotpEnabled({
        sealedSecret: sealedFor(USER_ID),
        enabledAt: null,
        pendingExpiresAt: new Date('2026-11-02T03:10:00.000Z'),
        lastUsedStep: null,
      }),
    ).toBe(false);
    expect(isTotpEnabled(undefined)).toBe(false);
  });
});

describe('checkSecondFactor(認証コード)', () => {
  test('利用者IDを文脈に秘密鍵を復元して照合し、一致した時間窓を使用済みにして成功する', async () => {
    const { calls, opened, verified, check } = setup({ credential: ENABLED });

    const result = await check({ kind: 'totp', code: VALID_CODE });

    expect(result).toBe(true);
    expect(opened).toEqual([{ sealed: sealedFor(USER_ID), context: USER_ID }]);
    expect(verified).toEqual([
      { secret: TOTP_SECRET, code: VALID_CODE, now: NOW },
    ]);
    expect(calls).toEqual([
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
      'totpCredentials.advanceStep',
    ]);
  });

  test('全角の数字や空白を含む認証コードも正規化して照合する', async () => {
    const { verified, check } = setup({ credential: ENABLED });

    const result = await check({ kind: 'totp', code: ' １２３ ４５６ ' });

    expect(result).toBe(true);
    expect(verified.map((entry) => entry.code)).toEqual([VALID_CODE]);
  });

  test('同じ時間窓の認証コードの2回目は、照合が一致しても使用済みとして失敗する', async () => {
    const { check } = setup({ credential: ENABLED });

    const first = await check({ kind: 'totp', code: VALID_CODE });
    const second = await check({ kind: 'totp', code: VALID_CODE });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test('誤った認証コードは時間窓を使用済みにせず失敗する', async () => {
    const { calls, check } = setup({ credential: ENABLED });

    const result = await check({ kind: 'totp', code: '654321' });

    expect(result).toBe(false);
    expect(calls).not.toContain('totpCredentials.advanceStep');
  });

  test('6桁の数字に正規化できない入力は、秘密鍵を復元せずに失敗する', async () => {
    const { calls, check } = setup({ credential: ENABLED });

    const results = await Promise.all(
      ['12345', '1234567', 'abcdef', ''].map((code) =>
        check({ kind: 'totp', code }),
      ),
    );

    expect(results).toEqual([false, false, false, false]);
    expect(calls).not.toContain('secretBox.open');
    expect(calls).not.toContain('totpCredentials.find');
  });

  test('多要素認証が設定の途中(保留)や未設定なら、秘密鍵を復元せずに失敗する', async () => {
    const pending = setup({
      credential: {
        sealedSecret: sealedFor(USER_ID),
        enabledAt: null,
        pendingExpiresAt: new Date('2026-11-02T03:10:00.000Z'),
        lastUsedStep: null,
      },
    });
    const missing = setup();

    expect(await pending.check({ kind: 'totp', code: VALID_CODE })).toBe(false);
    expect(await missing.check({ kind: 'totp', code: VALID_CODE })).toBe(false);
    expect(pending.calls).not.toContain('secretBox.open');
    expect(missing.calls).not.toContain('secretBox.open');
  });
});

describe('checkSecondFactor(リカバリコード)', () => {
  test('ハイフン区切りや大文字・全角の入力を正規化した値のハッシュで消費して成功し、同じコードの2回目は失敗する', async () => {
    const stored = await recoveryHash(TEST_PEPPER, RAW_RECOVERY_CODE);
    const { consumed, check } = setup({
      credential: ENABLED,
      recoveryHashes: [stored],
    });

    const first = await check({
      kind: 'recovery',
      code: FORMATTED_RECOVERY_CODE.toUpperCase().replaceAll('-', '－'),
    });
    const second = await check({
      kind: 'recovery',
      code: FORMATTED_RECOVERY_CODE,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(consumed).toEqual([
      { userId: USER_ID, codeHash: stored },
      { userId: USER_ID, codeHash: stored },
    ]);
  });

  test('一致するリカバリコードが無ければ失敗し、認証コードの照合は行わない', async () => {
    const stored = await recoveryHash(TEST_PEPPER, RAW_RECOVERY_CODE);
    const { calls, check } = setup({
      credential: ENABLED,
      recoveryHashes: [stored],
    });

    const result = await check({
      kind: 'recovery',
      code: 'wxyz'.repeat(4),
    });

    expect(result).toBe(false);
    expect(calls).toEqual(['recoveryCodes.consume']);
  });

  test('リカバリコードの形に正規化できない入力は、消費を試みずに失敗する', async () => {
    const { calls, check } = setup({ credential: ENABLED });

    const result = await check({ kind: 'recovery', code: 'abcd-abcd' });

    expect(result).toBe(false);
    expect(calls).toEqual([]);
  });
});
