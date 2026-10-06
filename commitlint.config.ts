import { RuleConfigSeverity, type UserConfig } from '@commitlint/types';

export const ALLOWED_COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'perf',
  'ci',
] as const;

const config: UserConfig = {
  rules: {
    'type-empty': [RuleConfigSeverity.Error, 'never'],
    'subject-empty': [RuleConfigSeverity.Error, 'never'],
    'type-enum': [RuleConfigSeverity.Error, 'always', ALLOWED_COMMIT_TYPES],
  },
  // commitlintは違反があった時だけhelpUrlを表示するため、どの規則の違反でも書式と許可された型の一覧を案内できるよう、URLの代わりに案内文を設定する
  helpUrl: `1行目は「型(任意のスコープ): 件名」の形式で、型は次のいずれか: ${ALLOWED_COMMIT_TYPES.join(', ')}`,
};

export default config;
