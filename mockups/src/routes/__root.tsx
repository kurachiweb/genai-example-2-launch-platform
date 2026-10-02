import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';

import { NotFound } from '#/components/client/not-found';
import { SiteFooter } from '#/components/client/site-footer';
import { SiteHeader } from '#/components/client/site-header';
import { TooltipProvider } from '#/components/ui/tooltip';
import { Toaster } from '#/components/ui/sonner';
import { PREFERENCE_BOOTSTRAP_SCRIPT } from '#/lib/preferences';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Launch Stadium 画面デザイン案',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
    scripts: [
      {
        children: PREFERENCE_BOOTSTRAP_SCRIPT,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="bottom-center" />
        <TanStackDevtools
          config={{
            position: 'bottom-left',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* 状態パネルを持たないため、各画面の既定と同じ未ログイン状態で表示する */}
      <SiteHeader user={null} logoAs="div" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 sm:pt-8">
        <NotFound />
      </main>
      <SiteFooter />
    </div>
  );
}
