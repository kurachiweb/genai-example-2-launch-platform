import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { toErrorResponse } from '../../../lib/core/errors/error-envelope.ts';
import { ULTRAS_ERRORS, ultrasError } from './ultras-errors.ts';

describe('ULTRAS_ERRORS', () => {
  test.each([
    [
      'ultras_unavailable',
      'unprocessable',
      422,
      '現在、Ultrasの新規の加入を受け付けていません。',
    ],
    [
      'ultras_already_subscribed',
      'unprocessable',
      422,
      '既にUltrasに加入しています。',
    ],
    [
      'ultras_resume_in_portal',
      'unprocessable',
      422,
      '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
    ],
  ] as const)(
    '%sは%sの種類(%d)と文言規則の文言を持つ',
    (code, kind, status, message) => {
      const error = ultrasError(code);

      expect(error).toBeInstanceOf(AppError);
      expect({
        kind: error.kind,
        code: error.code,
        message: error.message,
      }).toEqual({ kind, code, message });
      expect(toErrorResponse(error).status).toBe(status);
    },
  );

  test('定義は加入の拒否の3つのコードだけで、実行時に書き換えられない', () => {
    expect(Object.keys(ULTRAS_ERRORS).toSorted()).toEqual([
      'ultras_already_subscribed',
      'ultras_resume_in_portal',
      'ultras_unavailable',
    ]);
    expect(Object.isFrozen(ULTRAS_ERRORS)).toBe(true);
  });
});
