import { describe, expect, test } from 'bun:test';

import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import { EVENT_SEARCH_TYPES } from '../search/search-types.ts';
import {
  EVENT_MEDIA_TYPES,
  type ImageCachePurger,
  type ImageSource,
  type ImageTransformer,
  type ModerationImagePlan,
  type ModerationImageRenderer,
  type ModerationOutcome,
} from './ports.ts';

const EXPECTED_NAMES = [
  'ModerationProvider',
  'ModerationImageRenderer',
  'MediaIncidentReporter',
  'FileRelocator',
  'ImageCachePurger',
] as const;

describe('EVENT_MEDIA_TYPES', () => {
  test('イベントサーバーだけが束縛する5種のポートの識別子だけを持つ', () => {
    expect(Object.keys(EVENT_MEDIA_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmedia.<名前>である',
    (name) => {
      expect<symbol>(EVENT_MEDIA_TYPES[name]).toBe(Symbol.for(`media.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(EVENT_MEDIA_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('両アプリ共通のメディアの識別子と全文検索の識別子に重ならない', () => {
    const others = new Set<symbol>([
      ...Object.values(MEDIA_TYPES),
      ...Object.values(EVENT_SEARCH_TYPES),
    ]);

    expect(
      Object.values(EVENT_MEDIA_TYPES).filter((identifier) =>
        others.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_MEDIA_TYPES)).toBe(true);
  });
});

describe('ModerationImagePlan', () => {
  test('余白を足す計画はPNGだけを作るため形式を持たない', () => {
    const plan: ModerationImagePlan = {
      kind: 'pad',
      width: 640,
      height: 40,
      canvasWidth: 640,
      canvasHeight: 80,
      // @ts-expect-error 余白を足す計画に形式は無い
      format: 'png',
    };

    expect(plan.kind).toBe('pad');
  });

  test('判定用画像の形式はPNGとJPEGだけである', () => {
    const plan: ModerationImagePlan = {
      kind: 'as-is',
      // @ts-expect-error 判定用画像にWebPは使えない
      format: 'webp',
    };

    expect(plan.kind).toBe('as-is');
  });
});

describe('ModerationOutcome', () => {
  test('一時的な失敗の理由は5種である', () => {
    const reasons = {
      throttled: true,
      'service-error': true,
      timeout: true,
      network: true,
      misconfigured: true,
    } as const satisfies Record<
      Extract<ModerationOutcome, { kind: 'transient' }>['reason'],
      true
    >;

    expect(Object.keys(reasons)).toHaveLength(5);
  });

  test('判定サービスが受け付けない理由は3種である', () => {
    const reasons = {
      'invalid-image': true,
      'too-large': true,
      'invalid-parameter': true,
    } as const satisfies Record<
      Extract<ModerationOutcome, { kind: 'rejected' }>['reason'],
      true
    >;

    expect(Object.keys(reasons)).toHaveLength(3);
  });
});

describe('ModerationImageRenderer', () => {
  test('描画の失敗は復号できない理由だけを返す', async () => {
    const renderer: ModerationImageRenderer = {
      render: () => Promise.resolve({ ok: false, reason: 'undecodable' }),
    };

    expect(
      await renderer.render({
        original: new Uint8Array(),
        plan: { kind: 'as-is', format: 'png' },
      }),
    ).toEqual({ ok: false, reason: 'undecodable' });
  });
});

describe('ImageCachePurger', () => {
  test('パージの失敗はエラーコードの一覧を返す', async () => {
    const purger: ImageCachePurger = {
      purge: () => Promise.resolve({ ok: false, errorCodes: [1101] }),
    };

    expect(await purger.purge(['0123456789abcdef'.repeat(2)])).toEqual({
      ok: false,
      errorCodes: [1101],
    });
  });
});

describe('ImageSource・ImageTransformer', () => {
  test('原本が無い読み出しはundefinedを返し、変換の失敗は2種の理由を返す', async () => {
    const source: ImageSource = { get: () => Promise.resolve(undefined) };
    const transformer: ImageTransformer = {
      transform: () => Promise.resolve({ ok: false, reason: 'unavailable' }),
    };
    const reasons = {
      'invalid-image': true,
      unavailable: true,
    } as const satisfies Record<
      Extract<
        Awaited<ReturnType<ImageTransformer['transform']>>,
        { ok: false }
      >['reason'],
      true
    >;

    expect(await source.get('0123456789abcdef'.repeat(2))).toBeUndefined();
    expect(
      await transformer.transform({
        body: new ReadableStream<Uint8Array>(),
        variant: {
          name: 'square-sm',
          width: 64,
          height: 64,
          fit: 'cover',
          avif: true,
        },
        format: 'image/webp',
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(Object.keys(reasons)).toHaveLength(2);
  });
});
