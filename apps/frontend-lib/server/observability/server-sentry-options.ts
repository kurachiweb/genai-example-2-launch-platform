import type { DataCollection } from '@sentry/core';

import {
  scrubSentryEvent,
  scrubSentrySpan,
  SENTRY_DATA_COLLECTION,
} from '../../utilities/observability/sentry-scrub.ts';
import { validateFrontendEnv } from '../env/frontend-env.ts';

// @sentry/cloudflare 11.4.0にsendDefaultPiiは無いため、個人情報を既定で集めないことはdataCollectionで指定する
export interface ServerSentryOptions {
  readonly dsn: string | undefined;
  readonly enabled: boolean;
  readonly environment: string;
  readonly tracesSampleRate: number;
  readonly dataCollection: DataCollection;
  readonly beforeSend: typeof scrubSentryEvent;
  readonly beforeSendSpan: typeof scrubSentrySpan;
}

const UNKNOWN_ENVIRONMENT = 'unknown';

export const buildServerSentryOptions = (env: unknown): ServerSentryOptions => {
  const scrubbing = {
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpan,
  };
  const validation = validateFrontendEnv(env);
  if (!validation.ok) {
    return {
      dsn: undefined,
      enabled: false,
      environment: UNKNOWN_ENVIRONMENT,
      tracesSampleRate: 0,
      ...scrubbing,
    };
  }
  const { SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE } =
    validation.env;
  return {
    dsn: SENTRY_DSN,
    enabled: SENTRY_DSN !== undefined,
    environment: SENTRY_ENVIRONMENT,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    ...scrubbing,
  };
};
