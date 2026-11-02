export const HOME_PATH = '/';

export interface LoginSearch {
  readonly redirect?: string;
}

// 戻り先を解釈する時だけに使う架空のオリジン。解釈の後もこのオリジンのままなら、値は同じサイト内のパスである
const RETURN_PATH_BASE = new URL('https://return-path.example');

// プロトコル相対のURLとして解釈される先頭(`//`・`/\`)
const startsLikeProtocolRelative = (path: string): boolean =>
  path.startsWith('//') || path.startsWith('/\\');

// タブと改行を除いた結果が不正なホストのプロトコル相対のURLになる値は解釈で例外になるため、トップページへ戻す値として扱う
const parseOnBase = (value: string): URL | undefined => {
  try {
    return new URL(value, RETURN_PATH_BASE);
  } catch {
    return undefined;
  }
};

// ブラウザはURLを解釈する時にタブと改行を取り除き、バックスラッシュをスラッシュとして扱い、ドットセグメントを畳むため、入力の先頭だけでなく、解釈した結果のオリジンと、正規化した後のパスの先頭も確かめる。正規化した後のパスが`//`で始まると、リンクやリダイレクトの行き先にした時に別のサイトへ移るため、先頭を畳まずに拒否する
export function toSafeReturnPath(value: string | undefined): string {
  if (
    value === undefined ||
    !value.startsWith('/') ||
    startsLikeProtocolRelative(value)
  ) {
    return HOME_PATH;
  }
  const url = parseOnBase(value);
  if (url === undefined) {
    return HOME_PATH;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (
    url.origin !== RETURN_PATH_BASE.origin ||
    startsLikeProtocolRelative(path)
  ) {
    return HOME_PATH;
  }
  return path;
}

export const toLoginSearch = (search: Record<string, unknown>): LoginSearch =>
  typeof search.redirect === 'string' ? { redirect: search.redirect } : {};
