import { useRef } from 'react';
import { useFormContext } from 'react-hook-form';

import { FormField } from '../../../lib/components/form/form-field.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import type { ClientSponsorshipOfferQuery } from '../../graphql/generated/graphql.ts';
import { SPONSORSHIP_FORM_LABELS } from './sponsorship-messages.ts';

export type SponsorableProduct = NonNullable<
  ClientSponsorshipOfferQuery['sponsorshipOffer']['eligibleProducts']
>[number];

interface ProductSelectValues {
  productId: string | null;
}

export interface SponsorshipProductSelectProps {
  readonly products: readonly SponsorableProduct[];
}

// 申込の対象のプロダクトを名称とロゴで選ばせる。ロゴは名称の飾りのため読み上げない
export function SponsorshipProductSelect({
  products,
}: SponsorshipProductSelectProps) {
  const { control } = useFormContext<ProductSelectValues>();
  // 一覧を開くとフォーカスが一覧へ移り開いた元の要素からフォーカスが外れるため、開いている間のフォーカスアウトは検証しない
  const openRef = useRef(false);

  return (
    <FormField
      control={control}
      name="productId"
      label={SPONSORSHIP_FORM_LABELS.product}
    >
      {({ value, onChange, onBlur, ref, name, disabled, ...aria }) => (
        <Select
          name={name}
          value={value ?? ''}
          onValueChange={onChange}
          onOpenChange={(open) => {
            openRef.current = open;
          }}
          disabled={disabled}
        >
          <SelectTrigger
            ref={ref}
            {...aria}
            aria-required
            className="w-full sm:w-80"
            onBlur={() => {
              if (!openRef.current) {
                onBlur();
              }
            }}
          >
            <SelectValue
              placeholder={SPONSORSHIP_FORM_LABELS.productPlaceholder}
            />
          </SelectTrigger>
          <SelectContent>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                <MediaPicture
                  image={product.logo}
                  display={{ kind: 'square', size: 32 }}
                  alt=""
                  placeholder={{ label: product.name, seed: product.handle }}
                  className="shrink-0 rounded-sm"
                />
                <span className="truncate">{product.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
