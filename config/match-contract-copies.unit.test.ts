import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、子プロセスのbunで評価した値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const API_MATCH_ERRORS = 'apps/api/src/application/match/match-errors.ts';
const CLIENT_MATCH_CARD_MESSAGES =
  'apps/client/src/components/match/match-card-messages.ts';

const INPUT_VARIABLE = 'MATCH_CONTRACT_INPUT';

const COMPARISON_SCRIPT = `
const { modules } = JSON.parse(process.env.${INPUT_VARIABLE});
const [errors, messages] = await Promise.all([
  import(modules.errors),
  import(modules.messages),
]);
console.log(JSON.stringify({
  errors: Object.fromEntries(
    Object.entries(errors.MATCH_ERRORS).map(([code, { message }]) => [code, message]),
  ),
  reasons: messages.UPVOTE_DISABLED_REASONS,
}));
`;

interface MatchMessagesComparison {
  readonly errors: Readonly<Record<string, string | undefined>>;
  readonly reasons: Readonly<Record<string, string | undefined>>;
}

const compareMatchMessages = (): MatchMessagesComparison => {
  const result = Bun.spawnSync(
    [process.execPath, '--eval', COMPARISON_SCRIPT],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        [INPUT_VARIABLE]: JSON.stringify({
          modules: {
            errors: join(REPO_ROOT, API_MATCH_ERRORS),
            messages: join(REPO_ROOT, CLIENT_MATCH_CARD_MESSAGES),
          },
        }),
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `マッチの文言の比較が終了コード${String(result.exitCode)}で失敗しました: ${result.stderr.toString()}`,
    );
  }
  return JSON.parse(result.stdout.toString()) as MatchMessagesComparison;
};

// 画面のUpvoteの制限の値と、同じ理由でAPIサーバーが拒否するときのエラーコード
const RESTRICTION_ERROR_CODES = Object.freeze({
  OWN_MATCH: 'upvote_own_match',
  NOT_ACCEPTING: 'upvote_not_accepting',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  ACCOUNT_UNAVAILABLE: 'account_unavailable',
});

describe('Upvoteの無効の理由の文言の写し(components/match/match-card-messages.ts)', () => {
  test('画面のUPVOTE_DISABLED_REASONSが制限ごとにAPIサーバーのMATCH_ERRORSの文言と一致する', () => {
    const { errors, reasons } = compareMatchMessages();

    expect(Object.keys(reasons).toSorted()).toEqual(
      Object.keys(RESTRICTION_ERROR_CODES).toSorted(),
    );
    expect(reasons).toEqual(
      Object.fromEntries(
        Object.entries(RESTRICTION_ERROR_CODES).map(([restriction, code]) => [
          restriction,
          errors[code],
        ]),
      ),
    );
  });
});
