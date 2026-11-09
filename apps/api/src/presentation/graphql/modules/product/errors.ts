import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

export const callerForbiddenError = (): AppError => authError('forbidden');
