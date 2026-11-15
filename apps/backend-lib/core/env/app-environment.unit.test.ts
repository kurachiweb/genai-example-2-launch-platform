import { describe, expect, test } from 'bun:test';

import {
  APP_ENVIRONMENTS,
  type AppEnvironment,
  isDeployedEnvironment,
  isDeployedEnvironmentValue,
} from './app-environment.ts';

describe('APP_ENVIRONMENTS', () => {
  test('環境の種別はローカル・ステージング・本番の3つで、実行時に書き換えられない', () => {
    expect(APP_ENVIRONMENTS).toEqual(['local', 'staging', 'prod']);
    expect(Object.isFrozen(APP_ENVIRONMENTS)).toBe(true);
  });
});

describe('isDeployedEnvironment', () => {
  test.each([
    ['local', false],
    ['staging', true],
    ['prod', true],
  ] as const satisfies readonly (readonly [AppEnvironment, boolean])[])(
    '%sをデプロイ先と判定するかは%pになる',
    (environment, expected) => {
      expect(isDeployedEnvironment(environment)).toBe(expected);
    },
  );
});

describe('isDeployedEnvironmentValue', () => {
  test.each([
    ['local', false],
    ['staging', true],
    ['prod', true],
    ['production', false],
    ['', false],
    [undefined, false],
    [1, false],
  ] as const)(
    '検証前の値%pをデプロイ先と判定するかは%pになる',
    (value, expected) => {
      expect(isDeployedEnvironmentValue(value)).toBe(expected);
    },
  );
});
