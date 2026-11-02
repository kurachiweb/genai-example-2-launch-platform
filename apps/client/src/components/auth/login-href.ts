export const LOGIN_PATH = '/auth/login';

export const REGISTER_PATH = '/auth/register';

// ルーターの検索パラメータの既定の書式と同じく、文字列の値をURLの符号化だけで書く
export const loginHrefFor = (returnTo: string): string =>
  `${LOGIN_PATH}?${new URLSearchParams({ redirect: returnTo }).toString()}`;
