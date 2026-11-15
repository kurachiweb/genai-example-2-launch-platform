import { describe, expect, test } from 'bun:test';

import {
  checkDraftDiscardable,
  checkDraftWritable,
  checkPublishable,
  type LegalDocumentState,
  type LegalDraftSnapshot,
  type LegalVersionSnapshot,
  nextPublishedAt,
  nextVersionNumber,
} from './legal-document.ts';

const LATEST: LegalVersionSnapshot = {
  versionNumber: 3,
  body: '# 利用規約\n\n第1条',
  publishedAt: new Date('2026-11-01T00:00:00.000Z'),
};

const draftOf = (body: string): LegalDraftSnapshot => ({
  body,
  savedAt: new Date('2026-11-02T00:00:00.000Z'),
  savedByAdminId: '01M6HXNZ0000000000000000A1',
});

const stateOf = (
  overrides: Partial<LegalDocumentState> = {},
): LegalDocumentState => ({
  kind: 'terms',
  stateVersion: 5,
  latest: LATEST,
  draft: draftOf('# 利用規約\n\n第1条\n\n第2条'),
  ...overrides,
});

describe('checkDraftWritable', () => {
  test('状態の版が一致すれば、下書きの有無と公開の有無に関わらず保存できる', () => {
    expect(checkDraftWritable(stateOf(), 5)).toBeUndefined();
    expect(checkDraftWritable(stateOf({ draft: null }), 5)).toBeUndefined();
    expect(
      checkDraftWritable(stateOf({ latest: null, draft: null }), 5),
    ).toBeUndefined();
  });

  test('状態の版が古くても新しくても一致しなければstaleで拒否する', () => {
    expect(checkDraftWritable(stateOf(), 4)).toBe('stale');
    expect(checkDraftWritable(stateOf(), 6)).toBe('stale');
  });
});

describe('checkDraftDiscardable', () => {
  test('状態の版が一致し下書きがあれば破棄できる', () => {
    expect(checkDraftDiscardable(stateOf(), 5)).toBeUndefined();
  });

  test('下書きが無ければno_draftで拒否する', () => {
    expect(checkDraftDiscardable(stateOf({ draft: null }), 5)).toBe('no_draft');
  });

  test('状態の版の不一致を下書きなしより先に判定する', () => {
    expect(checkDraftDiscardable(stateOf(), 4)).toBe('stale');
    expect(checkDraftDiscardable(stateOf({ draft: null }), 4)).toBe('stale');
  });
});

describe('checkPublishable', () => {
  test('状態の版が一致し、最新版と本文が異なる下書きがあれば公開できる', () => {
    expect(checkPublishable(stateOf(), 5)).toBeUndefined();
  });

  test('未公開なら下書きがあれば公開できる', () => {
    expect(checkPublishable(stateOf({ latest: null }), 5)).toBeUndefined();
  });

  test('下書きの本文が最新版の本文と完全に一致すればunchangedで拒否する', () => {
    expect(checkPublishable(stateOf({ draft: draftOf(LATEST.body) }), 5)).toBe(
      'unchanged',
    );
  });

  test('前後の空白や改行だけが異なる本文は変更ありとみなす', () => {
    expect(
      checkPublishable(stateOf({ draft: draftOf(`${LATEST.body}\n`) }), 5),
    ).toBeUndefined();
    expect(
      checkPublishable(stateOf({ draft: draftOf(` ${LATEST.body}`) }), 5),
    ).toBeUndefined();
  });

  test('正規化で同じになる別の符号列の本文は変更ありとみなす', () => {
    const composed = '\u304C';
    const decomposed = '\u304B\u3099';

    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC'));
    expect(
      checkPublishable(
        stateOf({
          latest: { ...LATEST, body: composed },
          draft: draftOf(decomposed),
        }),
        5,
      ),
    ).toBeUndefined();
  });

  test('下書きが無ければno_draftで拒否する', () => {
    expect(checkPublishable(stateOf({ draft: null }), 5)).toBe('no_draft');
    expect(checkPublishable(stateOf({ latest: null, draft: null }), 5)).toBe(
      'no_draft',
    );
  });

  test('不一致→下書きなし→本文の一致の順で判定する', () => {
    expect(checkPublishable(stateOf({ draft: null }), 4)).toBe('stale');
    expect(checkPublishable(stateOf({ draft: draftOf(LATEST.body) }), 4)).toBe(
      'stale',
    );
    expect(checkPublishable(stateOf(), 6)).toBe('stale');
  });
});

describe('nextVersionNumber', () => {
  test('未公開なら1を返す', () => {
    expect(nextVersionNumber(stateOf({ latest: null }))).toBe(1);
  });

  test('公開済みなら最新版の版番号に1を足す', () => {
    expect(nextVersionNumber(stateOf())).toBe(4);
  });
});

describe('nextPublishedAt', () => {
  const NOW = new Date('2026-11-04T09:00:00.000Z');

  test('未公開なら現在時刻を返す', () => {
    expect(nextPublishedAt(NOW, null)).toEqual(NOW);
  });

  test('最新版の公開日時より後なら現在時刻を返す', () => {
    expect(nextPublishedAt(NOW, new Date('2026-11-04T08:59:59.999Z'))).toEqual(
      NOW,
    );
  });

  test('最新版の公開日時と同じミリ秒なら1ミリ秒後を返す', () => {
    expect(nextPublishedAt(NOW, NOW)).toEqual(
      new Date('2026-11-04T09:00:00.001Z'),
    );
  });

  test('時計が戻り最新版の公開日時より前なら、最新版の公開日時の1ミリ秒後を返す', () => {
    expect(nextPublishedAt(NOW, new Date('2026-11-04T10:00:00.000Z'))).toEqual(
      new Date('2026-11-04T10:00:00.001Z'),
    );
  });

  test('引数の日時を書き換えず、別のインスタンスを返す', () => {
    const now = new Date(NOW);
    const latest = new Date('2026-11-04T10:00:00.000Z');

    const fromNow = nextPublishedAt(now, null);
    const fromLatest = nextPublishedAt(now, latest);

    expect(fromNow).not.toBe(now);
    expect(fromLatest).not.toBe(latest);
    expect(now).toEqual(NOW);
    expect(latest).toEqual(new Date('2026-11-04T10:00:00.000Z'));
  });
});
