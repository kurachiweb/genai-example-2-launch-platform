import { describe, expect, test } from 'bun:test';

import { localD1ExecuteArgs, parseLocalD1Output } from './local-d1-command.ts';

const SELECT_SQL = "SELECT id FROM admins WHERE email = 'e2e@test.example';";

describe('localD1ExecuteArgs', () => {
  test('ローカルのD1を共有のローカル状態の保存先で操作し、結果をJSONで出力する引数を返す', () => {
    expect(localD1ExecuteArgs(SELECT_SQL)).toStrictEqual([
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      '/workspace/.wrangler/state',
      '--json',
      '--command',
      SELECT_SQL,
    ]);
  });

  test('リモートのD1を操作する引数を含まない', () => {
    expect(localD1ExecuteArgs(SELECT_SQL)).not.toContain('--remote');
  });
});

describe('parseLocalD1Output', () => {
  test('1つの文の結果の行を返す', () => {
    const stdout = JSON.stringify([
      { results: [{ id: 'A1' }, { id: 'A2' }], success: true, meta: {} },
    ]);

    expect(parseLocalD1Output(stdout)).toStrictEqual([
      { id: 'A1' },
      { id: 'A2' },
    ]);
  });

  test('複数の文の結果の行を、文の順に並べて返す', () => {
    const stdout = JSON.stringify([
      { results: [], success: true, meta: {} },
      { results: [{ id: 'B1' }], success: true, meta: {} },
    ]);

    expect(parseLocalD1Output(stdout)).toStrictEqual([{ id: 'B1' }]);
  });

  test('行を返さない文だけなら空の配列を返す', () => {
    expect(
      parseLocalD1Output(JSON.stringify([{ results: [], success: true }])),
    ).toStrictEqual([]);
  });

  test.each([
    ['JSONでない', 'エラーが発生しました'],
    ['配列でない', JSON.stringify({ results: [] })],
    ['結果の行が配列でない', JSON.stringify([{ results: 'x' }])],
    ['行がオブジェクトでない', JSON.stringify([{ results: [1] }])],
    ['文の結果がオブジェクトでない', JSON.stringify(['x'])],
  ])('出力が%s場合は、出力を示して失敗する', (_label, stdout) => {
    expect(() => parseLocalD1Output(stdout)).toThrow(
      `ローカルのD1の実行結果の形式が正しくありません: ${stdout}`,
    );
  });
});
