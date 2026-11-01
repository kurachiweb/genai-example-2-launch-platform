import { describe, expect, test } from 'bun:test';

import {
  desiredLocation,
  type MediaLocation,
  type MediaOwner,
  type ModerationFinding,
  type ModerationStatus,
  QUARANTINE_REASONS,
  type QuarantineReason,
} from './media-file.ts';
import type { MediaStorage } from './upload-purpose.ts';

describe('QUARANTINE_REASONS', () => {
  test('自動判定・非公開化・ユーザー停止・管理者操作の4種を重複なく持つ', () => {
    expect(QUARANTINE_REASONS).toEqual([
      'auto',
      'product_hidden',
      'user_suspended',
      'admin_action',
    ]);
    expect(new Set(QUARANTINE_REASONS).size).toBe(QUARANTINE_REASONS.length);
  });

  test('型の全ての値を過不足なく並べている', () => {
    const reasons = {
      auto: true,
      product_hidden: true,
      user_suspended: true,
      admin_action: true,
    } as const satisfies Record<QuarantineReason, true>;

    expect(Object.keys(reasons).toSorted()).toEqual(
      [...QUARANTINE_REASONS].toSorted(),
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(QUARANTINE_REASONS)).toBe(true);
  });
});

describe('desiredLocation', () => {
  test.each<[string, readonly QuarantineReason[]]>([
    ['理由なし', []],
    ['理由1つ', ['auto']],
    ['理由が複数', ['auto', 'user_suspended', 'admin_action']],
  ])(
    'ファイル用の保存先は%sでもファイル用非公開バケットになる',
    (_label, reasons) => {
      expect(desiredLocation('files', reasons)).toBe('files');
    },
  );

  test('画像用の保存先は理由が無ければ画像用非公開バケットになる', () => {
    expect(desiredLocation('images', [])).toBe('images');
  });

  test.each<QuarantineReason>([...QUARANTINE_REASONS])(
    '画像用の保存先は理由%sが1つあれば隔離バケットになる',
    (reason) => {
      expect(desiredLocation('images', [reason])).toBe('quarantine');
    },
  );

  test('画像用の保存先は理由が複数あれば隔離バケットになる', () => {
    expect(desiredLocation('images', ['product_hidden', 'admin_action'])).toBe(
      'quarantine',
    );
  });

  test('画像用の保存先は全ての理由を持てば隔離バケットになる', () => {
    expect(desiredLocation('images', QUARANTINE_REASONS)).toBe('quarantine');
  });

  test('引数の理由の一覧を書き換えない', () => {
    const reasons: QuarantineReason[] = ['user_suspended', 'auto'];

    desiredLocation('images', reasons);

    expect(reasons).toEqual(['user_suspended', 'auto']);
  });

  test('保存先と理由の有無の全組み合わせで3つの保存先のいずれかを返す', () => {
    const storages: readonly MediaStorage[] = ['images', 'files'];
    const reasonSets: readonly (readonly QuarantineReason[])[] = [
      [],
      ['auto'],
      ['auto', 'product_hidden'],
    ];

    const results = storages.flatMap((storage) =>
      reasonSets.map((reasons) => desiredLocation(storage, reasons)),
    );

    expect(results).toEqual([
      'images',
      'quarantine',
      'quarantine',
      'files',
      'files',
      'files',
    ]);
  });
});

describe('MediaLocation', () => {
  test('画像用非公開・ファイル用非公開・隔離の3つのバケットを持つ', () => {
    const locations = {
      images: true,
      files: true,
      quarantine: true,
    } as const satisfies Record<MediaLocation, true>;

    expect(Object.keys(locations)).toHaveLength(3);
  });
});

describe('ModerationStatus', () => {
  test('判定不要・判定待ち・問題なし・不適切・未判定の5つの状態を持つ', () => {
    const statuses = {
      not_required: true,
      pending: true,
      passed: true,
      flagged: true,
      undetermined: true,
    } as const satisfies Record<ModerationStatus, true>;

    expect(Object.keys(statuses)).toHaveLength(5);
  });
});

describe('MediaOwner', () => {
  test('利用者と管理者は識別子を持つ', () => {
    const owner: MediaOwner = { kind: 'admin', id: 'admin-1' };

    expect(owner).toEqual({ kind: 'admin', id: 'admin-1' });
  });

  test('動作確認の経路の主体は識別子を持てない', () => {
    // @ts-expect-error systemの主体に識別子は無い
    const owner: MediaOwner = { kind: 'system', id: 'smoke' };

    expect(owner.kind).toBe('system');
  });

  test('利用者の主体は識別子を省けない', () => {
    // @ts-expect-error 利用者の主体には識別子が要る
    const owner: MediaOwner = { kind: 'user' };

    expect(owner.kind).toBe('user');
  });
});

describe('ModerationFinding', () => {
  test('ラベル・SVG・処理できない画像の3種の検出内容を持つ', () => {
    const sources = {
      labels: true,
      svg: true,
      unprocessable: true,
    } as const satisfies Record<ModerationFinding['source'], true>;

    expect(Object.keys(sources)).toHaveLength(3);
  });

  test('処理できない理由は復号できない・判定サービスの拒否の2種だけである', () => {
    const reasons = {
      undecodable: true,
      'rejected-by-service': true,
    } as const satisfies Record<
      Extract<ModerationFinding, { source: 'unprocessable' }>['reason'],
      true
    >;

    expect(Object.keys(reasons)).toHaveLength(2);
  });

  test('SVGの検出内容は属性の値を持てない', () => {
    const finding: ModerationFinding = {
      source: 'svg',
      violation: 'disallowed_attribute',
      target: 'onload',
      // @ts-expect-error 検出内容に属性の値を含めない
      value: 'alert(1)',
    };

    expect(finding.source).toBe('svg');
  });
});
