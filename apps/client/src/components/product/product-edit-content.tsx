import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { type ReactNode, useCallback, useId, useState } from 'react';

import {
  invalidateMyProductQueries,
  type MyProductEditView,
  myProductQueryOptions,
  type ProductCategoryView,
  productCategoriesQueryOptions,
  toMyProductLookup,
  toProductCategoryViews,
} from '../../graphql/my-products.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import { DANGER_SECTION_HEADING } from './product-edit-messages.ts';
import {
  changeLockReasonOf,
  editRefreshBoundariesOf,
} from './product-edit-state.ts';
import { ProductDeleteDialog } from './product-delete-dialog.tsx';
import { ProductEditStatusSection } from './product-edit-status-section.tsx';
import { ProductForm } from './product-form.tsx';
import { editProductFormSchemaOf } from './product-form-schema.ts';
import { editProductFormDefaultsOf } from './product-form-values.ts';
import type {
  MyProductSection,
  ProductDeleteNotice,
} from './product-section-types.ts';
import { useProductUpdate } from './use-product-update.ts';

export interface ProductEditContentProps {
  readonly viewerId: string;
  // 編集画面のURLのハンドル
  readonly handle: string;
  // 真なら全欄と送信と削除を無効にする(停止中の利用者)
  readonly disabled: boolean;
  readonly labelledBy: string;
  // orderの順に並べ替え済みの登録
  readonly sections: readonly MyProductSection[];
  readonly deleteNotices: readonly ProductDeleteNotice[];
}

interface EditableProductProps extends Omit<ProductEditContentProps, 'handle'> {
  // 表示中に取り直した最新のプロダクト
  readonly product: MyProductEditView;
  readonly categories: readonly ProductCategoryView[];
}

// フォームを作った時点のプロダクトと、フォームを作り直す鍵
interface FormBase {
  readonly product: MyProductEditView;
  readonly generation: number;
}

function DangerSection({ children }: { readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border border-destructive/40 p-4 sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-bold">
        {DANGER_SECTION_HEADING}
      </h2>
      {children}
    </section>
  );
}

// 状態の区画・固定と削除(送る版を含む)は表示中に取り直した最新のプロダクトで示し、削除の確認のダイアログが示す名称・固定と送る版をそろえる。保存の値と版はフォームを作った時点のプロダクトから作り、取り直しでフォームの入力が消えないよう、フォームは保存の成功と最新の内容の読み込みでだけ作り直す
function EditableProduct({
  viewerId,
  product,
  categories,
  disabled,
  labelledBy,
  sections,
  deleteNotices,
}: EditableProductProps) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState<FormBase>({ product, generation: 0 });
  const rebuildWith = (next: MyProductEditView): void => {
    setBase(({ generation }) => ({
      product: next,
      generation: generation + 1,
    }));
  };
  const refresh = useCallback(() => {
    void invalidateMyProductQueries(queryClient);
  }, [queryClient]);
  useBoundaryRefresh(editRefreshBoundariesOf(product.latestLaunch), refresh);
  const save = useProductUpdate({
    viewerId,
    product: base.product,
    reserving: product.plan.mode === 'new',
    onSaved: rebuildWith,
  });
  const reloadLatest = async (): Promise<void> => {
    const lookup = toMyProductLookup(
      await queryClient.query({
        ...myProductQueryOptions(viewerId, base.product.handle),
        staleTime: 0,
      }),
    );
    if (lookup.kind === 'found') {
      rebuildWith(lookup.product);
      document.getElementById(labelledBy)?.focus();
    }
  };
  const lockReason = changeLockReasonOf(product.plan);
  const formProduct = base.product;

  return (
    <div className="flex flex-col gap-10">
      <ProductEditStatusSection product={product} sections={sections} />
      <ProductForm
        key={base.generation}
        schema={editProductFormSchemaOf(product.plan)}
        defaultValues={editProductFormDefaultsOf(formProduct)}
        categories={categories}
        launchDate={{
          kind: 'edit',
          plan: product.plan,
          productHandle: formProduct.handle,
        }}
        current={{
          handle: formProduct.handle,
          previousHandle: formProduct.previousHandle,
          logo: {
            fileId: formProduct.logoFileId,
            image: formProduct.logo,
            productName: formProduct.name,
            productHandle: formProduct.handle,
          },
          screenshots: formProduct.screenshots,
        }}
        {...(lockReason === undefined
          ? {}
          : { categoryDisabledReason: lockReason })}
        disabled={disabled}
        labelledBy={labelledBy}
        onSave={save}
        onReloadLatest={reloadLatest}
      />
      <DangerSection>
        <ProductDeleteDialog
          productName={product.name}
          productHandle={product.handle}
          expectedVersion={product.version}
          notices={deleteNotices}
          {...(lockReason === undefined ? {} : { lockReason })}
          disabled={disabled}
        />
      </DangerSection>
    </div>
  );
}

// 表示中の取り直しで、別の画面でハンドルが変わっていれば新しい編集画面へ移り、削除されていれば自分のプロダクトの一覧へ移る
export function ProductEditContent({
  viewerId,
  handle,
  ...props
}: ProductEditContentProps) {
  const [{ data }, { data: categories }] = useSuspenseQueries({
    queries: [
      myProductQueryOptions(viewerId, handle),
      productCategoriesQueryOptions(),
    ],
  });
  const lookup = toMyProductLookup(data);
  if (lookup.kind === 'redirect') {
    return (
      <Navigate
        to="/my/products/$handle/edit"
        params={{ handle: lookup.handle }}
        replace
      />
    );
  }
  if (lookup.kind === 'not-found') {
    return <Navigate to="/my/products" replace />;
  }
  return (
    <EditableProduct
      viewerId={viewerId}
      product={lookup.product}
      categories={toProductCategoryViews(categories)}
      {...props}
    />
  );
}
