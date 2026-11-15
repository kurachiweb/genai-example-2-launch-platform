import { describe, expect, test } from 'bun:test';

import { DEPLOY_STAGES } from './deploy-stages.ts';

describe('DEPLOY_STAGES', () => {
  test('デプロイの段階が要件7の順(資源・照合・マイグレーション・Worker・ホスト名・購読・確認)に並ぶ', () => {
    expect(DEPLOY_STAGES).toEqual([
      'preflight',
      'tofu-foundation',
      'reconcile-ids',
      'migrate',
      'deploy-api',
      'deploy-event',
      'deploy-client',
      'deploy-admin',
      'tofu-routing',
      'email-subscription',
      'verify',
    ]);
  });
});
