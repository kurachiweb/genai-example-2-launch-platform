import type { SquareDisplaySize } from '../../../common-lib/media/image-variants.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { checkExternalUrl } from '../../../common-lib/url/external-url.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { SponsoredAdFieldsFragment } from '../../graphql/generated/graphql.ts';
import { toSponsorshipTier } from '../../graphql/sponsorship.ts';
import { SponsorLabel } from './sponsor-label.tsx';
import { sponsoredAdLinkLabel } from './sponsorship-messages.ts';

export interface SponsoredAdCardProps {
  readonly ad: SponsoredAdFieldsFragment;
}

interface TierAppearance {
  readonly logoSize: SquareDisplaySize;
  readonly logoClassName: string;
  readonly frameClassName: string;
  readonly showsTagline: boolean;
  // 各ページの上部に置くLegendは最初の表示の範囲に入るため、遅延させない
  readonly logoLoading: 'lazy' | undefined;
}

// 演出の動きを使わず、ティアの色と枠の太さと影で目立ち度を分ける。Legendの枠は内側をカードの色、枠の領域を黒のグラデーションで塗る
const TIER_APPEARANCES: Readonly<Record<SponsorshipTier, TierAppearance>> =
  Object.freeze({
    legend: {
      logoSize: 64,
      logoClassName: 'size-16 rounded-lg',
      frameClassName:
        'gap-3 rounded-xl border-2 border-transparent p-3 shadow-md [background:linear-gradient(var(--card),var(--card))_padding-box,linear-gradient(120deg,var(--legend-a),var(--legend-b),var(--legend-a))_border-box]',
      showsTagline: true,
      logoLoading: undefined,
    },
    gold: {
      logoSize: 64,
      logoClassName: 'size-16 rounded-lg',
      frameClassName:
        'gap-3 rounded-xl border-2 border-gold bg-card p-3 shadow-sm',
      showsTagline: true,
      logoLoading: 'lazy',
    },
    silver: {
      logoSize: 32,
      logoClassName: 'size-8 rounded-md',
      frameClassName: 'gap-2 rounded-lg border border-silver bg-card p-2',
      showsTagline: false,
      logoLoading: 'lazy',
    },
  });

const LINK_REL = 'sponsored noopener';

function AdName({ ad }: SponsoredAdCardProps) {
  // 表示の時点でサーバーが検証した値だけが届く前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
  if (ad.websiteUrl === null || checkExternalUrl(ad.websiteUrl) !== 'ok') {
    return ad.productName;
  }
  return (
    <a
      href={ad.websiteUrl}
      target="_blank"
      rel={LINK_REL}
      aria-label={sponsoredAdLinkLabel(ad.productName)}
      className="rounded-sm text-card-foreground no-underline after:absolute after:inset-0 after:rounded-xl hover:underline"
    >
      {ad.productName}
    </a>
  );
}

export function SponsoredAdCard({ ad }: SponsoredAdCardProps) {
  const tier = toSponsorshipTier(ad.tier);
  const appearance = TIER_APPEARANCES[tier];
  return (
    <div
      data-slot="sponsored-ad-card"
      className={cn(
        'relative flex min-w-0 items-center text-card-foreground',
        appearance.frameClassName,
      )}
    >
      <MediaPicture
        image={ad.logo}
        display={{ kind: 'square', size: appearance.logoSize }}
        alt=""
        placeholder={{ label: ad.productName, seed: ad.productName }}
        loading={appearance.logoLoading}
        className={cn('shrink-0', appearance.logoClassName)}
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <SponsorLabel tier={tier} />
        <p className="text-sm font-bold wrap-anywhere">
          <AdName ad={ad} />
        </p>
        {appearance.showsTagline && ad.tagline !== null && (
          <p className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
            {ad.tagline}
          </p>
        )}
      </div>
    </div>
  );
}
