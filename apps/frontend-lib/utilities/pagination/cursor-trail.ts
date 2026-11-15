// 同じ条件で1ページ目から順に開いたページのカーソル。1ページ目はundefined
export interface CursorTrail {
  readonly scope: string | undefined;
  readonly cursors: readonly (string | undefined)[];
}

export interface PreviousPage {
  readonly exists: boolean;
  readonly after: string | undefined;
}

export const EMPTY_CURSOR_TRAIL: CursorTrail = Object.freeze({
  scope: undefined,
  cursors: Object.freeze([]),
});

const cursorsIn = (
  trail: CursorTrail,
  scope: string,
): readonly (string | undefined)[] =>
  trail.scope === scope ? trail.cursors : [];

// カーソルは次のページの位置しか示さないため、前のページは辿った記録から求める。記録の無い途中のページ(再読み込みや共有したURL)からは1ページ目へ戻す
export function previousPageOf(
  trail: CursorTrail,
  scope: string,
  current: string | undefined,
): PreviousPage {
  if (current === undefined) {
    return { exists: false, after: undefined };
  }
  const cursors = cursorsIn(trail, scope);
  const index = cursors.indexOf(current);
  return { exists: true, after: index > 0 ? cursors[index - 1] : undefined };
}

// ブラウザの戻る・進む操作で今のページが記録の途中にあっても、今のページより先の記録を次のページで置き換える
export function trailAfterNext(
  trail: CursorTrail,
  scope: string,
  current: string | undefined,
  next: string,
): CursorTrail {
  const cursors = cursorsIn(trail, scope);
  const index = cursors.indexOf(current);
  const visited = index === -1 ? [current] : cursors.slice(0, index + 1);
  return { scope, cursors: [...visited, next] };
}
