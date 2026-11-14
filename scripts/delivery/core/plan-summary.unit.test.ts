import { describe, expect, test } from 'bun:test';

import {
  D1_ADDRESS,
  DATA_ADDRESS,
  PLAN_SECRET_VALUES,
  QUEUE_ADDRESS,
  R2_ADDRESS,
  ROUTING_ADDRESS,
  TURNSTILE_ADDRESS,
  planJsonOf,
} from '../test-fixtures/tofu-plan.ts';
import {
  type PlanChange,
  formatPlanSummary,
  summarizePlan,
} from './plan-summary.ts';

const expectNoSecret = (text: string): void => {
  for (const value of PLAN_SECRET_VALUES) expect(text).not.toContain(value);
};

describe('summarizePlan', () => {
  test('計画のJSONから資源のアドレスと操作の種類だけを返し、属性の値と変数の値を含めない', () => {
    const summary = summarizePlan(
      planJsonOf([
        [D1_ADDRESS, ['create']],
        [QUEUE_ADDRESS, ['no-op']],
        [TURNSTILE_ADDRESS, ['update']],
        [ROUTING_ADDRESS, ['delete', 'create']],
        [R2_ADDRESS, ['delete']],
        [DATA_ADDRESS, ['read']],
        [
          'module.storage.cloudflare_r2_bucket.this["files"]',
          ['create', 'delete'],
        ],
      ]),
    );

    expect(summary).toEqual([
      { address: D1_ADDRESS, action: 'create' },
      { address: QUEUE_ADDRESS, action: 'no-op' },
      { address: TURNSTILE_ADDRESS, action: 'update' },
      { address: ROUTING_ADDRESS, action: 'replace' },
      { address: R2_ADDRESS, action: 'delete' },
      { address: DATA_ADDRESS, action: 'read' },
      {
        address: 'module.storage.cloudflare_r2_bucket.this["files"]',
        action: 'replace',
      },
    ]);
    expectNoSecret(JSON.stringify(summary));
  });

  test('資源の変更の一覧が無い計画は空の一覧を返す', () => {
    expect(summarizePlan(JSON.stringify({ format_version: '1.2' }))).toEqual(
      [],
    );
  });

  test('JSONとして解析できなければ、出力の中身を引用せずに誤りを返す', () => {
    const result = summarizePlan('{"secret": "fake-turnstile-secret-value"');

    expect(result).toEqual({ error: '計画のJSONを解析できません' });
  });

  test.each([
    ['最上位が配列', '[]', '計画のJSONの最上位がオブジェクトではありません'],
    [
      '資源の変更の一覧が配列でない',
      JSON.stringify({
        resource_changes: { secret: 'fake-turnstile-secret-value' },
      }),
      '計画のJSONのresource_changesが配列ではありません',
    ],
    [
      'アドレスが無い',
      JSON.stringify({
        resource_changes: [{ change: { actions: ['create'] } }],
      }),
      '計画のJSONの1番目の資源の変更にアドレスがありません',
    ],
    [
      '操作の一覧が無い',
      JSON.stringify({
        resource_changes: [
          {
            address: D1_ADDRESS,
            change: { after: 'fake-turnstile-secret-value' },
          },
        ],
      }),
      `計画のJSONの${D1_ADDRESS}の操作の種類を判定できません`,
    ],
    [
      '想定外の操作の組み合わせ',
      planJsonOf([
        [D1_ADDRESS, ['create']],
        [QUEUE_ADDRESS, ['forget']],
      ]),
      `計画のJSONの${QUEUE_ADDRESS}の操作の種類を判定できません(forget)`,
    ],
  ])('%sなら誤りを返す', (_label, json, error) => {
    const result = summarizePlan(json);

    expect(result).toEqual({ error });
    expectNoSecret(JSON.stringify(result));
  });
});

describe('formatPlanSummary', () => {
  test('変更の無い資源を除いて操作の種類と資源のアドレスを並べ、件数を添える', () => {
    const changes: readonly PlanChange[] = [
      { address: D1_ADDRESS, action: 'create' },
      { address: QUEUE_ADDRESS, action: 'no-op' },
      { address: TURNSTILE_ADDRESS, action: 'update' },
    ];

    expect(formatPlanSummary(changes)).toBe(
      [
        `- create: \`${D1_ADDRESS}\``,
        `- update: \`${TURNSTILE_ADDRESS}\``,
        '',
        '作成1件・更新1件・作り直し0件・削除0件・変更なし1件',
        '',
      ].join('\n'),
    );
  });

  test('削除と作り直しがあれば、要約の先頭にその資源を挙げた警告を付ける', () => {
    const changes: readonly PlanChange[] = [
      { address: D1_ADDRESS, action: 'create' },
      { address: ROUTING_ADDRESS, action: 'replace' },
      { address: R2_ADDRESS, action: 'delete' },
    ];

    const lines = formatPlanSummary(changes).split('\n');

    expect(lines[0]).toBe(
      `警告: 計画に削除または作り直しが2件あります(replace: \`${ROUTING_ADDRESS}\`、delete: \`${R2_ADDRESS}\`)。`,
    );
    expect(lines).toContain(
      '作成1件・更新0件・作り直し1件・削除1件・変更なし0件',
    );
  });

  test('変更が無ければその旨を書き、警告を付けない', () => {
    const text = formatPlanSummary([
      { address: QUEUE_ADDRESS, action: 'no-op' },
    ]);

    expect(text).toBe(
      [
        '変更はありません。',
        '',
        '作成0件・更新0件・作り直し0件・削除0件・変更なし1件',
        '',
      ].join('\n'),
    );
  });

  test('データの読み取りは操作の種類readとして並べる', () => {
    const text = formatPlanSummary([{ address: DATA_ADDRESS, action: 'read' }]);

    expect(text.split('\n')[0]).toBe(`- read: \`${DATA_ADDRESS}\``);
  });
});
