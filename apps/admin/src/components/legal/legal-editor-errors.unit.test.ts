import { describe, expect, test } from 'bun:test';

import {
  type FieldErrorDetail,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import {
  legalEditorErrorMessageOf,
  toLegalEditorErrorState,
} from './legal-editor-errors.ts';

const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

const BODY_DETAIL: FieldErrorDetail = Object.freeze({
  field: 'input.body',
  message: '本文を入力してください。',
  code: 'too_small',
});

const SUMMARY_DETAIL: FieldErrorDetail = Object.freeze({
  field: 'input.changeSummary',
  message: '変更概要は200文字以内で入力してください。',
  code: 'too_big',
});

const clientError = (
  code: string,
  options: {
    readonly status?: number;
    readonly message?: string;
    readonly details?: readonly FieldErrorDetail[];
  } = {},
) =>
  new GraphQLClientError({
    code,
    message: options.message ?? 'サーバーの文言',
    status: options.status ?? 400,
    details: options.details,
  });

describe('toLegalEditorErrorState', () => {
  test.each([
    ['legal_document_conflict', 409, 'conflict'],
    ['legal_document_unchanged', 422, 'unchanged'],
    ['legal_document_draft_missing', 422, 'no-draft'],
    ['payload_too_large', 413, 'too-large'],
  ] as const)('%sのコードは%sの状態にする', (code, status, kind) => {
    expect(
      toLegalEditorErrorState(clientError(code, { status })),
    ).toStrictEqual({ kind });
  });

  test('検証の違反は詳細とともに欄の状態にする', () => {
    const error = clientError('validation_error', {
      details: [BODY_DETAIL, SUMMARY_DETAIL],
    });

    expect(toLegalEditorErrorState(error)).toStrictEqual({
      kind: 'field',
      details: [BODY_DETAIL, SUMMARY_DETAIL],
    });
  });

  test('フォームが渡した欄に対応しない詳細があれば、欄の状態はその詳細だけを持つ', () => {
    const error = clientError('validation_error', {
      details: [BODY_DETAIL, SUMMARY_DETAIL],
    });

    expect(
      toLegalEditorErrorState(error, { unmatched: [SUMMARY_DETAIL] }),
    ).toStrictEqual({ kind: 'field', details: [SUMMARY_DETAIL] });
  });

  test('詳細の無い検証の違反は、サーバーの文言で想定外の状態にする', () => {
    const error = clientError('validation_error', {
      message: '入力内容を確認してください。',
    });

    expect(toLegalEditorErrorState(error, { unmatched: [] })).toStrictEqual({
      kind: 'unexpected',
      message: '入力内容を確認してください。',
    });
  });

  test.each([
    ['forbidden', 403, 'この操作はできません。'],
    [
      'internal_error',
      500,
      'エラーが発生しました。時間をおいて再度お試しください。',
    ],
    [
      'network_error',
      0,
      '通信に失敗しました。時間をおいて再度お試しください。',
    ],
  ] as const)(
    'その他のコード(%s)はサーバーの文言で想定外の状態にする',
    (code, status, message) => {
      expect(
        toLegalEditorErrorState(clientError(code, { status, message })),
      ).toStrictEqual({ kind: 'unexpected', message });
    },
  );

  test.each([
    ['Error', new Error('fetch failed: secret detail')],
    ['文字列', 'unknown failure'],
    ['undefined', undefined],
  ] as const)(
    'GraphQLClientErrorでない例外(%s)は問い合わせを促さない共通の文言で想定外の状態にする',
    (_, error) => {
      expect(toLegalEditorErrorState(error)).toStrictEqual({
        kind: 'unexpected',
        message: UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
      });
    },
  );
});

describe('legalEditorErrorMessageOf', () => {
  test.each([
    [{ kind: 'conflict' }, CONFLICT_MESSAGE],
    [{ kind: 'unchanged' }, '公開中の版から本文が変更されていません。'],
    [{ kind: 'no-draft' }, '公開する下書きがありません。'],
    [{ kind: 'too-large' }, '本文が大きすぎるため保存できません。'],
    [
      { kind: 'unexpected', message: 'この操作はできません。' },
      'この操作はできません。',
    ],
  ] as const)('%oの状態の文言は「%s」', (state, message) => {
    expect(legalEditorErrorMessageOf(state)).toBe(message);
  });

  test('欄の状態は、詳細の文言を重複を除いて順に並べる', () => {
    expect(
      legalEditorErrorMessageOf({
        kind: 'field',
        details: [SUMMARY_DETAIL, BODY_DETAIL, SUMMARY_DETAIL],
      }),
    ).toBe(`${SUMMARY_DETAIL.message}${BODY_DETAIL.message}`);
  });
});
