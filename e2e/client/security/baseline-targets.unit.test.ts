import { describe, expect, test } from 'bun:test';

import {
  type BackendTarget,
  isLocalOrigin,
  resolveBackendBaselineTargets,
} from './baseline-targets.ts';

const LOCAL_CLIENT = 'http://localhost:48044';

const STAGING_CLIENT = 'https://client-staging.example';

const skipReasonOf = (target: BackendTarget): string =>
  target.kind === 'skip' ? target.reason : '';

describe('isLocalOrigin', () => {
  test.each([
    'http://localhost:48044',
    'http://127.0.0.1:48044',
    'http://[::1]:48044',
  ])('%sはローカルとみなす', (origin) => {
    expect(isLocalOrigin(origin)).toBe(true);
  });

  test.each([
    'https://client-staging.example',
    'https://localhost.example',
    'not a url',
    '',
  ])('%sはローカルとみなさない', (origin) => {
    expect(isLocalOrigin(origin)).toBe(false);
  });
});

describe('resolveBackendBaselineTargets', () => {
  test('3つのURLが未設定で利用者側がローカルなら、既定のローカルのオリジンで実行する', () => {
    const targets = resolveBackendBaselineTargets({}, LOCAL_CLIENT);

    expect(targets).toEqual({
      api: { kind: 'run', origin: 'http://localhost:48042' },
      event: { kind: 'run', origin: 'http://localhost:48043' },
      images: { kind: 'run', origin: 'http://localhost:48043' },
    });
  });

  test('3つのURLが未設定で利用者側がローカルでないなら、3つとも対象外にして理由に変数名を示す', () => {
    const targets = resolveBackendBaselineTargets({}, STAGING_CLIENT);

    expect(skipReasonOf(targets.api)).toContain('E2E_API_URL');
    expect(skipReasonOf(targets.event)).toContain('E2E_EVENT_URL');
    expect(skipReasonOf(targets.images)).toContain('E2E_IMAGES_URL');
  });

  test('利用者側がローカルでなくても、URLを設定した対象は実行する', () => {
    const targets = resolveBackendBaselineTargets(
      {
        E2E_API_URL: 'https://api-staging.example',
        E2E_EVENT_URL: 'https://event-staging.example',
        E2E_IMAGES_URL: 'https://images-staging.example',
      },
      STAGING_CLIENT,
    );

    expect(targets).toEqual({
      api: { kind: 'run', origin: 'https://api-staging.example' },
      event: { kind: 'run', origin: 'https://event-staging.example' },
      images: { kind: 'run', origin: 'https://images-staging.example' },
    });
  });

  test('一部のURLだけを設定すると、設定していない対象だけを対象外にする', () => {
    const targets = resolveBackendBaselineTargets(
      { E2E_API_URL: 'https://api-staging.example' },
      STAGING_CLIENT,
    );

    expect(targets.api.kind).toBe('run');
    expect(targets.event.kind).toBe('skip');
    expect(targets.images.kind).toBe('skip');
  });

  test('空文字のURLは未設定として扱う', () => {
    const targets = resolveBackendBaselineTargets(
      { E2E_API_URL: '', E2E_EVENT_URL: '', E2E_IMAGES_URL: '' },
      STAGING_CLIENT,
    );

    expect(targets.api.kind).toBe('skip');
    expect(targets.event.kind).toBe('skip');
    expect(targets.images.kind).toBe('skip');
  });

  test('画像配信のURLだけを設定すると、画像配信は設定の値で実行しイベントサーバーは対象外にする', () => {
    const targets = resolveBackendBaselineTargets(
      { E2E_IMAGES_URL: 'https://images-staging.example' },
      STAGING_CLIENT,
    );

    expect(targets.images).toEqual({
      kind: 'run',
      origin: 'https://images-staging.example',
    });
    expect(targets.event.kind).toBe('skip');
  });
});
