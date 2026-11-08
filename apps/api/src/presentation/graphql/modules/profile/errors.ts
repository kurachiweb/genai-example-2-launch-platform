import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

// 入力の違反の文言は画面と共有するcommon-libのprofile-input-rules.tsに、ユースケースが投げるエラーの文言はapplication層のprofile-errors.tsにある

export const callerForbiddenError = (): AppError => authError('forbidden');
