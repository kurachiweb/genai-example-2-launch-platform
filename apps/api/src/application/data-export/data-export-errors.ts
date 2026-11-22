import { AppError } from '../../../lib/core/errors/app-error.ts';

export const dataExportUnavailableError = (): AppError =>
  new AppError({
    kind: 'unavailable',
    code: 'data_export_unavailable',
    message: '要求を受け付けられませんでした。時間をおいて再度お試しください。',
  });
