import { createFileRoute } from '@tanstack/react-router';

import { PLAN_PAGE_TITLE } from '../../../components/ultras/plan-messages.ts';
import { PlanPage } from '../../../components/ultras/plan-page.tsx';
import {
  PORTAL_RETURNED,
  toPlanSearch,
} from '../../../components/ultras/plan-search.ts';
import { loadPlanPage } from '../../../graphql/ultras.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/plan')({
  validateSearch: toPlanSearch,
  loader: loadPlanPage,
  head: () => buildSitePageHead({ title: PLAN_PAGE_TITLE, noIndex: true }),
  component: PlanSettingsRoute,
});

function PlanSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  const { portal } = Route.useSearch();
  return (
    <PlanPage viewer={viewer} portalReturned={portal === PORTAL_RETURNED} />
  );
}
