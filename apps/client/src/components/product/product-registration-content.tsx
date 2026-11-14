import { useSuspenseQueries } from '@tanstack/react-query';

import {
  newProductLaunchWindowQueryOptions,
  productCategoriesQueryOptions,
  toLaunchDateWindowView,
  toProductCategoryViews,
} from '../../graphql/my-products.ts';
import { ProductForm } from './product-form.tsx';
import { REGISTER_PRODUCT_FORM_SCHEMA } from './product-form-schema.ts';
import { EMPTY_PRODUCT_FORM_VALUES } from './product-form-values.ts';
import { useProductRegistration } from './use-product-registration.ts';

export interface ProductRegistrationContentProps {
  readonly viewerId: string;
  readonly disabled: boolean;
  readonly labelledBy: string;
}

export function ProductRegistrationContent({
  viewerId,
  disabled,
  labelledBy,
}: ProductRegistrationContentProps) {
  const [{ data: launchWindow }, { data: categories }] = useSuspenseQueries({
    queries: [
      newProductLaunchWindowQueryOptions(viewerId),
      productCategoriesQueryOptions(),
    ],
  });
  const register = useProductRegistration();

  return (
    <ProductForm
      schema={REGISTER_PRODUCT_FORM_SCHEMA}
      defaultValues={EMPTY_PRODUCT_FORM_VALUES}
      categories={toProductCategoryViews(categories)}
      launchDate={{
        kind: 'register',
        window: toLaunchDateWindowView(launchWindow.newProductLaunchWindow),
      }}
      disabled={disabled}
      labelledBy={labelledBy}
      onSave={register}
    />
  );
}
