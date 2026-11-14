import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';

interface UltrasErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 加入の拒否(ultras_unavailable・ultras_already_subscribed・ultras_resume_in_portal)は購入の可否の口(共通ライブラリのworkers)が同じコードと文言で決め、決済の開始が投げる。
// application層はworkersを読み込めないため、画面の出し分けと対照する定義をここにも持つ。
// Customer Portalと機能フラグのコードは、この層のユースケースとインフラ層の書き込みだけが投げる
export const ULTRAS_ERRORS = Object.freeze({
  ultras_unavailable: {
    kind: 'unprocessable',
    message: '現在、Ultrasの新規の加入を受け付けていません。',
  },
  ultras_already_subscribed: {
    kind: 'unprocessable',
    message: '既にUltrasに加入しています。',
  },
  ultras_resume_in_portal: {
    kind: 'unprocessable',
    message:
      '解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。',
  },
  ultras_portal_unavailable: {
    kind: 'unprocessable',
    message: 'Ultrasに加入したことが無いため、管理画面を開けません。',
  },
  version_conflict: {
    kind: 'conflict',
    message:
      '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
  },
} satisfies Readonly<Record<string, UltrasErrorDefinition>>);

export type UltrasErrorCode = keyof typeof ULTRAS_ERRORS;

export const ultrasError = (code: UltrasErrorCode): AppError => {
  const { kind, message } = ULTRAS_ERRORS[code];
  return new AppError({ kind, code, message });
};
