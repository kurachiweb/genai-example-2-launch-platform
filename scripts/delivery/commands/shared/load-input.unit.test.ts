import { describe, expect, test } from 'bun:test';

import { createFakeRepoFiles } from '../../test-fixtures/repo-files.ts';
import {
  allLoaded,
  errorsOf,
  failed,
  loaded,
  parseInput,
  readInput,
} from './load-input.ts';

describe('allLoaded・errorsOf', () => {
  test('全て読み込めれば値を順に並べ、1つでも失敗すれば重複を除いた誤りを順に返す', () => {
    expect(allLoaded([loaded('a'), loaded('b')])).toEqual(loaded(['a', 'b']));
    expect(
      allLoaded([loaded('a'), failed(['x', 'y']), failed<string>(['x', 'z'])]),
    ).toEqual(failed(['x', 'y', 'z']));
    expect(errorsOf([loaded(1), failed(['x'])])).toEqual(['x']);
  });
});

describe('readInput', () => {
  test('読み込めたファイルは内容を、読み込めないファイルは誤りの文を返す', async () => {
    const files = createFakeRepoFiles({ 'a.txt': 'text' });

    expect(await readInput(files, 'a.txt')).toEqual(loaded('text'));
    expect(await readInput(files, 'b.txt')).toEqual(
      failed(['b.txtを読み込めませんでした: ENOENT: no such file']),
    );
  });
});

describe('parseInput', () => {
  test('解析の例外を、ファイルのパスと形式を付けた誤りの文にする', () => {
    expect(parseInput('a.json', '{"a":1}', 'JSON', JSON.parse)).toEqual(
      loaded({ a: 1 }),
    );
    expect(
      parseInput('a.json', '{', 'JSON', () => {
        throw new Error('壊れています');
      }),
    ).toEqual(failed(['a.json: JSONとして解析できません(壊れています)']));
  });
});
