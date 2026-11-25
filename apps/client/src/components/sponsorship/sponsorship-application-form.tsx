import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { RadioGroup } from '../../../lib/components/ui/radio-group/radio-group.tsx';
import { RadioGroupItem } from '../../../lib/components/ui/radio-group/radio-group-item.tsx';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import type { BusinessDateString } from '../../../common-lib/sponsorship/sponsorship-period.ts';
import { SPONSORSHIP_PURCHASE_CONDITIONS } from '../../../common-lib/sponsorship/sponsorship-purchase-conditions.ts';
import {
  SPONSORSHIP_TIER_LABELS,
  SPONSORSHIP_TIERS,
  type SponsorshipTier,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { countBusinessDaysInclusive } from '../../../common-lib/time/business-date-arithmetic.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientSponsorshipOfferQuery } from '../../graphql/generated/graphql.ts';
import {
  applySponsorshipMutationOptions,
  invalidateSponsorshipPeriodWindowQueries,
  sponsorshipPeriodWindowQueryOptions,
  toGraphQLSponsorshipTier,
  toSponsorshipTier,
} from '../../graphql/sponsorship.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { PRICING_HREF } from '../layout/site-links.ts';
import { SPONSORSHIP_APPLY_BOT_ACTION } from './bot-actions.ts';
import { selectedSponsorshipDateReasons } from './sponsorship-date-reasons.ts';
import {
  MY_PRODUCTS_LINK_HREF,
  MY_PRODUCTS_LINK_LABEL,
  SPONSORSHIP_ACCOUNT_SUSPENDED_REASON,
  SPONSORSHIP_APPLY_LINK_LABEL,
  SPONSORSHIP_APPLY_SUBMIT_LABEL,
  SPONSORSHIP_EMAIL_UNVERIFIED_REASON,
  SPONSORSHIP_FORM_LABELS,
  SPONSORSHIP_LOGIN_TO_APPLY_LABEL,
  SPONSORSHIP_NO_ELIGIBLE_PRODUCTS_MESSAGE,
  SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE,
  sponsorshipDaysLabel,
  sponsorshipErrorMessageOf,
} from './sponsorship-messages.ts';
import { SponsorshipPeriodField } from './sponsorship-period-field.tsx';
import {
  type SponsorableProduct,
  SponsorshipProductSelect,
} from './sponsorship-product-select.tsx';

type SponsorshipOffer = ClientSponsorshipOfferQuery['sponsorshipOffer'];

export interface SponsorshipApplicationFormProps {
  readonly offer: SponsorshipOffer;
}

interface ApplicationFormValues {
  productId: string | null;
  tier: SponsorshipTier | null;
  startsOn: BusinessDateString | null;
  endsOn: BusinessDateString | null;
}

// 未選択の欄は申込のボタンの無効で止めるため、検証は値の形だけを確かめる
const APPLICATION_FORM_SCHEMA = z.object({
  productId: z.string().nullable(),
  tier: z.enum(SPONSORSHIP_TIERS).nullable(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
});

const EMPTY_VALUES: ApplicationFormValues = Object.freeze({
  productId: null,
  tier: null,
  startsOn: null,
  endsOn: null,
});

// 対象外のプロダクトと掲載期間の重なりは選び直す欄に関わるため、フォームの上部に示す
const FORM_LEVEL_ERROR_CODES: ReadonlySet<string> = new Set([
  'sponsorship_product_ineligible',
  'sponsorship_overlap',
]);

interface SubmitFailure {
  readonly message: string;
  readonly atTop: boolean;
}

const isErrorCode = (error: unknown, code: string): boolean =>
  error instanceof GraphQLClientError && error.code === code;

const failureOf = (error: unknown): SubmitFailure => {
  const code = error instanceof GraphQLClientError ? error.code : undefined;
  return {
    message:
      sponsorshipErrorMessageOf(code) ??
      errorMessageOf(error, CLIENT_PROFILE.contactAvailable),
    atTop: code !== undefined && FORM_LEVEL_ERROR_CODES.has(code),
  };
};

const describedByOf = (
  ids: readonly (string | undefined)[],
): string | undefined => {
  const joined = ids.filter((id) => id !== undefined).join(' ');
  return joined === '' ? undefined : joined;
};

const unitAmountOf = (
  tiers: SponsorshipOffer['tiers'],
  tier: SponsorshipTier,
): number | null =>
  tiers.find((offer) => toSponsorshipTier(offer.tier) === tier)?.unitPrice
    ?.amount ?? null;

const isSponsorshipTier = (value: string): value is SponsorshipTier =>
  (SPONSORSHIP_TIERS as readonly string[]).includes(value);

function LoginToApply() {
  return (
    <Button asChild size="lg" className="self-start">
      <Link to="/auth/login" search={{ redirect: PRICING_HREF }}>
        {SPONSORSHIP_LOGIN_TO_APPLY_LABEL}
      </Link>
    </Button>
  );
}

function BlockedApply({ reason }: { readonly reason: string }) {
  const reasonId = useId();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="lg" disabled aria-describedby={reasonId}>
        {SPONSORSHIP_APPLY_SUBMIT_LABEL}
      </Button>
      <FormMessage id={reasonId}>{reason}</FormMessage>
    </div>
  );
}

function NoEligibleProducts() {
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p>{SPONSORSHIP_NO_ELIGIBLE_PRODUCTS_MESSAGE}</p>
      <PathLink href={MY_PRODUCTS_LINK_HREF} className={INLINE_LINK_CLASS_NAME}>
        {MY_PRODUCTS_LINK_LABEL}
      </PathLink>
    </div>
  );
}

