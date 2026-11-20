import { useRouter } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { appRuntimeOf } from '../../../lib/start/router-context.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { API_DOCS_MESSAGES } from './api-docs-messages.ts';
import {
  fetchOpenApiDocument,
  withAbsoluteServers,
} from './openapi-document.ts';
import {
  loadSwaggerUi as defaultLoadSwaggerUi,
  type SwaggerUiLoader,
} from './swagger-ui-loader.ts';

export interface SwaggerUiViewerProps {
  readonly loadSwaggerUi?: SwaggerUiLoader;
}

type ViewerStatus = 'loading' | 'error' | 'ready';

// 仕様書の取得・Swagger UIの束の読み込み・描画先の要素への描画は、表示中の要素に結び付いた1回の流れで、結果だけを取り出して使い回せないため、取得のキャッシュを使わず表示している間だけ行う
export function SwaggerUiViewer({
  loadSwaggerUi = defaultLoadSwaggerUi,
}: SwaggerUiViewerProps) {
  const router = useRouter();
  const { publicApiOrigin } = appRuntimeOf(router.options.context).publicConfig;
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const domNodeRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const domNode = domNodeRef.current;
    if (publicApiOrigin === undefined || domNode === null) {
      return;
    }
    const controller = new AbortController();
    Promise.all([
      fetchOpenApiDocument(publicApiOrigin, controller.signal),
      loadSwaggerUi(),
    ])
      .then(([document, render]) => {
        if (controller.signal.aborted) {
          return;
        }
        domNode.replaceChildren();
        render({
          domNode,
          spec: withAbsoluteServers(document, publicApiOrigin),
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, [attempt, publicApiOrigin, loadSwaggerUi]);

  const retry = () => {
    headingRef.current?.focus();
    setStatus('loading');
    setAttempt((current) => current + 1);
  };

  // 公開APIのオリジンを置いていない環境では仕様書を取得できないため、取得の失敗と同じ表示にする
  const shownStatus: ViewerStatus =
    publicApiOrigin === undefined ? 'error' : status;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行で消える再試行のボタンから、フォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-xl font-bold tracking-tight"
      >
        {API_DOCS_MESSAGES.referenceHeading}
      </h2>
      {shownStatus === 'loading' ? (
        <LoadingSkeleton label={API_DOCS_MESSAGES.referenceLoadingLabel} />
      ) : null}
      {shownStatus === 'error' ? (
        <ErrorState
          message={API_DOCS_MESSAGES.loadError}
          onRetry={retry}
          contactHref={
            CLIENT_PROFILE.contactAvailable ? CONTACT_HREF : undefined
          }
        />
      ) : null}
      {/* 描画先はSwagger UIが中身を作るため、読み込み中と失敗の間も要素を残して隠す。Swagger UIは暗い配色を持たないため、ページの配色に関わらず明るい配色にする */}
      <div
        ref={domNodeRef}
        hidden={shownStatus !== 'ready'}
        className="rounded-lg border bg-white text-neutral-900 scheme-light"
      />
    </section>
  );
}
