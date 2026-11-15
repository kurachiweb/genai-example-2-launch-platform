import { describe, expect, test } from 'bun:test';

import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from './cursor-trail.ts';

const SCOPE = 'scope-a';

describe('previousPageOf', () => {
  test('1ページ目には前のページが無い', () => {
    expect(previousPageOf(EMPTY_CURSOR_TRAIL, SCOPE, undefined)).toStrictEqual({
      exists: false,
      after: undefined,
    });
  });

  test('辿ってきたページの1つ前の位置を返す', () => {
    const second = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, undefined, 'p2');
    const third = trailAfterNext(second, SCOPE, 'p2', 'p3');

    expect(previousPageOf(third, SCOPE, 'p3')).toStrictEqual({
      exists: true,
      after: 'p2',
    });
    expect(previousPageOf(third, SCOPE, 'p2')).toStrictEqual({
      exists: true,
      after: undefined,
    });
  });

  test('辿った記録の無い途中のページ(再読み込みや共有したURL)からは1ページ目へ戻す', () => {
    expect(previousPageOf(EMPTY_CURSOR_TRAIL, SCOPE, 'p5')).toStrictEqual({
      exists: true,
      after: undefined,
    });
  });

  test('条件が変わった後は前の条件で辿った記録を使わない', () => {
    const trail = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, undefined, 'p2');
    const third = trailAfterNext(trail, SCOPE, 'p2', 'p3');

    expect(previousPageOf(third, 'scope-b', 'p3')).toStrictEqual({
      exists: true,
      after: undefined,
    });
  });
});

describe('trailAfterNext', () => {
  test('ブラウザの戻る操作で前のページへ戻ってから次へ進むと、その先の記録を置き換える', () => {
    const second = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, undefined, 'p2');
    const third = trailAfterNext(second, SCOPE, 'p2', 'p3');
    const replaced = trailAfterNext(third, SCOPE, undefined, 'p2-new');

    expect(replaced).toStrictEqual({
      scope: SCOPE,
      cursors: [undefined, 'p2-new'],
    });
  });

  test('辿った記録の無い途中のページから進むと、そのページを起点に記録する', () => {
    const trail = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, 'p5', 'p6');

    expect(trail).toStrictEqual({ scope: SCOPE, cursors: ['p5', 'p6'] });
    expect(previousPageOf(trail, SCOPE, 'p6')).toStrictEqual({
      exists: true,
      after: 'p5',
    });
  });

  test('条件が変わった後に進むと、新しい条件の1ページ目から記録し直す', () => {
    const trail = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, undefined, 'p2');

    expect(trailAfterNext(trail, 'scope-b', undefined, 'q2')).toStrictEqual({
      scope: 'scope-b',
      cursors: [undefined, 'q2'],
    });
  });

  test('元の記録を書き換えない', () => {
    const trail = trailAfterNext(EMPTY_CURSOR_TRAIL, SCOPE, undefined, 'p2');
    trailAfterNext(trail, SCOPE, 'p2', 'p3');

    expect(trail).toStrictEqual({ scope: SCOPE, cursors: [undefined, 'p2'] });
    expect(EMPTY_CURSOR_TRAIL).toStrictEqual({
      scope: undefined,
      cursors: [],
    });
  });
});
