import { type ReactNode, useId, useRef } from 'react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import {
  API_DOCS_MESSAGES,
  API_DOCS_PAGE_TITLE,
  API_KEY_SETTINGS_HREF,
} from './api-docs-messages.ts';
import type { SwaggerUiLoader } from './swagger-ui-loader.ts';
import { SwaggerUiViewer } from './swagger-ui-viewer.tsx';

export interface ApiDocsPageProps {
  readonly loadSwaggerUi?: SwaggerUiLoader;
}

const CODE_CLASS_NAME =
  'rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] whitespace-nowrap';

function GuideSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xl font-bold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ApiDocsPage({ loadSwaggerUi }: ApiDocsPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <div className="flex flex-col gap-4">
        {/* 再試行で消える再試行のボタンから、フォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-3xl font-extrabold tracking-tight sm:text-4xl"
        >
          {API_DOCS_PAGE_TITLE}
        </h1>
        <p className="text-muted-foreground">{API_DOCS_MESSAGES.intro}</p>
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        <GuideSection title={API_DOCS_MESSAGES.apiKeyHeading}>
          <p className="text-sm">{API_DOCS_MESSAGES.apiKeyDescription}</p>
          <p className="text-sm">
            <PathLink
              href={API_KEY_SETTINGS_HREF}
              className={INLINE_LINK_CLASS_NAME}
            >
              {API_DOCS_MESSAGES.apiKeySettingsLink}
            </PathLink>
          </p>
        </GuideSection>
        <GuideSection title={API_DOCS_MESSAGES.authHeading}>
          <p className="text-sm">
            {API_DOCS_MESSAGES.authBeforeHeaderName}
            <code className={CODE_CLASS_NAME}>
              {API_DOCS_MESSAGES.authHeaderName}
            </code>
            {API_DOCS_MESSAGES.authBeforeScheme}
            <code className={CODE_CLASS_NAME}>
              {API_DOCS_MESSAGES.authScheme}
            </code>
            {API_DOCS_MESSAGES.authAfterScheme}
          </p>
        </GuideSection>
        <GuideSection title={API_DOCS_MESSAGES.rateLimitHeading}>
          <p className="text-sm">{API_DOCS_MESSAGES.rateLimitDescription}</p>
        </GuideSection>
      </div>
      <SwaggerUiViewer
        retryFocusRef={headingRef}
        {...(loadSwaggerUi === undefined ? {} : { loadSwaggerUi })}
      />
    </div>
  );
}
