import { describe, expect, test } from 'bun:test';

import {
  BACKEND_LAYER_PATTERNS,
  createBackendLayerRules,
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

  test('アプリが違っても名前以外の規則は同じになる', () => {
    const withoutName = (appName: string) =>
      createBackendLayerRules(appName).map(({ files, rules }) => ({
        files,
        rules,
      }));

    expect(withoutName('event')).toEqual(withoutName('api'));
  });
});
