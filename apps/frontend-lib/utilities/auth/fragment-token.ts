const TOKEN_PARAMETER = 'token';

// メールのリンクはトークンをフラグメントの`token=<値>`で渡す。フラグメントはサーバーへ送られず、アクセスログに残らない
export function readFragmentToken(hash: string): string | undefined {
  const parameters = new URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash,
  );
  const token = parameters.get(TOKEN_PARAMETER);
  return token === null || token === '' ? undefined : token;
}
