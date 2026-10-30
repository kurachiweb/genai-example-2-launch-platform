import { describe, expect, test } from 'bun:test';

import {
  commitLinesOf,
  existingPullRequestUrlOf,
  releasePrBody,
  releasePrTitle,
  validateReleaseHead,
} from './release-pr.ts';

const RUN_URL = 'https://github.example/owner/repo/actions/runs/123';
const COMPARE_URL = 'https://github.example/owner/repo/compare/prod...main';
const SAME_REPO_URL = 'https://github.example/owner/repo/pull/7';
const FORK_URL = 'https://github.example/owner/repo/pull/9';

const listJsonOf = (entries: readonly unknown[]): string =>
  JSON.stringify(entries);

const commitsOf = (count: number): readonly string[] =>
  Array.from(
    { length: count },
    (_, index) => `${String(index).padStart(7, '0')} 変更${String(index)}`,
  );

describe('validateReleaseHead', () => {
  test.each([
    'main',
    'hotfix/fix-login',
    'hotfix/0',
    `hotfix/a${'b'.repeat(62)}`,
  ])('%pはリリースのheadとして受け付ける', (input) => {
    expect(validateReleaseHead(input)).toEqual({ ok: true, head: input });
  });

  test.each([
    ['prod'],
    [''],
    ['feature/login'],
    ['develop'],
    ['hotfix/'],
    ['hotfix'],
    ['hotfix/Fix'],
    ['hotfix/-fix'],
    ['hotfix/fix/login'],
    ['hotfix/fix_login'],
    [`hotfix/a${'b'.repeat(63)}`],
    ['main\n'],
    ['hotfix/fix\nmain'],
    ['main\r'],
    [' main'],
    ['refs/heads/main'],
    ['origin/main'],
  ])('%pはリリースのheadとして拒否し、理由を返す', (input) => {
    const result = validateReleaseHead(input);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('main');
    expect(result.ok ? '' : result.reason).toContain('hotfix/');
  });

  test('拒否の理由には受け取った値をJSONの文字列として示し、改行をそのまま出さない', () => {
    const result = validateReleaseHead('hotfix/fix\nmain');

    expect(result.ok ? '' : result.reason).toContain('"hotfix/fix\\nmain"');
  });
});

describe('releasePrTitle', () => {
  test('headからprodへのリリースの題名を返す', () => {
    expect(releasePrTitle('main')).toBe('リリース: main → prod');
    expect(releasePrTitle('hotfix/fix-login')).toBe(
      'リリース: hotfix/fix-login → prod',
    );
  });
});

