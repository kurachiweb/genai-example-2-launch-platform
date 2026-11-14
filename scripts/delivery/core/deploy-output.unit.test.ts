import { describe, expect, test } from 'bun:test';

import { parseDeployOutput } from './deploy-output.ts';

const VERSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

const DEPLOY_OUTPUT = [
  '',
  ' ⛅️ wrangler 4.124.0',
  '───────────────────',
  'Total Upload: 512.34 KiB / gzip: 120.11 KiB',
  'Worker Startup Time: 23 ms',
  'Your Worker has access to the following bindings:',
  'Binding                              Resource',
  'env.DB (app-staging)                 D1 Database',
  'env.APP_ENVIRONMENT ("staging")      Environment Variable',
  '',
  'Uploaded app-api-staging (5.12 sec)',
  'Deployed app-api-staging triggers (1.03 sec)',
  '  https://api-staging.launch.example',
  `Current Version ID: ${VERSION_ID}`,
  '',
].join('\n');

describe('parseDeployOutput', () => {
  test('デプロイの出力から版のIDと起動時間(ミリ秒)を読む', () => {
    expect(parseDeployOutput(DEPLOY_OUTPUT)).toEqual({
      versionId: VERSION_ID,
      startupTimeMs: 23,
    });
  });

  test('改行コードがCRLFでも読む', () => {
    expect(parseDeployOutput(DEPLOY_OUTPUT.replaceAll('\n', '\r\n'))).toEqual({
      versionId: VERSION_ID,
      startupTimeMs: 23,
    });
  });

  test('版のIDと起動時間の行が無ければ、それぞれ未定義を返す', () => {
    expect(parseDeployOutput('Uploaded app-api-staging (5.12 sec)\n')).toEqual({
      versionId: undefined,
      startupTimeMs: undefined,
    });
  });

  test('版のIDがUUIDの形でなく、起動時間が数でなければ読まない', () => {
    const output = [
      'Current Version ID: not-a-version',
      'Worker Startup Time: unknown ms',
    ].join('\n');

    expect(parseDeployOutput(output)).toEqual({
      versionId: undefined,
      startupTimeMs: undefined,
    });
  });

  test('行頭の空白と、行の中の別の文の一部には反応しない', () => {
    const output = [
      `  Current Version ID: ${VERSION_ID}`,
      'Previous Worker Startup Time: 99 ms',
    ].join('\n');

    expect(parseDeployOutput(output)).toEqual({
      versionId: VERSION_ID,
      startupTimeMs: undefined,
    });
  });
});
