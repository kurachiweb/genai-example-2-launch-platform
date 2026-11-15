import { getFrontendLogger } from '../../server/observability/logging.ts';
import { readFrontendRequestContext } from '../request-context.server.ts';
import {
  createFirstReportFilter,
  isReportableFailure,
  type ReportSource,
} from './error-queue.ts';

const isFirstReport = createFirstReportFilter();

// 描画の文脈のreportUnexpectedは、アプリが渡す@sentry/cloudflareのcaptureExceptionを、送信の例外で描画を止めないようサーバーのエントリが包んだものである
export function reportUnexpectedErrorOnServer(
  error: unknown,
  source: ReportSource,
): void {
  if (!isReportableFailure(error) || !isFirstReport(error)) {
    return;
  }
  const context = readFrontendRequestContext();
  getFrontendLogger([context.caller, 'http', 'error']).error(
    '想定外の失敗が発生しました',
    { source, error },
  );
  context.reportUnexpected(error);
}
