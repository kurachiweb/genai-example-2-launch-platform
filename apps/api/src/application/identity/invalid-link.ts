import { AppError } from '../../../lib/core/errors/app-error.ts';

const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

// メールのリンクによる確定の操作で、トークンが無効・期限切れ・使用済みのときや対象の利用者が使えないときに投げる
export const invalidLinkError = (): AppError =>
  new AppError({
    kind: 'unprocessable',
    code: 'invalid_link',
    message: INVALID_LINK_MESSAGE,
  });
