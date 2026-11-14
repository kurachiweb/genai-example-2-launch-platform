import { describe, expect, test } from 'bun:test';

import { WORKER_KEYS } from '../catalog/resource-catalog.ts';
import {
  ENVIRONMENT_OF_SCOPE,
  type SecretEntry,
  WORKER_SCOPED_SECRETS,
  WORKER_SECRET_FOLDERS,
  layerWorkerSecrets,
  maskableValues,
  parseInfisicalExport,
} from './secret-scope.ts';

const entry = (key: string, value: string): SecretEntry => ({ key, value });

describe('ENVIRONMENT_OF_SCOPE', () => {
  test('検査はdev、stagingのデプロイはstaging、prodのデプロイはprodの環境を取り出す', () => {
    expect(ENVIRONMENT_OF_SCOPE).toEqual({
      checks: 'dev',
      staging: 'staging',
      prod: 'prod',
    });
  });
});

describe('WORKER_SECRET_FOLDERS', () => {
  test('apiとeventだけがWorkerごとのフォルダを持ち、client・adminは持たない', () => {
    expect(WORKER_SECRET_FOLDERS).toEqual({
      api: '/workers/api',
      event: '/workers/event',
      client: undefined,
      admin: undefined,
    });
    expect(Object.keys(WORKER_SECRET_FOLDERS).toSorted()).toEqual(
      [...WORKER_KEYS].toSorted(),
    );
  });
});

describe('WORKER_SCOPED_SECRETS', () => {
  test('決済サービスの制限付きキーをWorkerごとのフォルダからだけ取る', () => {
    expect(WORKER_SCOPED_SECRETS).toEqual(['STRIPE_API_KEY']);
  });
});

describe('layerWorkerSecrets', () => {
  test('同じキーはWorkerごとのフォルダの値になり、順序は共通のフォルダの後にWorkerごとのフォルダだけのキーが並ぶ', () => {
    const layered = layerWorkerSecrets({
      shared: [entry('A', 'shared-a'), entry('B', 'shared-b')],
      perWorker: [entry('C', 'worker-c'), entry('A', 'worker-a')],
      workerScoped: [],
    });

    expect(layered).toEqual([
      entry('A', 'worker-a'),
      entry('B', 'shared-b'),
      entry('C', 'worker-c'),
    ]);
  });

  test('Workerごとに分けると定めたキーは、共通のフォルダの値を捨ててWorkerごとのフォルダの値だけを使う', () => {
    const layered = layerWorkerSecrets({
      shared: [entry('STRIPE_API_KEY', 'shared-key'), entry('B', 'shared-b')],
      perWorker: [entry('STRIPE_API_KEY', 'api-key')],
      workerScoped: WORKER_SCOPED_SECRETS,
    });

    expect(layered).toEqual([
      entry('B', 'shared-b'),
      entry('STRIPE_API_KEY', 'api-key'),
    ]);
  });

  test('Workerごとのフォルダが空なら、分けると定めたキーを除いた共通のフォルダの値だけになる', () => {
    const layered = layerWorkerSecrets({
      shared: [entry('STRIPE_API_KEY', 'shared-key'), entry('B', 'shared-b')],
      perWorker: [],
      workerScoped: WORKER_SCOPED_SECRETS,
    });

    expect(layered).toEqual([entry('B', 'shared-b')]);
  });

  test('同じフォルダに同じキーが重なれば後の値を使う', () => {
    expect(
      layerWorkerSecrets({
        shared: [entry('A', 'first'), entry('A', 'second')],
        perWorker: [],
        workerScoped: [],
      }),
    ).toEqual([entry('A', 'second')]);
  });
});

describe('parseInfisicalExport', () => {
  test('`infisical export --format=json`の配列からキーと値だけを取り込む', () => {
    const json = JSON.stringify([
      {
        key: 'HASH_PEPPER',
        value: 'pepper-value',
        type: 'shared',
        secretPath: '/',
        tags: [],
      },
      { key: 'MULTI', value: 'line-1\nline-2' },
    ]);

    expect(parseInfisicalExport(json)).toEqual([
      entry('HASH_PEPPER', 'pepper-value'),
      entry('MULTI', 'line-1\nline-2'),
    ]);
  });

  test.each(['[]', 'null', ' null\n'])(
    '空のフォルダの出力(%p)は空の一覧として取り込む',
    (json) => {
      expect(parseInfisicalExport(json)).toEqual([]);
    },
  );

  test('JSONとして解析できなければ、出力の中身を含めずに失敗を返す', () => {
    const result = parseInfisicalExport('KEY=leaked-value');

    expect(result).toEqual({
      error: '`infisical export`の出力をJSONとして解析できません',
    });
    expect(JSON.stringify(result)).not.toContain('leaked-value');
  });

  test.each([
    ['{"key":"A","value":"leaked-value"}', '配列ではありません'],
    ['[{"key":"A"}]', '1番目の要素に文字列のkeyとvalueがありません'],
    [
      '[{"key":"A","value":"ok"},{"key":"","value":"leaked-value"}]',
      '2番目の要素に文字列のkeyとvalueがありません',
    ],
    [
      '[{"key":"A","value":"ok"},{"key":"B","value":1}]',
      '2番目の要素に文字列のkeyとvalueがありません',
    ],
    ['["leaked-value"]', '1番目の要素に文字列のkeyとvalueがありません'],
  ])('形の誤り(%p)を値を含めずに返す', (json, message) => {
    const result = parseInfisicalExport(json);

    expect(result).toEqual({
      error: `\`infisical export\`の出力が想定の形ではありません(${message})`,
    });
    expect(JSON.stringify(result)).not.toContain('leaked-value');
  });
});

describe('maskableValues', () => {
  test('空でない値を行ごとに重複なく返し、空白だけの行は除く', () => {
    expect(
      maskableValues([
        entry('A', 'single'),
        entry('B', '-----BEGIN-----\r\nbody\n\n  \n-----END-----'),
        entry('C', ''),
        entry('D', 'single'),
      ]),
    ).toEqual(['single', '-----BEGIN-----', 'body', '-----END-----']);
  });
});
