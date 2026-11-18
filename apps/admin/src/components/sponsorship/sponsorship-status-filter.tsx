import { useId, useState } from 'react';

import { SPONSORSHIP_STATUS_LABELS } from '../../../common-lib/sponsorship/sponsorship-status.ts';
import { SPONSORSHIP_TIER_LABELS } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { AdminFilterBar } from '../../../lib/components/admin/admin-filter-bar.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import {
  toSponsorshipStatus,
  toSponsorshipTier,
} from '../../graphql/admin-sponsorships.ts';
import type {
  AdminSponsorshipStatusFilter,
  SponsorshipTier,
} from '../../graphql/generated/graphql.ts';
import {
  ADMIN_SPONSORSHIP_STATUS_FILTERS,
  ADMIN_SPONSORSHIP_TIERS,
  type AdminSponsorshipSearch,
  adminSponsorshipFilterScopeOf,
} from './admin-sponsorship-search.ts';
import {
  ALL_STATUSES_LABEL,
  ALL_TIERS_LABEL,
  STATUS_FILTER_LABEL,
  TIER_FILTER_LABEL,
} from './admin-sponsorships-messages.ts';

export interface SponsorshipStatusFilterProps {
  // URLの条件。適用・解除の結果でなく外から変わったら、選択欄をその値に戻す
  readonly search: AdminSponsorshipSearch;
  readonly onApply: (search: AdminSponsorshipSearch) => void;
  readonly onReset: () => void;
}

interface FilterDraft {
  readonly status: string;
  readonly tier: string;
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

// Radix UIの選択の部品は空の文字列を選択肢の値にできないため、条件を付けない選択肢には掲載状況・ティアの値になり得ない値を使う
const ALL_VALUE = '*';

const STATUS_OPTIONS: readonly FilterOption[] =
  ADMIN_SPONSORSHIP_STATUS_FILTERS.map((status) => ({
    value: status,
    label: SPONSORSHIP_STATUS_LABELS[toSponsorshipStatus(status)],
  }));

const TIER_OPTIONS: readonly FilterOption[] = ADMIN_SPONSORSHIP_TIERS.map(
  (tier) => ({
    value: tier,
    label: SPONSORSHIP_TIER_LABELS[toSponsorshipTier(tier)],
  }),
);

const isStatus = (value: string): value is AdminSponsorshipStatusFilter =>
  (ADMIN_SPONSORSHIP_STATUS_FILTERS as readonly string[]).includes(value);

const isTier = (value: string): value is SponsorshipTier =>
  (ADMIN_SPONSORSHIP_TIERS as readonly string[]).includes(value);

const draftOf = (search: AdminSponsorshipSearch): FilterDraft => ({
  status: search.status ?? ALL_VALUE,
  tier: search.tier ?? ALL_VALUE,
});

const searchOf = (draft: FilterDraft): AdminSponsorshipSearch => ({
  ...(isStatus(draft.status) && { status: draft.status }),
  ...(isTier(draft.tier) && { tier: draft.tier }),
});

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-44 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SponsorshipStatusFilter({
  search,
  onApply,
  onReset,
}: SponsorshipStatusFilterProps) {
  const id = useId();
  const scope = adminSponsorshipFilterScopeOf(search);
  const [edited, setEdited] = useState<{
    readonly scope: string;
    readonly pendingScope: string | undefined;
    readonly draft: FilterDraft;
  }>(() => ({ scope, pendingScope: undefined, draft: draftOf(search) }));
  // ブラウザの戻る操作などでURLの条件が外から変わったら選択欄を戻す。部品を作り直すと押した「適用」「解除」のボタンが消えてフォーカスを失うため、描画中に状態を差し替える。
  // 適用・解除した条件がURLへ届くのは読み込みの後のため、届くまでの間の選択を上書きしないよう、その条件が届いた時は選択欄を戻さない
  if (edited.scope !== scope) {
    setEdited(
      edited.pendingScope === scope
        ? { ...edited, scope, pendingScope: undefined }
        : { scope, pendingScope: undefined, draft: draftOf(search) },
    );
  }
  const { draft } = edited;
  const pendingScopeOf = (next: AdminSponsorshipSearch): string | undefined => {
    const nextScope = adminSponsorshipFilterScopeOf(next);
    return nextScope === scope ? undefined : nextScope;
  };
  const submit = (next: AdminSponsorshipSearch) => {
    setEdited((current) => ({
      ...current,
      pendingScope: pendingScopeOf(next),
      draft: draftOf(next),
    }));
  };
  const update = (changes: Partial<FilterDraft>) => {
    setEdited((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
    }));
  };

  return (
    <AdminFilterBar
      onApply={() => {
        const applied = searchOf(draft);
        submit(applied);
        onApply(applied);
      }}
      onReset={() => {
        submit({});
        onReset();
      }}
    >
      <FilterSelect
        id={`${id}-status`}
        label={STATUS_FILTER_LABEL}
        allLabel={ALL_STATUSES_LABEL}
        value={draft.status}
        options={STATUS_OPTIONS}
        onChange={(status) => {
          update({ status });
        }}
      />
      <FilterSelect
        id={`${id}-tier`}
        label={TIER_FILTER_LABEL}
        allLabel={ALL_TIERS_LABEL}
        value={draft.tier}
        options={TIER_OPTIONS}
        onChange={(tier) => {
          update({ tier });
        }}
      />
    </AdminFilterBar>
  );
}