function TierRadioGroup() {
  const { control } = useFormContext<ApplicationFormValues>();
  const itemBaseId = useId();
  return (
    <FormField
      control={control}
      name="tier"
      label={SPONSORSHIP_FORM_LABELS.tier}
    >
      {(field) => (
        <RadioGroup
          id={field.id}
          ref={field.ref}
          value={field.value ?? ''}
          onValueChange={(value) => {
            if (isSponsorshipTier(value)) {
              field.onChange(value);
            }
          }}
          onBlur={field.onBlur}
          disabled={field.disabled}
          aria-labelledby={field.labelId}
          aria-describedby={field['aria-describedby']}
          aria-invalid={field['aria-invalid']}
          aria-required
          className="flex flex-wrap gap-x-6 gap-y-3"
        >
          {SPONSORSHIP_TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-2">
              <RadioGroupItem id={`${itemBaseId}-${tier}`} value={tier} />
              <Label htmlFor={`${itemBaseId}-${tier}`} translate="no">
                {SPONSORSHIP_TIER_LABELS[tier]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
    </FormField>
  );
}

interface ApplicationSummaryProps {
  readonly unitAmount: number | null;
  readonly days: number | null;
  readonly priceUnavailableId: string;
}

// 価格を照会できないときは期間を選ぶ前から合計の位置に示し、申込のボタンの無効の理由として結ぶ
function ApplicationSummary({
  unitAmount,
  days,
  priceUnavailableId,
}: ApplicationSummaryProps) {
  if (unitAmount !== null && days === null) {
    return null;
  }
  return (
    <dl className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1">
      {days === null ? null : (
        <>
          <dt className="text-sm text-muted-foreground">
            {SPONSORSHIP_FORM_LABELS.days}
          </dt>
          <dd className="font-bold">{sponsorshipDaysLabel(days)}</dd>
        </>
      )}
      <dt className="text-sm text-muted-foreground">
        {SPONSORSHIP_FORM_LABELS.total}
      </dt>
      {unitAmount === null ? (
        <dd id={priceUnavailableId} className="font-bold">
          {SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE}
        </dd>
      ) : (
        <dd className="text-lg font-bold">
          <MoneyText amount={unitAmount * (days ?? 0)} />
        </dd>
      )}
    </dl>
  );
}

interface ApplySubmitProps {
  readonly blocked: boolean;
  readonly describedBy: string | undefined;
}

function ApplySubmit({ blocked, describedBy }: ApplySubmitProps) {
  return (
    <SubmitButton
      size="lg"
      className="self-start"
      disabled={blocked}
      aria-describedby={describedBy}
    >
      {SPONSORSHIP_APPLY_SUBMIT_LABEL}
    </SubmitButton>
  );
}

interface PeriodCheckedSubmitProps extends ApplySubmitProps {
  readonly viewer: ClientViewer;
  readonly productId: string;
  readonly tier: SponsorshipTier;
}

// 掲載期間の欄と同じ照会の結果で、選んだ日が今も選べるかを確かめる。範囲が届くまでと、選んだ開始日の終了日の範囲が返らない間は申し込めない
function PeriodCheckedSubmit({
  viewer,
  productId,
  tier,
  blocked,
  describedBy,
}: PeriodCheckedSubmitProps) {
  const { control } = useFormContext<ApplicationFormValues>();
  const [startsOn, endsOn] = useWatch({
    control,
    name: ['startsOn', 'endsOn'],
  });
  const { data } = useQuery(
    sponsorshipPeriodWindowQueryOptions(viewer, { productId, tier, startsOn }),
  );
  const windows = data?.sponsorshipPeriodWindow;
  const reasons =
    windows === undefined || windows.end === null
      ? undefined
      : selectedSponsorshipDateReasons(windows, { startsOn, endsOn });
  const selectable =
    startsOn !== null &&
    endsOn !== null &&
    reasons !== undefined &&
    reasons.startsOn === undefined &&
    reasons.endsOn === undefined;
  return (
    <ApplySubmit blocked={blocked || !selectable} describedBy={describedBy} />
  );
}

interface ApplicationFormProps {
  readonly viewer: ClientViewer;
  readonly products: readonly SponsorableProduct[];
  readonly tiers: SponsorshipOffer['tiers'];
}

function ApplicationForm({ viewer, products, tiers }: ApplicationFormProps) {
  const form = useAppForm<ApplicationFormValues, ApplicationFormValues>(
    APPLICATION_FORM_SCHEMA,
    { defaultValues: { ...EMPTY_VALUES } },
  );
  const turnstile = useTurnstileToken();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const apply = useMutation(applySponsorshipMutationOptions());
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [paymentsUnavailable, setPaymentsUnavailable] = useState(false);
  const priceUnavailableId = useId();
  const paymentsUnavailableId = useId();
  const errorId = useId();
  const [productId, tier, startsOn, endsOn] = useWatch({
    control: form.control,
    name: ['productId', 'tier', 'startsOn', 'endsOn'],
  });

  const unitAmount = tier === null ? null : unitAmountOf(tiers, tier);
  const counted =
    startsOn === null || endsOn === null
      ? 0
      : countBusinessDaysInclusive(startsOn, endsOn);
  const days = counted > 0 ? counted : null;
  const priceUnavailable = tier !== null && unitAmount === null;
  const bottomFailure = failure === null || failure.atTop ? null : failure;
  const describedBy = describedByOf([
    priceUnavailable ? priceUnavailableId : undefined,
    paymentsUnavailable ? paymentsUnavailableId : undefined,
    bottomFailure === null ? undefined : errorId,
  ]);
  const blocked = priceUnavailable || paymentsUnavailable;

  const submit = async (values: ApplicationFormValues): Promise<void> => {
    setFailure(null);
    if (
      values.productId === null ||
      values.tier === null ||
      values.startsOn === null ||
      values.endsOn === null
    ) {
      return;
    }
    const input = {
      productId: values.productId,
      tier: toGraphQLSponsorshipTier(values.tier),
      startsOn: values.startsOn,
      endsOn: values.endsOn,
    };
    const { applySponsorship } = await sendWithTurnstile(
      turnstile,
      (turnstileToken) =>
        apply.mutateAsync({ variables: { input }, turnstileToken }),
    );
    await navigate({
      to: '/checkout/$purchaseId',
      params: { purchaseId: applySponsorship.purchaseId },
    });
  };

  const handleSubmitError = (error: unknown): void => {
    if (isErrorCode(error, 'payments_unavailable')) {
      setPaymentsUnavailable(true);
      return;
    }
    if (isErrorCode(error, 'sponsorship_overlap')) {
      void invalidateSponsorshipPeriodWindowQueries(queryClient);
    }
    setFailure(failureOf(error));
  };

  return (
    <AppForm
      form={form}
      aria-label={SPONSORSHIP_APPLY_LINK_LABEL}
      serverFieldPrefix="input"
      onSubmit={submit}
      onSubmitError={handleSubmitError}
      className="flex flex-col gap-6 rounded-lg border bg-card p-4 text-card-foreground sm:p-6"
    >
      {failure?.atTop === true ? (
        <FormMessage role="alert">{failure.message}</FormMessage>
      ) : null}
      <SponsorshipProductSelect products={products} />
      <TierRadioGroup />
      <SponsorshipPeriodField
        viewer={viewer}
        productId={productId}
        tier={tier}
      />
      {tier === null ? null : (
        <ApplicationSummary
          unitAmount={unitAmount}
          days={days}
          priceUnavailableId={priceUnavailableId}
        />
      )}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
        {SPONSORSHIP_PURCHASE_CONDITIONS.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={SPONSORSHIP_APPLY_BOT_ACTION}
      />
      <div className="flex flex-col gap-3">
        {productId === null || tier === null ? (
          <ApplySubmit blocked describedBy={describedBy} />
        ) : (
          <PeriodCheckedSubmit
            viewer={viewer}
            productId={productId}
            tier={tier}
            blocked={blocked}
            describedBy={describedBy}
          />
        )}
        {paymentsUnavailable ? (
          <UnavailableNotice
            id={paymentsUnavailableId}
            reason={PAYMENTS_UNAVAILABLE_REASON}
            className="text-xs"
          />
        ) : null}
        {bottomFailure === null ? null : (
          <FormMessage id={errorId} role="alert">
            {bottomFailure.message}
          </FormMessage>
        )}
      </div>
    </AppForm>
  );
}

// 申込はログイン中で利用できるアカウントの利用者だけに開き、申込の対象のプロダクトが無ければ自分のプロダクトの画面へ案内する
export function SponsorshipApplicationForm({
  offer,
}: SponsorshipApplicationFormProps) {
  const viewer = useViewer();
  if (viewer === null) {
    return <LoginToApply />;
  }
  if (viewer.status === 'SUSPENDED') {
    return <BlockedApply reason={SPONSORSHIP_ACCOUNT_SUSPENDED_REASON} />;
  }
  if (!viewer.emailVerified) {
    return <BlockedApply reason={SPONSORSHIP_EMAIL_UNVERIFIED_REASON} />;
  }
  const products = offer.eligibleProducts ?? [];
  if (products.length === 0) {
    return <NoEligibleProducts />;
  }
  return (
    <ApplicationForm viewer={viewer} products={products} tiers={offer.tiers} />
  );
}
