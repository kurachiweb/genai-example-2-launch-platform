export type ReleaseHead =
  | { readonly ok: true; readonly head: string }
  | { readonly ok: false; readonly reason: string };

export type ExistingPullRequest =
  | { readonly ok: true; readonly url: string | undefined }
  | { readonly ok: false };

interface PullRequestEntry {
  readonly url: string;
  readonly isCrossRepository: boolean;
}

export const RELEASE_BASE = 'prod';
const MAX_LISTED_COMMITS = 200;
const MAX_COMMIT_LINE_LENGTH = 200;

const RELEASE_HEAD_PATTERN = /^(?:main|hotfix\/[a-z0-9][a-z0-9-]{0,62})$/;
const MIN_FENCE_LENGTH = 3;
const ELLIPSIS = '…';

export function validateReleaseHead(input: string): ReleaseHead {
  if (RELEASE_HEAD_PATTERN.test(input)) return { ok: true, head: input };
  return {
    ok: false,
    reason: `リリースのheadはmainか、hotfix/<英小文字・数字・ハイフンの名前>(64文字まで、先頭は英小文字か数字)にしてください(実際: ${JSON.stringify(input)})`,
  };
}

export function releasePrTitle(head: string): string {
  return `リリース: ${head} → ${RELEASE_BASE}`;
}

const truncateLine = (line: string): string => {
  const characters = Array.from(line);
  return characters.length <= MAX_COMMIT_LINE_LENGTH
    ? line
    : `${characters.slice(0, MAX_COMMIT_LINE_LENGTH - 1).join('')}${ELLIPSIS}`;
};

const longestBacktickRunOf = (text: string): number =>
  Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));

// コミットのメッセージが確認項目・メンション・Markdownとして解釈されると承認者を誤らせるため、中のバッククォートの並びより長い囲みのコードブロックに入れる
const fencedCommitsOf = (commits: readonly string[]): string => {
  const listed = commits.join('\n');
  const fence = '`'.repeat(
    Math.max(MIN_FENCE_LENGTH, longestBacktickRunOf(listed) + 1),
  );
  return `${fence}text\n${listed}\n${fence}`;
};

// GitHubのPRの本文は65,536文字までのため、載せる件数と1行の長さを打ち切り、残りは比較の画面で見せる
const commitSectionOf = (
  commits: readonly string[],
  compareUrl: string,
): readonly string[] => {
  const listed = commits.slice(0, MAX_LISTED_COMMITS).map(truncateLine);
  const omitted = commits.length - listed.length;
  const fenced = fencedCommitsOf(listed);
  if (omitted === 0) return [fenced];
  return [
    fenced,
    '',
    `${ELLIPSIS}ほか${String(omitted)}件。すべてのコミットは比較の画面で確かめてください: ${compareUrl}`,
  ];
};

export function releasePrBody(
  head: string,
  commits: readonly string[],
  runUrl: string,
  compareUrl: string,
): string {
  return [
    `${head}から${RELEASE_BASE}へのリリースです。マージするとprodへデプロイされます。`,
    '',
    `## コミット(${String(commits.length)}件)`,
    '',
    ...commitSectionOf(commits, compareUrl),
    '',
    '## 確認項目',
    '',
    '- [ ] stagingへのデプロイと、stagingでの変更の確認が成功している',
    '- [ ] DBスキーマの変更がExpand/Contractに従い、このリリースのマイグレーションが直前の版のコードと両立する',
    '- [ ] prodの識別子(資源一覧とWrangler設定)の反映が必要なら、反映済みである',
    '',
    '## 作成したワークフローの実行',
    '',
    runUrl,
    '',
  ].join('\n');
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const entryOf = (entry: unknown): PullRequestEntry | undefined => {
  if (!isRecord(entry)) return undefined;
  const { url, isCrossRepository } = entry;
  if (typeof url !== 'string' || url === '') return undefined;
  if (typeof isCrossRepository !== 'boolean') return undefined;
  return { url, isCrossRepository };
};

// ghのheadの絞り込みはブランチ名だけで比べ、フォークの同名のブランチからのPRも返すため、同じリポジトリのPRだけを既存のリリースのPRとみなす
export function existingPullRequestUrlOf(json: string): ExistingPullRequest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(value)) return { ok: false };
  const entries = value.map(entryOf);
  if (!entries.every((entry) => entry !== undefined)) return { ok: false };
  const sameRepository = entries.find((entry) => !entry.isCrossRepository);
  return { ok: true, url: sameRepository?.url };
}

export function commitLinesOf(gitLog: string): readonly string[] {
  return gitLog
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
}
