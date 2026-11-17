import { describe, expect, test } from 'bun:test';

import {
  BACKEND_LAYER_PATTERNS,
  createBackendLayerRules,
  ERROR_TRACKING_RESTRICTION,
} from './backend-layers.ts';

describe('createBackendLayerRules', () => {
  test('srcの4層に対応する規則を、アプリ名を接頭辞にした名前で返す', () => {
    const rules = createBackendLayerRules('api');

    expect(rules.map(({ name, files }) => ({ name, files }))).toEqual([
      { name: 'api/layers/domain', files: ['src/domain/**'] },
      { name: 'api/layers/application', files: ['src/application/**'] },
      {
        name: 'api/layers/infrastructure-and-presentation',
        files: ['src/infrastructure/**', 'src/presentation/**'],
      },
    ]);
  });

  test('各層の規則の禁止が、公開した層ごとのパターンと同じである', () => {
    const patternsOf = (index: number) =>
      createBackendLayerRules('api')[index]?.rules?.['no-restricted-imports'];

    expect([patternsOf(0), patternsOf(1), patternsOf(2)]).toEqual(
      [
        BACKEND_LAYER_PATTERNS.domain,
        BACKEND_LAYER_PATTERNS.application,
        BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
      ].map((patterns) => ['error', { patterns }]),
    );
  });

  test('ドメイン層とアプリケーション層だけがエラートラッキングのSDKを禁じる', () => {
    const forbidsErrorTracking = (
      patterns: readonly { readonly group: readonly string[] }[],
    ) => patterns.some(({ group }) => group.includes('@sentry/*'));

    expect({
      domain: forbidsErrorTracking(BACKEND_LAYER_PATTERNS.domain),
      application: forbidsErrorTracking(BACKEND_LAYER_PATTERNS.application),
      infrastructureAndPresentation: forbidsErrorTracking(
        BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
      ),
    }).toEqual({
      domain: true,
      application: true,
      infrastructureAndPresentation: false,
    });
    expect(BACKEND_LAYER_PATTERNS.domain).toContain(ERROR_TRACKING_RESTRICTION);
    expect(BACKEND_LAYER_PATTERNS.application).toContain(
      ERROR_TRACKING_RESTRICTION,
    );
  });

  test('アプリが違っても名前以外の規則は同じになる', () => {
    const withoutName = (appName: string) =>
      createBackendLayerRules(appName).map(({ files, rules }) => ({
        files,
        rules,
      }));

    expect(withoutName('event')).toEqual(withoutName('api'));
  });
});
