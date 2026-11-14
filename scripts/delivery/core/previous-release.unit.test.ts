import { describe, expect, test } from 'bun:test';

import {
  fullyDeployedVersionOf,
  isCommitSha,
  previousReleaseFromVersions,
} from './previous-release.ts';

const VERSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_VERSION_ID = '00000000-0000-4000-8000-000000000000';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const statusJsonOf = (
  versions: readonly {
    readonly version_id: string;
    readonly percentage: number;
  }[],
): string =>
  JSON.stringify(
    {
      id: '11111111-1111-4111-8111-111111111111',
      created_on: '2026-10-29T00:00:00.000000Z',
      source: 'wrangler',
      strategy: 'percentage',
      author_email: 'ci@launch.example',
      annotations: { 'workers/triggered_by': 'deployment' },
      versions,
    },
    null,
    2,
  );

const FULL_STATUS = statusJsonOf([{ version_id: VERSION_ID, percentage: 100 }]);

const viewJsonOf = (annotations?: Readonly<Record<string, string>>): string =>
  JSON.stringify(
    {
      id: VERSION_ID,
      number: 7,
      metadata: {
        created_on: '2026-10-29T00:00:00.000000Z',
        source: 'wrangler',
        author_email: 'ci@launch.example',
      },
      ...(annotations === undefined ? {} : { annotations }),
      resources: { bindings: [], script: {}, script_runtime: {} },
    },
    null,
    2,
  );

const viewsOf =
  (views: Readonly<Record<string, string>>) =>
  (versionId: string): string | undefined =>
    views[versionId];

const reasonOf = (
  release: ReturnType<typeof previousReleaseFromVersions>,
): string => (release.kind === 'unknown' ? release.reason : '');

describe('isCommitSha', () => {
  test.each([
    [COMMIT, true],
    ['0123456789ABCDEF0123456789ABCDEF01234567', false],
    ['0123456', false],
    [`${COMMIT}0`, false],
    ['main', false],
    ['', false],
  ])('%pは%pを返す', (value, expected) => {
    expect(isCommitSha(value)).toBe(expected);
  });
});

describe('fullyDeployedVersionOf', () => {
  test('配信率100%の版が1つだけなら、その版のIDを返す', () => {
    expect(fullyDeployedVersionOf(FULL_STATUS)).toEqual({
      kind: 'found',
      versionId: VERSION_ID,
    });
  });

  test('分割配信なら、各版の配信率を示して特定できない理由を返す', () => {
    const release = fullyDeployedVersionOf(
      statusJsonOf([
        { version_id: VERSION_ID, percentage: 60 },
        { version_id: OTHER_VERSION_ID, percentage: 40 },
      ]),
    );

    expect(release.kind).toBe('unknown');
    const reason = release.kind === 'unknown' ? release.reason : '';
    expect(reason).toContain('分割配信');
    expect(reason).toContain(`${VERSION_ID} 60%`);
    expect(reason).toContain(`${OTHER_VERSION_ID} 40%`);
  });

  test.each([
    ['JSONでない', 'The Worker app-client-staging has no deployments.'],
    ['オブジェクトでない', '[]'],
    ['版の一覧が無い', '{"id":"x"}'],
    ['版の一覧が空', statusJsonOf([])],
    [
      '版の配信率が数でない',
      '{"versions":[{"version_id":"01234567-89ab-4cde-8f01-23456789abcd","percentage":"100"}]}',
    ],
    [
      '版のIDが識別子の形でない',
      statusJsonOf([{ version_id: '--help', percentage: 100 }]),
    ],
  ])('版の状態が%sなら、読み取れない理由を返す', (_, json) => {
    const release = fullyDeployedVersionOf(json);

    expect(release.kind).toBe('unknown');
    expect(release.kind === 'unknown' ? release.reason : '').toContain(
      '版の状態',
    );
  });
});

describe('previousReleaseFromVersions', () => {
  test('配信率100%の版のタグが40桁の16進なら、そのコミットを直前のリリースとする', () => {
    const release = previousReleaseFromVersions(
      FULL_STATUS,
      viewsOf({
        [VERSION_ID]: viewJsonOf({
          'workers/tag': COMMIT,
          'workers/message': `${COMMIT} https://github.example/example/launch/actions/runs/42`,
        }),
      }),
    );

    expect(release).toEqual({ kind: 'found', commit: COMMIT });
  });

  test('タグが無ければ、版のIDを示して特定できない理由を返す', () => {
    const release = previousReleaseFromVersions(
      FULL_STATUS,
      viewsOf({ [VERSION_ID]: viewJsonOf() }),
    );

    expect(release.kind).toBe('unknown');
    expect(reasonOf(release)).toContain(VERSION_ID);
    expect(reasonOf(release)).toContain('タグがありません');
  });

  test('注釈にタグが無ければ、タグが無いことを理由にする', () => {
    const release = previousReleaseFromVersions(
      FULL_STATUS,
      viewsOf({ [VERSION_ID]: viewJsonOf({ 'workers/message': 'manual' }) }),
    );

    expect(reasonOf(release)).toContain('タグがありません');
  });

  test.each(['v1.2.3', 'main', COMMIT.slice(0, 7), COMMIT.toUpperCase()])(
    'タグ%pがコミットのSHAでなければ、タグを示して特定できない理由を返す',
    (tag) => {
      const release = previousReleaseFromVersions(
        FULL_STATUS,
        viewsOf({ [VERSION_ID]: viewJsonOf({ 'workers/tag': tag }) }),
      );

      expect(release.kind).toBe('unknown');
      expect(reasonOf(release)).toContain(tag);
      expect(reasonOf(release)).toContain('40桁の16進');
    },
  );

  test('分割配信なら、版の情報を読まずに特定できない理由を返す', () => {
    const requested: string[] = [];
    const release = previousReleaseFromVersions(
      statusJsonOf([
        { version_id: VERSION_ID, percentage: 50 },
        { version_id: OTHER_VERSION_ID, percentage: 50 },
      ]),
      (versionId) => {
        requested.push(versionId);
        return viewJsonOf({ 'workers/tag': COMMIT });
      },
    );

    expect(release.kind).toBe('unknown');
    expect(reasonOf(release)).toContain('分割配信');
    expect(requested).toEqual([]);
  });

  test('版の情報が得られなければ、版のIDを示して特定できない理由を返す', () => {
    const release = previousReleaseFromVersions(FULL_STATUS, viewsOf({}));

    expect(release.kind).toBe('unknown');
    expect(reasonOf(release)).toContain(VERSION_ID);
    expect(reasonOf(release)).toContain('版の情報');
  });

  test.each([
    ['JSONでない', 'Error: version not found'],
    ['オブジェクトでない', 'null'],
    ['注釈がオブジェクトでない', '{"annotations":"workers/tag"}'],
    ['タグが文字列でない', '{"annotations":{"workers/tag":1}}'],
  ])('版の情報が%sなら、特定できない理由を返す', (_, json) => {
    const release = previousReleaseFromVersions(
      FULL_STATUS,
      viewsOf({ [VERSION_ID]: json }),
    );

    expect(release.kind).toBe('unknown');
    expect(reasonOf(release)).toContain(VERSION_ID);
  });
});
