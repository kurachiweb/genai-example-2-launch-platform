import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

// 加入の拒否のコードと文言はapplication層のultras-errors.tsにあり、決済の開始が購入の可否の口の判定から投げる

export const callerForbiddenError = (): AppError => authError('forbidden');