describe('releasePrBody', () => {
  const commits = ['abc1234 機能を追加する', 'def5678 不具合を直す'];

  test('headとprodの間のコミットの一覧を本文に含める', () => {
    const body = releasePrBody('main', commits, RUN_URL, COMPARE_URL);

    expect(body).toContain('main');
    expect(body).toContain('abc1234 機能を追加する\ndef5678 不具合を直す');
  });

  test('stagingでの確認・Expand/Contract・prodの識別子の反映の未チェックの確認項目を含める', () => {
    const body = releasePrBody('main', commits, RUN_URL, COMPARE_URL);
    const checklist = body
      .split('\n')
      .filter((line) => line.startsWith('- [ ] '));

    expect(checklist).toHaveLength(3);
    expect(checklist[0]).toContain('staging');
    expect(checklist[1]).toContain('Expand/Contract');
    expect(checklist[2]).toContain('prodの識別子');
    expect(body).not.toContain('- [x]');
  });

  test('PRを作ったワークフローの実行のURLを含める', () => {
    expect(releasePrBody('main', commits, RUN_URL, COMPARE_URL)).toContain(
      RUN_URL,
    );
  });

  test('コミットのメッセージを、中のバッククォートの並びより長い囲みのコードブロックに入れ、確認項目やメンションとして解釈させない', () => {
    const tricky = [
      'aaa1111 - [x] stagingで確認した',
      'bbb2222 ```` を含む @someone',
    ];

    const body = releasePrBody(
      'hotfix/fix-login',
      tricky,
      RUN_URL,
      COMPARE_URL,
    );
    const lines = body.split('\n');
    const open = lines.indexOf('`````text');

    expect(open).toBeGreaterThan(-1);
    expect(lines.slice(open + 1, open + 4)).toEqual([...tricky, '`````']);
    expect(lines.filter((line) => line.startsWith('- [x]'))).toEqual([]);
  });

  test('コミットのメッセージにバッククォートが無ければ3つのバッククォートで囲む', () => {
    const lines = releasePrBody('main', commits, RUN_URL, COMPARE_URL).split(
      '\n',
    );

    expect(lines).toContain('```text');
    expect(lines).toContain('```');
  });

  test('コミットが上限の200件以下なら、すべてを載せて比較のURLを示さない', () => {
    const body = releasePrBody('main', commitsOf(200), RUN_URL, COMPARE_URL);

    expect(body).toContain('0000199 変更199');
    expect(body).not.toContain('ほか');
    expect(body).not.toContain(COMPARE_URL);
  });

  test('コミットが200件を超えたら、先頭の200件だけを載せ、残りの件数と比較のURLを示す', () => {
    const body = releasePrBody('main', commitsOf(1000), RUN_URL, COMPARE_URL);

    expect(body).toContain('## コミット(1000件)');
    expect(body).toContain('0000199 変更199');
    expect(body).not.toContain('0000200 変更200');
    expect(body).toContain('…ほか800件');
    expect(body).toContain(COMPARE_URL);
  });

  test('長いコミットの行は200文字で打ち切り、本文をPRの本文の上限(65,536文字)に収める', () => {
    const longLine = `abc1234 ${'`'.repeat(70_000)}`;
    const commits = Array.from({ length: 300 }, () => longLine);

    const body = releasePrBody('main', commits, RUN_URL, COMPARE_URL);

    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body).toContain(`${longLine.slice(0, 199)}…`);
    expect(body).not.toContain(longLine.slice(0, 200));
  });
});

describe('existingPullRequestUrlOf', () => {
  test('一覧が空なら、既存のPRが無いことを返す', () => {
    expect(existingPullRequestUrlOf('[]')).toEqual({
      ok: true,
      url: undefined,
    });
  });

  test('同じリポジトリのPRがあれば、そのURLを返す', () => {
    expect(
      existingPullRequestUrlOf(
        `${listJsonOf([{ url: SAME_REPO_URL, isCrossRepository: false }])}\n`,
      ),
    ).toEqual({ ok: true, url: SAME_REPO_URL });
  });

  test('フォークからのPRだけなら、既存のリリースのPRとみなさない', () => {
    expect(
      existingPullRequestUrlOf(
        listJsonOf([{ url: FORK_URL, isCrossRepository: true }]),
      ),
    ).toEqual({ ok: true, url: undefined });
  });

  test('フォークからのPRと同じリポジトリのPRがあれば、同じリポジトリのPRのURLを返す', () => {
    expect(
      existingPullRequestUrlOf(
        listJsonOf([
          { url: FORK_URL, isCrossRepository: true },
          { url: SAME_REPO_URL, isCrossRepository: false },
        ]),
      ),
    ).toEqual({ ok: true, url: SAME_REPO_URL });
  });

  test.each([
    '',
    'not json',
    '{}',
    '[{}]',
    listJsonOf([{ url: '', isCrossRepository: false }]),
    listJsonOf([{ url: 1, isCrossRepository: false }]),
    listJsonOf([{ url: SAME_REPO_URL }]),
    listJsonOf([{ url: FORK_URL, isCrossRepository: 'true' }]),
    listJsonOf([
      { url: SAME_REPO_URL, isCrossRepository: false },
      { url: FORK_URL },
    ]),
  ])('%pは読み取れない一覧として扱う', (json) => {
    expect(existingPullRequestUrlOf(json).ok).toBe(false);
  });
});

describe('commitLinesOf', () => {
  test('git logの出力を空行を除いた行の一覧にする', () => {
    expect(commitLinesOf('abc1234 一つ目\r\ndef5678 二つ目\n\n')).toEqual([
      'abc1234 一つ目',
      'def5678 二つ目',
    ]);
  });

  test('出力が空ならコミットは無い', () => {
    expect(commitLinesOf('')).toEqual([]);
    expect(commitLinesOf('\n')).toEqual([]);
  });
});
