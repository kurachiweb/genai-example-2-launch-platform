import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router';
import type { SearchSchemaInput } from '@tanstack/react-router';

import { LoginDialog } from '#/components/client/login-dialog';
import { NotFound } from '#/components/client/not-found';
import { PageError } from '#/components/client/page-error';
import { SiteFooter } from '#/components/client/site-footer';
import { SiteHeader } from '#/components/client/site-header';
import { StatePanel } from '#/components/client/state-panel';
import { VerifyEmailBanner } from '#/components/client/verify-email-banner';
import { CURRENT_USER } from '#/lib/mock-data';

import { ProfileContent } from './-components/profile-content';
import { ProfileSkeleton } from './-components/profile-skeleton';
import { describeChanges, normalize } from './-model/normalize';
import {
  DEFAULT_SEARCH,
  OPTIONS,
  OPTION_LABELS,
  PANEL_SECTIONS,
  parseSearch,
  stateOf,
} from './-model/options';
import type { OptionKey, ProfileSearch, ProfileTab } from './-model/options';
import { buildModel } from './-model/page-model';

export const Route = createFileRoute('/client/@{$handle}/')({
  // URLを直接開いた場合も、不正な値は既定値に戻し、矛盾する組み合わせは整合する状態へ直して表示する
  validateSearch: (
    raw: Partial<ProfileSearch> & SearchSchemaInput,
  ): ProfileSearch => {
    const search = parseSearch(raw);
    return { ...normalize(stateOf(search)).state, tab: search.tab };
  },
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  head: () => ({
    meta: [
      { title: 'ユーザー公開プロフィール | Launch Stadium 画面デザイン案' },
    ],
  }),
  component: ProfilePage,
});

const HIGHLIGHT_MS = 2500;
const RETRY_LATENCY_MS = 900;

function ProfilePage() {
  const search = Route.useSearch();
  const { handle } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const state = stateOf(search);
  const model = useMemo(
    () => buildModel(stateOf(search), handle),
    [search, handle],
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<OptionKey[]>([]);
  const [retrying, setRetrying] = useState(false);
  // 404でも共通ヘッダーのログイン状態は反映する
  const viewer =
    model?.viewer ?? (state.auth === 'guest' ? null : CURRENT_USER);

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
    const resolved = normalize({ ...state, [key]: value }, key);
    setNotice(
      resolved.changed.length > 0
        ? describeChanges(
            resolved.state,
            resolved.changed,
            key,
            resolved.reasons,
          )
        : null,
    );
    setHighlighted(resolved.changed);
    navigate({
      search: (prev: ProfileSearch) => ({ ...prev, ...resolved.state }),
      replace: true,
      resetScroll: false,
    });
  };

  const changeTab = (tab: ProfileTab) =>
    navigate({
      search: (prev: ProfileSearch) => ({ ...prev, tab }),
      resetScroll: false,
    });

  const requireLogin = useCallback(() => setLoginOpen(true), []);

  const body = (() => {
    if (state.load === 'loading' || retrying) return <ProfileSkeleton />;
    if (state.load === 'error') {
      return (
        <PageError
          title="プロフィールを読み込めませんでした。"
          onRetry={() => setRetrying(true)}
        />
      );
    }
    if (!model) return <NotFound />;
    return (
      <ProfileContent
        // 状態を切り替えたらフォローや一覧の読み込み済み件数などのページ内の状態を初期化する
        key={`${handle}-${JSON.stringify(state)}`}
        model={model}
        state={state}
        tab={search.tab}
        onTabChange={changeTab}
        onRequireLogin={requireLogin}
      />
    );
  })();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={viewer} logoAs="div" />
      {state.auth === 'unverified' && <VerifyEmailBanner />}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 sm:pt-8">
        {body}
      </main>
      <SiteFooter />

      <LoginDialog
        open={loginOpen}
        purpose="follow"
        onOpenChange={setLoginOpen}
      />
      <StatePanel
        sections={PANEL_SECTIONS}
        options={OPTIONS}
        labels={OPTION_LABELS}
        values={state}
        onChange={changeState}
        notice={notice}
        highlighted={highlighted}
      />
    </div>
  );
}
