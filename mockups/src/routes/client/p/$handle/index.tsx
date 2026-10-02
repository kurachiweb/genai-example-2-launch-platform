import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router';
import type { SearchSchemaInput } from '@tanstack/react-router';

import { LoginDialog } from '#/components/client/login-dialog';
import type { LoginPurpose } from '#/components/client/login-dialog';
import { NotFound } from '#/components/client/not-found';
import { PageError } from '#/components/client/page-error';
import { SiteFooter } from '#/components/client/site-footer';
import { SiteHeader } from '#/components/client/site-header';
import { StadiumDefs } from '#/components/client/stadium-pitch/stadium-pitch';
import { StatePanel } from '#/components/client/state-panel';
import { VerifyEmailBanner } from '#/components/client/verify-email-banner';
import { CURRENT_USER } from '#/lib/mock-data';

import { PageSkeleton } from './-components/page-skeleton';
import { ProductContent } from './-components/product-content';
import { describeChanges, normalize } from './-model/normalize';
import {
  DEFAULT_SEARCH,
  OPTIONS,
  OPTION_LABELS,
  PANEL_SECTIONS,
  parseSearch,
} from './-model/options';
import type { OptionKey, ProductSearch } from './-model/options';
import { buildModel } from './-model/page-model';

export const Route = createFileRoute('/client/p/$handle/')({
  // URLを直接開いた場合も、矛盾する組み合わせは整合する状態へ直して表示する
  validateSearch: (raw: Partial<ProductSearch> & SearchSchemaInput) =>
    normalize(parseSearch(raw)).state,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  head: () => ({
    meta: [{ title: 'プロダクト詳細 | Launch Stadium 画面デザイン案' }],
  }),
  component: ProductPage,
});

const HIGHLIGHT_MS = 2500;
const RETRY_LATENCY_MS = 900;

function ProductPage() {
  const search = Route.useSearch();
  const { handle } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const model = useMemo(() => buildModel(search, handle), [search, handle]);
  // 閉じるアニメーション中も文言が変わらないよう、開閉と用途を分けて持つ
  const [login, setLogin] = useState<{ open: boolean; purpose: LoginPurpose }>({
    open: false,
    purpose: 'upvote',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<OptionKey[]>([]);
  const [retrying, setRetrying] = useState(false);
  const viewer = search.auth === 'guest' ? null : CURRENT_USER;

  useEffect(() => {
    if (highlighted.length === 0) return;
    const timer = window.setTimeout(() => setHighlighted([]), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => setRetrying(false), RETRY_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [retrying]);

  const changeState = (key: OptionKey, value: string) => {
    const next: ProductSearch = { ...search, [key]: value };
    const resolved = normalize(next, key);
    setNotice(
      resolved.changed.length > 0
        ? describeChanges(resolved.state, resolved.changed, key)
        : null,
    );
    setHighlighted(resolved.changed);
    navigate({ search: resolved.state, replace: true, resetScroll: false });
  };

  const requireLogin = useCallback(
    (purpose: LoginPurpose) => setLogin({ open: true, purpose }),
    [],
  );

  const body = (() => {
    if (search.page === 'loading' || retrying) return <PageSkeleton />;
    if (search.page === 'error') {
      return (
        <PageError
          title="プロダクト情報を読み込めませんでした。"
          onRetry={() => setRetrying(true)}
        />
      );
    }
    if (!model) return <NotFound />;
    return (
      <ProductContent
        key={JSON.stringify(search)}
        model={model}
        search={search}
        onRequireLogin={requireLogin}
      />
    );
  })();

  return (
    <div className="flex min-h-screen flex-col">
      <StadiumDefs />
      <SiteHeader user={viewer} logoAs="div" />
      {search.auth === 'unverified' && <VerifyEmailBanner />}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5">{body}</main>
      <SiteFooter />

      <LoginDialog
        open={login.open}
        purpose={login.purpose}
        onOpenChange={(open) => setLogin((current) => ({ ...current, open }))}
      />
      <StatePanel
        sections={PANEL_SECTIONS}
        options={OPTIONS}
        labels={OPTION_LABELS}
        values={search}
        onChange={changeState}
        notice={notice}
        highlighted={highlighted}
      />
    </div>
  );
}
