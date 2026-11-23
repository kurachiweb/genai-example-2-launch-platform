import { describe, expect, test } from 'bun:test';

import { isGitIgnored } from './test-support/git-ignore.ts';

const REPO_ROOT = import.meta.dirname;

const INFRA_ROOT_MODULE = 'apps/infra/live';

describe('OpenTofuのファイルの管理対象', () => {
  // 状態と計画は暗号化して保存するが、暗号化を外した実行や鍵の漏えいに備えてリポジトリへ入れない
  test.each([
    ['プロバイダとモジュールのキャッシュ', `${INFRA_ROOT_MODULE}/.terraform`],
    ['状態', `${INFRA_ROOT_MODULE}/terraform.tfstate`],
    ['状態の控え', `${INFRA_ROOT_MODULE}/terraform.tfstate.backup`],
    ['適用前の計画', `${INFRA_ROOT_MODULE}/staging.tfplan`],
    ['変数のファイル', `${INFRA_ROOT_MODULE}/staging.tfvars`],
    ['自動で読む変数のファイル', `${INFRA_ROOT_MODULE}/local.auto.tfvars`],
    ['クラッシュログ', `${INFRA_ROOT_MODULE}/crash.log`],
  ])('%sはGit管理外である', (_label, path) => {
    expect(isGitIgnored(REPO_ROOT, path)).toBe(true);
  });

  // CIと開発コンテナで同じハッシュのプロバイダを使うため、ロックファイルはリポジトリで共有する
  test('プロバイダのロックファイルは管理対象である', () => {
    expect(
      isGitIgnored(REPO_ROOT, `${INFRA_ROOT_MODULE}/.terraform.lock.hcl`),
    ).toBe(false);
  });
});

describe('検証の道具の出力先の管理対象', () => {
  // 合成データのSQLや計測の書き出しは大きく、他の環境の識別子を含み得るため、リポジトリへ入れない
  test.each([
    ['ルートのtmpの直下', 'tmp/synthetic-data/manifest.json'],
    ['ルートのtmpのディレクトリ自身', 'tmp/'],
  ])('%sはGit管理外である', (_label, path) => {
    expect(isGitIgnored(REPO_ROOT, path)).toBe(true);
  });

  test('ルート以外のtmpという名前のディレクトリは管理対象である', () => {
    expect(isGitIgnored(REPO_ROOT, 'scripts/readiness/tmp/example.ts')).toBe(
      false,
    );
  });
});
