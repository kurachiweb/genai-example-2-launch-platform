import { appendFileSync } from 'node:fs';

export interface GithubActionsIo {
  mask(value: string): void;
  exportEnv(key: string, value: string): void;
  summary(markdown: string): void;
  oidcToken(audience: string): Promise<string>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GithubActionsIoOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { readonly write: (text: string) => unknown };
  readonly fetch: FetchLike;
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ワークフローのコマンドは改行でコマンドを区切り%を区切りの表記として解釈するため、値の%・\r・\nを表記に変換して1つのコマンドに収める
const escapeCommandValue = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const isOidcResponse = (body: unknown): body is { readonly value: string } =>
  typeof body === 'object' &&
  body !== null &&
  'value' in body &&
  typeof body.value === 'string' &&
  body.value !== '';

export function createGithubActionsIo({
  env,
  stdout,
  fetch,
}: GithubActionsIoOptions): GithubActionsIo {
  // マスクのコマンドは1行ずつしか効かないため、複数行の値は行ごとにマスクする。空白だけの行をマスクするとログの空白がすべて伏せられるため除く
  const mask = (value: string): void => {
    if (env.GITHUB_ACTIONS !== 'true') return;
    for (const line of value.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      stdout.write(`::add-mask::${escapeCommandValue(line)}\n`);
    }
  };

  const exportEnv = (key: string, value: string): void => {
    if (!ENV_NAME_PATTERN.test(key)) {
      throw new Error(`環境変数の名前が不正です: ${JSON.stringify(key)}`);
    }
    const envFile = env.GITHUB_ENV;
    if (envFile === undefined || envFile === '') {
      throw new Error(`GITHUB_ENVが無いため、${key}を後続の手順へ渡せません`);
    }
    mask(value);
    const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
    appendFileSync(envFile, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  };

  const summary = (markdown: string): void => {
    const summaryFile = env.GITHUB_STEP_SUMMARY;
    if (summaryFile === undefined || summaryFile === '') return;
    appendFileSync(
      summaryFile,
      markdown.endsWith('\n') ? markdown : `${markdown}\n`,
    );
  };

  const oidcToken = async (audience: string): Promise<string> => {
    const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (
      requestUrl === undefined ||
      requestUrl === '' ||
      requestToken === undefined ||
      requestToken === ''
    ) {
      throw new Error(
        'OIDCのトークンを取得できません。ジョブに`id-token: write`の権限があるか確かめてください(ACTIONS_ID_TOKEN_REQUEST_URL・ACTIONS_ID_TOKEN_REQUEST_TOKENがありません)',
      );
    }
    const url = new URL(requestUrl);
    url.searchParams.set('audience', audience);
    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${requestToken}`,
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(
        `OIDCのトークンの要求が失敗しました(状態コード${String(response.status)})`,
      );
    }
    const body: unknown = await response.json();
    if (!isOidcResponse(body)) {
      throw new Error('OIDCのトークンの応答にトークンがありません');
    }
    mask(body.value);
    return body.value;
  };

  return { mask, exportEnv, summary, oidcToken };
}
