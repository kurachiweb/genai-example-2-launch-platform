import { describe, expect, test } from 'bun:test';

import { resolveLocalWorkerOrigin } from './local-worker-origins.ts';
import { resolveReadinessTargets } from './readiness-targets.ts';

describe('resolveReadinessTargets', () => {
  test('環境変数が無いときはローカルの既定のオリジンを返す', () => {
    expect(resolveReadinessTargets({})).toEqual({
      api: 'http://localhost:48042',
      event: 'http://localhost:48043',
      images: 'http://localhost:48043',
    });
  });

  test('APIサーバーとイベントサーバーの既定値は上流の補助と同じである', () => {
    const targets = resolveReadinessTargets({});

    expect(targets.api).toBe(resolveLocalWorkerOrigin('api', {}));
    expect(targets.event).toBe(resolveLocalWorkerOrigin('event', {}));
  });

  test('環境変数で3つのURLをそれぞれ上書きできる', () => {
    const targets = resolveReadinessTargets({
      E2E_API_URL: 'https://api.example',
      E2E_EVENT_URL: 'https://event.example',
      E2E_IMAGES_URL: 'https://images.example',
    });

    expect(targets).toEqual({
      api: 'https://api.example',
      event: 'https://event.example',
      images: 'https://images.example',
    });
  });

  test('空文字は未設定と同じく既定値を使う', () => {
    const targets = resolveReadinessTargets({
      E2E_API_URL: '',
      E2E_EVENT_URL: '',
      E2E_IMAGES_URL: '',
    });

    expect(targets).toEqual(resolveReadinessTargets({}));
  });

  test('未定義の値は未設定と同じく既定値を使う', () => {
    const targets = resolveReadinessTargets({
      E2E_API_URL: undefined,
      E2E_IMAGES_URL: undefined,
    });

    expect(targets).toEqual(resolveReadinessTargets({}));
  });

  test('イベントサーバーだけを上書きしても画像配信の既定値は変わらない', () => {
    const targets = resolveReadinessTargets({
      E2E_EVENT_URL: 'https://event.example',
    });

    expect(targets.event).toBe('https://event.example');
    expect(targets.images).toBe('http://localhost:48043');
  });

  test('画像配信だけを上書きしてもAPIサーバーとイベントサーバーは変わらない', () => {
    const targets = resolveReadinessTargets({
      E2E_IMAGES_URL: 'https://images.example',
    });

    expect(targets.api).toBe('http://localhost:48042');
    expect(targets.event).toBe('http://localhost:48043');
    expect(targets.images).toBe('https://images.example');
  });
});
