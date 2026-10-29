# 共通化する部品

画面を持つ複数のアプリが使う部品を共通部品に置く基準と、部品の一覧と使い方を定める。あわせて、1ファイル1コンポーネントの規則とshadcn/uiの部品の分割、部品のカタログ(Storybook)の書き方、ブラウザの翻訳への耐性を記す。

## 前提と用語

アクセシビリティの規則は「[アクセシビリティ規則](004-accessibility-rules.md)」、日時の要素は「[マークアップの規約](001-markup-conventions.md)」に従う。部品の置き場所は、共通部品のディレクトリからのパスで示す。アプリからは`<共通部品の配置先>`を通して相対パスで読み込む(例:`../../<共通部品の配置先>/components/ui/button/button.tsx`)。コードの例では、`<共通部品の配置先>`までの相対パスを省いて書く。

| 用語                 | 意味                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 共通部品             | 画面を持つ複数のアプリが使う共有ディレクトリ(「[共有ディレクトリの配置方式](../coding/003-shared-directories.md)」)。検査担当は自分自身 |
| `<共通部品の配置先>` | 共通部品を利用側アプリへ配置したディレクトリ                                                                                            |
| 部品                 | Reactのコンポーネント。部品の補助のフック(`use-*.ts`)を含めて呼ぶこともある                                                             |
| shadcn/ui            | Radix UIとTailwind CSSで作った部品のコードを、自分のリポジトリへ写して使う部品集                                                        |
| カタログ             | 共通部品の部品を状態ごとに閲覧するStorybook。共通部品にだけ導入する                                                                     |
| `cn`                 | クラス名を結合し、Tailwind CSSの衝突するクラスを後の指定で上書きする関数(`utilities/class-names.ts`)                                    |

## 共通化の対象

| 置き場所                   | 置くもの                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共通部品の`components/`    | 複数のアプリで同じ見た目と振る舞いを持つ部品。基本部品・フォーム・状態表示・トースト・エラーの表示・日時と数値・bot判定・配色の切替・文書の外枠・疎通確認 |
| アプリの`src/components/`  | 1つのアプリだけの部品。レイアウト(ヘッダー・ナビゲーション・フッター)、ルーターやアプリの導線を共通部品へ結び付けるページの部品(404・エラーの画面など)    |
| アプリの`src/composition/` | アプリ固有の値(導線・レイアウトに差し込む区画など)の登録箇所                                                                                              |

- 共通部品は、アプリ固有の値(リンク先・問い合わせの導線・サービス名など)を持たず、propsで受け取る。共通部品から利用側アプリの`src`への読み込みは、静的解析の`frontend/direction/*`(「[画面を持つアプリの静的解析](../coding/001-javascript-typescript-conventions.md#画面を持つアプリの静的解析)」)が禁止する。
- 共通部品の`components/`は、`utilities/`・`start/`の値と、`server/`の型だけを読み込める。サーバー専用のファイル(`*.server.ts`)は読み込めない。
- 2つ目のアプリで同じ部品が必要になった時点で、アプリの部品を共通部品へ移す。アプリ固有の値はpropsに出す。

## 部品の一覧

| ディレクトリ                 | 部品                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 役割                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `components/ui/`             | `Badge`・`Button`・`Dialog`(`DialogTrigger`・`DialogPortal`・`DialogOverlay`・`DialogContent`・`DialogHeader`・`DialogFooter`・`DialogTitle`・`DialogDescription`・`DialogClose`)・`DropdownMenu`(`DropdownMenuTrigger`・`DropdownMenuPortal`・`DropdownMenuContent`・`DropdownMenuGroup`・`DropdownMenuLabel`・`DropdownMenuItem`・`DropdownMenuCheckboxItem`・`DropdownMenuRadioGroup`・`DropdownMenuRadioItem`・`DropdownMenuSeparator`・`DropdownMenuShortcut`・`DropdownMenuSub`・`DropdownMenuSubTrigger`・`DropdownMenuSubContent`)・`Input`・`Label`・`Popover`(`PopoverTrigger`・`PopoverAnchor`・`PopoverContent`・`PopoverHeader`・`PopoverTitle`・`PopoverDescription`)・`RadioGroup`(`RadioGroupItem`)・`Sheet`(`SheetTrigger`・`SheetPortal`・`SheetOverlay`・`SheetContent`・`SheetHeader`・`SheetFooter`・`SheetTitle`・`SheetDescription`・`SheetClose`)・`Skeleton`・`Switch`・`Tabs`(`TabsList`・`TabsTrigger`・`TabsContent`)・`Textarea`・`Tooltip`(`TooltipProvider`・`TooltipTrigger`・`TooltipContent`) | shadcn/uiを基にした基本部品                              |
| `components/form/`           | `useAppForm`・`AppForm`・`FormField`・`FormMessage`・`SubmitButton`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 検証規則をZodで定義するフォーム                          |
| `components/state/`          | `LoadingSkeleton`・`EmptyState`・`ErrorState`・`PartialErrorState`・`UnavailableNotice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 読み込み中・空・エラー・部分的なエラー・縮退運転中の表示 |
| `components/feedback/`       | `Toaster`・`notify`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 操作の結果を短時間表示するトースト                       |
| `components/error/`          | `NotFoundView`・`UnexpectedErrorView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 存在しないページと想定外のエラーの表示                   |
| `components/datetime/`       | `DateTime`・`RelativeTime`・`NumberText`・`DisplayPreferencesProvider`・`useDisplayPreferences`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 利用者のタイムゾーンとロケールでの日時と数値の表示       |
| `components/bot-protection/` | `TurnstileWidget`・`useTurnstileToken`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | bot判定のウィジェットとトークンの管理                    |
| `components/theme/`          | `ThemeToggle`・`useTheme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ライト・ダークの配色の切替                               |
| `components/app-shell/`      | `AppDocument`・`SkipLink`・`RouteAnnouncer`・`MAIN_CONTENT_ID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `<html>`から描画する文書の外枠                           |
| `components/system/`         | `SystemStatusView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 疎通確認の画面の本体                                     |

## 使い方

### 基本部品

| 部品               | 主なprops                                                                                                                                                             | 使い方                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`           | `variant`(`default`・`destructive`・`outline`・`secondary`・`ghost`・`link`)・`size`(`default`・`xs`・`sm`・`lg`・`icon`・`icon-xs`・`icon-sm`・`icon-lg`)・`asChild` | リンクは`<Button asChild><a href="…">…</a></Button>`。アイコンだけのボタンは`aria-label`か画面に見えない文言で名前を付ける               |
| `Badge`            | `variant`(`Button`と同じ6種)・`size`(`default`・`lg`)・`asChild`                                                                                                      | リンクのバッジは`asChild`で`<a>`を渡す                                                                                                   |
| `DialogContent`    | `showCloseButton`(既定は真)                                                                                                                                           | 文書の末尾への描画と背景の覆いを含む。`DialogTitle`を必ず置く                                                                            |
| `SheetContent`     | `side`(`top`・`right`・`bottom`・`left`、既定は`right`)・`showCloseButton`                                                                                            | 狭い画面のメニューなど。`SheetTitle`を必ず置く                                                                                           |
| `Popover`          | `modal`                                                                                                                                                               | 中で入力を完結させる時は`modal`でフォーカスを閉じ込める                                                                                  |
| `Tooltip`          | —                                                                                                                                                                     | 内容はトリガーの説明として伝わる。必要な情報をツールチップだけに置かない。`TooltipProvider`は`AppDocument`が置くため、アプリでは置かない |
| `DropdownMenuItem` | `variant`(`default`・`destructive`)・`inset`                                                                                                                          | 破壊的な操作は`destructive`にし、文言でも示す                                                                                            |
| `TabsList`         | `variant`(`default`・`line`)                                                                                                                                          | —                                                                                                                                        |
| `Switch`           | `size`(`default`・`sm`)                                                                                                                                               | —                                                                                                                                        |
| `Skeleton`         | —                                                                                                                                                                     | `aria`を持たない。読み込み中の表示は`LoadingSkeleton`で包む                                                                              |

- アイコンは`lucide-react`から読み込み、`aria-hidden="true"`を付ける。
- 見た目の調整は`className`で渡す。部品は`cn`で結合するため、衝突するクラスは渡した側が勝つ。フォーカスの輪郭を消すクラスは渡さない(「[フォーカスの輪郭](004-accessibility-rules.md#フォーカスの輪郭)」)。

### フォーム

Zodで検証規則を定義し、`useAppForm`で作ったフォームを`AppForm`・`FormField`・`SubmitButton`で描画する。Zodの値は、JITの試行を止める設定を済ませた`utilities/validation/zod.ts`の`z`から読み込む(「[実行時のコード生成を試すライブラリ](003-frontend-server-security.md#実行時のコード生成を試すライブラリ)」)。

```tsx
import { useState } from 'react';

import { AppForm } from '<共通部品の配置先>/components/form/app-form.tsx';
import { FormField } from '<共通部品の配置先>/components/form/form-field.tsx';
import { FormMessage } from '<共通部品の配置先>/components/form/form-message.tsx';
import { SubmitButton } from '<共通部品の配置先>/components/form/submit-button.tsx';
import { useAppForm } from '<共通部品の配置先>/components/form/use-app-form.ts';
import { Input } from '<共通部品の配置先>/components/ui/input/input.tsx';
import { errorMessageOf } from '<共通部品の配置先>/utilities/graphql/graphql-result.ts';
import { z } from '<共通部品の配置先>/utilities/validation/zod.ts';

import { APP_PROFILE } from '../../composition/app-profile.ts';

const profileSchema = z.object({
  name: z.string().trim().min(1, '名前を入力してください。'),
});

export function ProfileForm() {
  const form = useAppForm(profileSchema, { defaultValues: { name: '' } });
  const [submitError, setSubmitError] = useState<string>();
  return (
    <AppForm
      form={form}
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await saveProfile(values);
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, APP_PROFILE.contactAvailable));
      }}
      serverFieldPrefix="input"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="name"
        label="名前(必須)"
        description="公開のページに表示されます。"
      >
        {(control) => <Input {...control} aria-required />}
      </FormField>
      <SubmitButton>保存する</SubmitButton>
    </AppForm>
  );
}
```

| 部品・関数                              | 引数・props                                                                                  | 振る舞い                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useAppForm(schema, { defaultValues })` | Zodの規則と、全欄の既定値                                                                    | React Hook Formのフォームを返す。最初にフォーカスを外した時に検証し、以降は入力のたびに検証し直す。文言の無い規則のエラーは、Zodの英語の既定の文言を見せず、共通の既定の文言にする。無効の欄の値は検証の前に除き、残りの欄だけを検証する。渡したスキーマの同一性が変わると、新しいスキーマで検証し直す |
| `AppForm`                               | `form`・`onSubmit`・`onSubmitError`・`serverFieldPrefix`と、`<form>`の属性                   | 検証を通った値で`onSubmit`を呼ぶ。送信中の重ねての送信は1回にまとめる。`onSubmit`が投げたエラーの欄ごとの詳細を欄のエラーにし、最初の欄へフォーカスを移す。欄をまとめた値・無効の欄・描かれていない欄に付く詳細は、欄に対応しない詳細として`onSubmitError`へ渡す                                       |
| `FormField`                             | `control`・`name`・`label`・`description`・`className`・`disabled`と、入力欄を描く関数の子   | ラベル・説明・エラーを入力欄に関連付ける。子の関数が受け取る値(`id`・`aria-invalid`・`aria-describedby`・値・変更と離脱の処理・`ref`、無効の時は`disabled`)を入力欄へ渡す。`disabled`が真になると、その欄のエラーを消す。`AppForm`の中でだけ使う                                                       |
| `SubmitButton`                          | `pendingLabel`(既定は送信中を示す文言)・`disabled`と`Button`のprops(`type`・`asChild`を除く) | `disabled`が真の間か、未入力の必須項目・検証エラー、または欄に付いたエラー(サーバーのエラーと、利用側が`setError`で欄に付けたエラー)が残る間は`disabled`、送信中は`aria-disabled`・`aria-busy`と`pendingLabel`の文言                                                                                   |

- `defaultValues`は全欄を指定する。サーバーの詳細は、既定値に経路がある欄にだけ対応させるためである。
- 入力欄を描かない値(識別子など)は、スキーマの入力に含めず`onSubmit`で加える。条件によって描かない欄も、描かない間はスキーマから外す(条件ごとのスキーマに切り替える、別のスキーマのフォームに分けるなど)。スキーマの入力に含めると、その値へのサーバーのエラーを利用者が直せず、送信ボタンが無効のまま残る。`defaultValues`は型でスキーマの入力の全欄を求めるため、既定値から外すだけでは避けられない。
- スキーマを条件で切り替える時は、条件ごとのスキーマをモジュールの定数として用意して選び、描画ごとに作らない。`useAppForm`はスキーマの同一性が変わると新しいスキーマで検証し直すため、描画ごとに作ると描画のたびに検証し直し、フォームの状態(エラーや`isValid`)を読む部品では、検証の結果による描き直しが新しいスキーマを作って再び検証させ、検証と描き直しが止まらなくなる。検証し直すと、送信ボタンの有効・無効は新しいスキーマの結果になり、欄に付いたエラーは描かれている欄の検証のエラーも含めて新しいスキーマの結果に置き換わる(新しい規則で正しいか、その欄の規則が無ければ消える)。描かれていて触れたことのある欄(一度でも欄から離れた欄)は、今エラーが無くても新しい規則で検証し直し、違反ならエラーを出す。まだ触れていない欄は検証し直さず、新しい規則で違反になってもエラーを出さずに送信ボタンの無効だけで示し、その欄を次に検証した時にエラーを出す(一覧の経路そのものに付いたエラーの場合を除く。後述)。値だけを変えた欄(`setValue`に`shouldTouch`を付けないもの)は触れていない扱いになる。描かれていない触れた欄は、違反のエラーを利用者が直せないため検証し直さない。`rules`を持つ一覧(`useFieldArray`)の経路そのもの(例: `links`)は、中の欄に触れると触れた扱いになるが、触れた欄としては検証し直さず、中の触れた欄だけを検証し直す。一覧の経路で検証し直すと一覧の中のエラーがまるごと置き換わり、中の欄のサーバーのエラーが消え、まだ触れていない中の欄にもエラーが出るためである。描かれている欄のサーバーのエラーだけは置き換えずに残し、利用者がその欄を入力し直すと消える。描かれていない欄のサーバーのエラーは、利用者が直せないため新しいスキーマの結果に置き換わる。一覧全体の規則(`z.array(...).min(2)`など)のエラー(`<一覧>.root`)は新しい規則の結果に置き換わり、一覧の中の欄のエラーは欄ごとに上の扱いになる(描かれている欄のサーバーのエラーは残る)。`rules`を持たない一覧(`useFieldArray`)の経路そのもの(例: `links`)に付いたエラー(サーバーの詳細が一覧の経路に付いた時など)は、一覧を描いていても描かれていない欄と同じく扱い、サーバーのエラーも一覧ごと新しいスキーマで検証し直した結果に置き換わる。一覧全体が新しい規則に違反すれば一覧全体のエラー(`links.root`)だけになり、一覧の中の欄のエラーは付かない。一覧の中の欄だけが違反すれば、まだ触れていない一覧の中の欄にもエラーが付く。どちらも違反しなければエラーは消える。利用側が`setError`で`root`以外の欄に付けたエラーは、検証のエラーと同じく新しいスキーマの結果に置き換わる(新しい規則で正しいか、その欄の規則が無ければ消える)。切り替えの後も残したいエラーは、欄ではなく`root`に`setError('root.<名前>')`で付ける。フォーム全体のエラーは切り替えで変わらない。欄をまとめた値の子の欄と一覧の要素の欄に`type`・`message`・`types`・`ref`の名前を使わない。フォームはこれらの名前を持つ値をエラーそのものと見分けられず、その値の子の欄のサーバーのエラーも切り替えで置き換わるためである。既定値の入れ子のキー(例: `contact.type`・`links.0.message`)にこれらの名前があると、開発時とテストでは`useAppForm`がフォームを作る時に、該当する経路を示す例外を投げる。最上位の欄の名前(例: `type`)と、`Date`・`File`など欄の値として扱う値の中のキーは対象にしない。判定は`process.env.NODE_ENV`が`production`でない時だけ行い、本番のビルドではViteが`process.env.NODE_ENV`を置き換えて判定の処理を除くため(サーバー側の描画を担うWorkerのバンドルでは`@cloudflare/vite-plugin`が置き換える)、例外を投げない。本番のビルドの出力に判定が含まれないことは、`useAppForm`を入口にして`NODE_ENV`を指定せずにViteでビルドした出力に、例外の文言が含まれないことで確かめる。
- 欄に付いたサーバーのエラーは、利用者がその欄を入力し直すとその欄の分だけ消える。送信ボタンは、すべての欄のサーバーのエラーが消え、検証も通ると有効に戻る。利用側が`setError('root.<名前>')`で付けたフォーム全体のエラーは、欄を直しても次の送信まで残るため、送信ボタンの無効化の条件に数えない。
- サーバーの詳細の`field`が`input.name`のように引数の名前で始まる時は、`serverFieldPrefix`に接頭辞(`input`)を渡して外す。
- サーバーの詳細が欄をまとめた値(配列でないオブジェクト。例: `address.city`の欄を持つ値の`address`)の経路に付く時は、欄に付けず欄に対応しない詳細(`unmatched`)として`onSubmitError`へ渡し、フォーム全体の失敗として示す。欄をまとめた値に付けたエラーはどの入力欄にも表示されず、子の欄を入力し直しても消えないためである。配列の値(一覧の欄)と、`Date`・`File`・`FileList`などの値の経路は欄として扱う。入力欄を描かない値をスキーマの入力に含めない制約は、この扱いでは代えられない。描かない値をオブジェクトにまとめても、その中の値の経路への詳細は欄に付くためである。
- 欄を無効にする時は`FormField`の`disabled`で無効にする。入力要素に`disabled`の属性だけを付けると、フォームはその欄を無効と扱わず、その欄に付いたサーバーのエラーを利用者が直せず送信ボタンが無効のまま残る。
- `FormField`の`disabled`が真になると(最初から真の時を含む)、その欄に付いていた検証のエラーとサーバーのエラーを消す。無効の欄は利用者が入力し直せず、エラーが残ると送信ボタンが無効のまま残るためである。
- 描かれているが無効の欄(その欄の下の経路を含む)に付くサーバーの詳細も、欄に付けず`unmatched`として`onSubmitError`へ渡す。
- 画面に描かれていない欄(条件で描いていない欄、描かなくなった欄)に付くサーバーの詳細も、欄に付けず`unmatched`として`onSubmitError`へ渡す。描かれていない欄に付けたエラーは表示されず、利用者が直せないためである。ただし`rules`を持たない一覧(`useFieldArray`)は、条件で描き分けても一覧の経路そのもの(例: `links`)の詳細を欄に付ける。一覧の中の欄(例: `links.0.url`)の詳細は、その欄が描かれているかで判定する。描かない値は送らないため、描かない一覧へサーバーが詳細を返すことは通常無い。
- すべての欄を無効にするフォーム(閲覧のみ・停止中など)は、無効の`Button`を描かず、`SubmitButton`の`disabled`で送信ボタンを無効にする。無効の欄の値と検証のエラーは除かれるため、すべての欄が無効のフォームは検証を通り、`SubmitButton`は入力の状態からは有効になるためである。
- 無効の欄の値は、`onSubmit`へ渡す値から実行時に消えるが、出力の型(`TOutput`)には残る。型を頼りにせず、APIに要る無効の欄の値(変えられない欄の現在の値など)は`onSubmit`で読み込んだ値から足す。
- 無効になり得る欄は、スキーマで任意(`.optional()`)にする。`refine`・`superRefine`などで参照する時は、その欄が無い場合を扱う。`useAppForm`は検証の前に無効の欄の値を除いて残りの欄だけをスキーマに通すため、無効の欄の値がスキーマを通らなくても、変換を通った値で送信できる。
- 無効になり得る欄を任意にしないスキーマでは、無効の欄の検証エラーで送信ボタンが無効のまま残らないよう、そのエラーを除いて送信を進める。この時はスキーマの出力が無いため、変換(`transform`・`trim`など)と、オブジェクトの`refine`・`superRefine`による項目をまたぐ検証(確認用の入力の一致など)を受けない入力の値が`onSubmit`へ渡る。このため、無効になり得る欄を任意にする規則は省けない。
- `onSubmitError`は必須で、欄に対応しない詳細(`unmatched`)が残った時と、詳細の無い失敗の時に呼ばれる。フォームの近くに`role="alert"`で文言を出すなど、利用者へ伝える処理を書く。文言は`errorMessageOf(error, <プロファイル>.contactAvailable)`で選び、例外の`message`を直接出さない(「[エラーの扱い](006-data-fetching.md#エラーの型と画面の分岐)」)。想定外の失敗をエラートラッキングへ送るかは利用側が決める。`onSubmitError`自体が投げた例外は`globalThis.reportError`へ渡される。
- `FormField`は`AppForm`の中でだけ使う。`AppForm`が配るフォームの文脈(React Hook Formの`FormProvider`)から、欄のエラーを消す処理を読むためである。
- `FormField`は`<label for>`で名前を付けるため、名前を付けられる要素(`input`・`textarea`・`button`)を描く部品に使う。値の受け渡しの名前が`value`・`onChange`と異なる部品は、受け取った値を対応する名前で渡す。
- 必須の印は自動で付かない。ラベルか説明の文言で示し、入力欄に`aria-required`を渡す。
- フォームの部品は、公開のAPIで置き換えられないReact Hook Formの内部の値(欄ごとの無効の集合、欄の描画の状態、一覧の名前の集合)と、公開されていない振る舞い(名前の配列を渡した検証のエラーの置き換えの範囲、resolverが受け取る値、送信の値から無効の欄を外すこと、購読していないフォームでも触れた状態を記録することなど)に頼る。頼る項目は版の番人テスト(`components/form/form-library-internals.unit.test.ts`)が一覧に持ち、`react-hook-form`・`@hookform/resolvers`の版が確かめた版と異なると失敗する。版を上げる時は「[内部の値に頼るパッケージの版を上げる手順](../coding/002-dependency-versions.md#内部の値に頼るパッケージの版を上げる手順)」に従う。

### 状態表示

| 部品                | props                                                                        | 表示                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LoadingSkeleton`   | `label`(既定は読み込み中を示す文言)・`children`(スケルトンの形、省略時は3行) | 読み込み中の文言を状態の領域で伝え、スケルトンの形を読み上げから外す                                                                                       |
| `EmptyState`        | `title`・`description`・`action`・`headingLevel`(2〜6)                       | 空であることと次の行動への導線。`headingLevel`を指定すると見出し付きの`<section>`になる                                                                    |
| `ErrorState`        | `message`・`onRetry`・`contactHref`(省略可)                                  | ページや区画の読み込みの失敗。再試行のボタンと問い合わせのリンク。`contactHref`を省略すると問い合わせのリンクを描かない。技術的な詳細を`message`に入れない |
| `PartialErrorState` | `message`・`onRetry`                                                         | ページの一部の区画の失敗。ページ全体の表示を保ったまま、その区画に再試行のボタンを出す                                                                     |
| `UnavailableNotice` | `reason`                                                                     | 縮退運転中。利用できないことを示す題と理由                                                                                                                 |

- 導線(`contactHref`・`EmptyState`の`action`の中のリンク)は通常の`<a href>`で描画し、クライアント側の遷移を行わない。
- 問い合わせの画面を持たないアプリ(プロファイルの`contactAvailable`が偽)は、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さない。`contactAvailable`が真のアプリだけが渡す。
- `ErrorState`・`PartialErrorState`の`message`は`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。`GraphQLClientError`でない例外では、問い合わせの導線が無いアプリに問い合わせを促す文を出さない(「[エラーの扱い](006-data-fetching.md#エラーの型と画面の分岐)」)。

### トースト

`Toaster`は`AppDocument`が画面の下中央に1つだけ置く。アプリでは置かず、`notify`で表示する。

```tsx
import { notify } from '<共通部品の配置先>/components/feedback/notify.ts';
import { errorMessageOf } from '<共通部品の配置先>/utilities/graphql/graphql-result.ts';

import { APP_PROFILE } from '../../composition/app-profile.ts';

notify.success('保存しました。');
notify.error(errorMessageOf(error, APP_PROFILE.contactAvailable));
```

- `notify`は`success`・`info`・`warning`・`error`の4種で、文言だけを受け取る。失敗を知らせる時の文言は`errorMessageOf(error, <プロファイル>.contactAvailable)`で選び、例外の`message`を直接渡さない。
- トーストは操作の結果の通知に使い、利用者の対応が要る失敗は`ErrorState`・`PartialErrorState`かフォームの表示で示す(「[状態とエラーの伝え方](004-accessibility-rules.md#状態とエラーの伝え方)」)。

### エラーの表示

| 部品                  | props                            | 表示                                                                                                                                                              |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotFoundView`        | `links`(`{ href, label }`の配列) | 存在しないページの見出し・案内と導線。最初の導線を主の見た目、残りを枠線の見た目にする                                                                            |
| `UnexpectedErrorView` | `onRetry`・`contactHref`(省略可) | 想定外のエラーの見出し・案内と再試行のボタン。`contactHref`を省略すると問い合わせのリンクを描かず、案内を時間をおいた再試行だけにして問い合わせを促す文を出さない |

- どちらも`<h1>`を持つ。アプリは、ルートの`notFoundComponent`・`errorComponent`に、導線やルーターの再読み込み(`router.invalidate()`)を結び付けたページの部品を置き、その中でこれらを描画する。
- 共通レイアウトは、ルートの`errorComponent`・`notFoundComponent`も包むよう、ルートの`shellComponent`に`AppDocument`と合わせて置く(ルートの`component`はそれらに置き換えられるため)。

### 日時と数値

| 部品           | props                                                                                                                                   | 表示                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DateTime`     | `value`(時差を含むISO形式の文字列か`Date`)・`format`(`time`・`date`・`dateWeekday`・`yearDate`・`longDate`・`dateTime`・`longDateTime`) | `<time datetime>`で、利用者のタイムゾーンとロケールで整形した日時                                   |
| `RelativeTime` | `target`・`kind`(`remaining`・`elapsed`)・`format`                                                                                      | `DateTime`に、ハイドレーションの後から相対表現(残りの時間・経過した時間)を併記し、1分ごとに更新する |
| `NumberText`   | `value`・`options`(`Intl.NumberFormatOptions`)                                                                                          | ロケールで整形した数値                                                                              |

- 3つの部品は`DisplayPreferencesProvider`の内側で使う(外側では例外)。`AppDocument`がサーバーで推定した表示設定で置き、ハイドレーションの後にブラウザの値と異なればブラウザの値で整形し直す。
- `value`・`target`に時差の無い文字列や不正な`Date`を渡すと、描画中に`RangeError`を投げ、近くのエラーの境界で扱われる。
- `RelativeTime`の相対表現はハイドレーションの後に現れるため、その分だけ配置がずれる。表示中のすべての`RelativeTime`は1つのタイマーで更新する。

### bot判定のウィジェット

`useTurnstileToken`でトークンを管理し、`TurnstileWidget`にその`widgetProps`を渡す。送信の時に`consume()`でトークンを1回だけ取り出し、中継の要求に付ける。

```tsx
const turnstile = useTurnstileToken();

<TurnstileWidget {...turnstile.widgetProps} action="<操作の名前>" />;

const token = turnstile.consume();
```

- `consume()`はトークンを返した後にウィジェットを初期化し、次のトークンを取り直す。期限切れの時もウィジェットを初期化する。トークンが無い時は`undefined`を返す。
- サイトキーとnonceをルーターの文脈から読むため、`RouterProvider`の内側に置く。配色は`useTheme`の配色に従う。
- 読み込みか判定に失敗すると、ウィジェットの下に`role="alert"`の文言を出す。
- スクリプトの読み込みの失敗は、`components/bot-protection/turnstile-script-failure.ts`にページの中で1つ記録し、ページの中のすべてのウィジェットで共有する。`@marsidev/react-turnstile`はスクリプトの要素を加えた最初のウィジェットにしか読み込みの失敗を知らせず、失敗した要素を文書に残して読み込み直さないため、記録が無いと他のウィジェットは読み込みを待ったまま`idle`で止まる。
- 失敗の時に同じページに置いていたウィジェット、失敗の後に置いたウィジェット、描画し直したウィジェットは、読み込みを待たずに失敗の文言を出し(`status`は`'error'`)、ウィジェットの部品を描かない。記録はページの再読み込みまで残り、失敗の文言の「ページを再読み込みして」の案内と合う。サーバーの描画では記録を読まない。
- 判定の失敗(Turnstileの`error-callback`)は失敗したウィジェットだけに出し、他のウィジェットへ広げない。
- テストとカタログは記録を持ち越さないよう、描く前に`resetTurnstileScriptFailure()`で記録を消す(ブラウザテストは各テストの前、ストーリーは`beforeEach`)。テスト用の偽物(`test/fake-turnstile.tsx`)もライブラリと同じく最初のウィジェットにだけ読み込みの失敗を知らせ、`resetFakeTurnstile()`でその状態を消す。
- ウィジェットは非表示(`@marsidev/react-turnstile`独自の`size: 'invisible'`)で描き、入れ物を幅と高さ0にして場所を取らない。サイトキーも非表示の種類のウィジェットのものを使う。置く画面は判定の枠の表示と場所を設けず、ウィジェットの大きさと見た目を考慮しない。幅320pxの横スクロールの検査の対象にもウィジェットは入らない。
- 入れ物は絶対配置で通常の流れから外し、外側の要素を持たない。平常時は通常の流れに要素を出さないため、置く側の`gap`・`space-y`の間隔を消費せず、前後の要素の間は間隔1つ分のままになる。
- 非表示でも、失敗の文言は画面に表示する。失敗時に通常の流れに入るのは文言の要素だけで、置く側の`gap`・`space-y`に従って前後に間隔1つ分ずつを取る。

### 配色の切替

`ThemeToggle`はヘッダーに置く切替のボタンで、`useTheme()`の`setTheme`で`<html>`の`dark`クラスと保存値を変える。

- ボタンは切り替え先を示す名前(ダークへの切替・ライトへの切替)を持ち、`aria-pressed`を持たない。状態で名前を変えるボタンに`aria-pressed`を併せると、矛盾した読み上げになるためである。
- サーバーは配色を知らないため、名前・アイコン・ツールチップは`dark:`のクラスで出し分け、初回描画前のスクリプトが付けたクラスでハイドレーションの前から正しく表示する。
- ツールチップは名前と同じ文言のため、重ねて読み上げられることがある。

### 文書の外枠

`AppDocument`はルートの`shellComponent`(の中のアプリの文書の部品)で使い、次を置く。アプリはこれらを重ねて置かない。

| 中身                                       | 役割                                               |
| ------------------------------------------ | -------------------------------------------------- |
| 初回描画前の配色のスクリプト(`ScriptOnce`) | 保存値かOSの設定の配色を最初の描画より前に反映する |
| `SkipLink`                                 | 本文へ移動するリンク                               |
| `DisplayPreferencesProvider`               | 日時と数値の表示設定                               |
| `TooltipProvider`                          | ツールチップの表示の待ち時間(200ms)                |
| `Toaster`                                  | トースト                                           |
| `RouteAnnouncer`                           | 画面遷移の通知                                     |

- マウントの後に、ブラウザ側のエラートラッキングの初期化と、消えたスクリプトの再読み込みの仕組みを入れる。
- 部品のテストで`AppDocument`を描画する時は、`start/observability/report-error.ts`・`start/observability/browser-observability.ts`を`vi.mock`で差し替える。差し替えないと、サーバー専用の依存(`node:async_hooks`)の読み込みで失敗する。

### 疎通確認

`SystemStatusView`は`initial`(画面を表示した時の結果)・`initialExecutedOn`(その取得を実行した場所、`'server'`または`'browser'`)・`browser`(ブラウザからの再確認の結果、省略可)・`onRecheck`・`rechecking`を受け、自身で`<h1>`と2つの区画を描く。疎通確認のルートは`<h1>`を足さない。

- 画面を表示した時の結果の区画の見出しは`initialExecutedOn`で切り替え、`'server'`なら`SERVER_RESULT_HEADING`、`'browser'`なら`PAGE_LOAD_RESULT_HEADING`(`utilities/messages/system-status-messages.ts`)を出す。区画の中身は実行した場所によらず同じである。
- loaderは同型の関数のため、ページを直接開いた時はサーバーで、画面内の遷移・ルーターの再検証(`router.invalidate()`)・先読みではブラウザで実行される。loaderは`utilities/system/execution-site.ts`の`currentExecutionSite()`(大域に`document`が無ければ`'server'`、あれば`'browser'`)で実行した場所を得て、結果と組にしてloaderのデータで返す。サーバーで得た実行した場所はloaderのデータとしてハイドレーションへ渡るため、ハイドレーションの表示は食い違わない。

## 1ファイル1コンポーネントとshadcn/uiの分割

1つの部品のファイル(`.tsx`)がエクスポートするReactの部品は1つだけにする。同じファイルからは、その部品のpropsの型などの型だけを併せてエクスポートしてよい。

| ファイル                                  | 置くもの                                                                      | 例                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `components/<分類>/<部品>.tsx`            | 部品1つと、そのpropsの型                                                      | `components/state/error-state.tsx`(`ErrorState`・`ErrorStateProps`)                        |
| `components/ui/<部品>/<部分>.tsx`         | shadcn/uiの部品の部分1つ                                                      | `components/ui/dialog/dialog-content.tsx`                                                  |
| `components/ui/<部品>/<部分>-variants.ts` | `class-variance-authority`の見た目の種類(`cva`)と、種類の型                   | `components/ui/button/button-variants.ts`(`buttonVariants`・`ButtonVariant`・`ButtonSize`) |
| `components/<分類>/use-<名前>.ts`         | 部品が使うフックと、その型。文脈(`createContext`)はフックと同じファイルに置く | `components/datetime/use-display-preferences.ts`                                           |
| `components/<分類>/<名前>.ts`             | 部品ではない値(定数・関数)                                                    | `components/app-shell/main-content.ts`、`components/feedback/notify.ts`                    |

- shadcn/uiの部品のコードは1つのファイルに複数の部分(`Dialog`・`DialogContent`・`DialogTitle`など)をエクスポートしている。取り込む時は、部分ごとにケバブケースのファイルへ分け、部分の間の参照は相対パスの直接の読み込みにする(例:`DialogContent`が`DialogPortal`・`DialogOverlay`を読み込む)。
- 見た目の種類(`buttonVariants`など)は部品の値ではないため、部品のファイルから分けて`*-variants.ts`に置く。
- 部品を拡げるpropsは名前付きの`interface`(`ButtonProps`など)で定義する。Radix UIの部分をそのまま包むだけの部品は`ComponentProps<typeof <Radix UIの部分>>`を受ける。
- Radix UIは`radix-ui`パッケージから名前空間で読み込む(`import { Dialog as DialogPrimitive } from 'radix-ui'`)。`asChild`は`Slot.Root`で実現する。
- 取り込む時に、フォーカスの輪郭を消すクラス(`outline-none`・`outline-hidden`など)を取り除き、透明度で作った文字色を`text-muted-foreground`などのトークンに直す(「[コントラスト](004-accessibility-rules.md#コントラスト)」)。画面に見えない名前(「閉じる」など)はサービスの言語にする。各要素の`data-slot`属性は残す。
- この規則は静的解析では検出しない。コードレビューで確かめる。

### 部品を追加するとき

1. 部品のファイルを該当する分類のディレクトリに置き、同じディレクトリにブラウザテスト(`*.browser.test.tsx`)とストーリー(`*.stories.tsx`)を置く。ブラウザテストの内容は「[ブラウザテスト](004-accessibility-rules.md#ブラウザテスト)」に従う。
2. 部品が新しいパッケージを使う時は、共通部品と利用側アプリの`vitest.browser.config.ts`の`optimizeDeps.include`(事前バンドルする依存の一覧)に加える。加えないと、最初の実行の途中で事前バンドルがやり直されてページが再読み込みされ、Reactが2つ読み込まれてフックが失敗する。
3. 共通部品の`bun run test:browser`のカバレッジ(ファイルごとの行と関数)と、カタログの網羅性の検査(下記)を通す。

## カタログの書き方

共通部品は、Storybook(`@storybook/tanstack-react`)のカタログで、すべての部品をライト・ダークと主要な状態ごとに閲覧できるようにする。カタログは共通部品にだけ導入し、利用側アプリには導入しない(利用側アプリの型検査からは`*.stories.tsx`を外す。「[型検査から外すファイル](../coding/001-javascript-typescript-conventions.md#型検査から外すファイル)」)。

```sh
bun run storybook:dev --port <カタログのポート>
bun run storybook:build
```

| ファイル                                | 内容                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.storybook/main.ts`                    | `components/**/*.stories.tsx`を読み、`@storybook/addon-a11y`とTailwind CSSのViteプラグインを使う。bot判定のウィジェットをテスト用の偽物(`test/fake-turnstile.tsx`)に差し替え、外部へ通信しない。利用状況の送信を止める |
| `.storybook/preview.tsx`                | 配色のツールバー(ライト・ダーク、保存しない)、固定の表示設定(タイムゾーンとロケール)、`TooltipProvider`、ルーターの文脈の実行時の値、`@storybook/addon-a11y`の検査をWCAG 2.2のAAのタグに絞る指定                       |
| `config/storybook-catalog.unit.test.ts` | すべての部品がカタログに載っていることの検査                                                                                                                                                                           |

### ストーリー

部品と同じディレクトリに`<部品のファイル名>.stories.tsx`を置く。

```tsx
import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { ErrorState } from './error-state.tsx';

const meta = {
  title: '状態表示/ErrorState',
  component: ErrorState,
  args: {
    message: '一覧を読み込めませんでした。',
    onRetry: fn(),
    contactHref: '/contact',
  },
} satisfies Meta<typeof ErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

- `title`は`<分類>/<部品名>`にする。分類は、基本部品・重ねて表示する部品・フォーム・状態表示・フィードバック・エラーの表示・日時と数値・bot判定・文書の外枠・疎通確認のいずれかにする。
- 主要な状態(既定・無効・エラー・読み込み中・送信中・開いた状態など)ごとにストーリーを分ける。操作で作る状態(検証エラー・送信中など)は`play`で操作する。押した時の処理などの関数のpropsには`fn()`を渡す。
- ライト・ダークはツールバーで切り替えるため、配色ごとのストーリーは作らない。
- 日時の表示は固定の表示設定で描画する。`DisplayPreferencesProvider`はブラウザの値で上書きするため、カタログでは使わず、`preview.tsx`が`DisplayPreferencesContext`へ固定の値を直接渡す。
- ルーターを使う部品(`TurnstileWidget`など)には、`preview.tsx`の`parameters.tanstack.router.context`がルーターの文脈を渡す。
- モーダルなメニューを開いたストーリーは、`parameters: { a11y: { context: '[data-slot="dropdown-menu-content"]' } }`のように検査の範囲を開いたメニューに絞る。開いた元のボタンを`axe-core`が`aria-hidden-focus`と誤って判定するためである。
- ストーリーの文言・URLのサンプルにも、サービスの文言規則とサンプルのドメインの規則を適用する。

### 網羅性の検査

`config/storybook-catalog.unit.test.ts`が、`components/**/*.tsx`の部品のファイル(ストーリーとブラウザテストを除く)ごとに、同じディレクトリのストーリーか`preview.tsx`が直接読み込んでいることを確かめる。他の部品のストーリーの中で描画されるだけでは、載せたことにならない。

| 一覧                  | 対象                                                                    | 書くこと                                         |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `CATALOG_EXCLUSIONS`  | カタログの枠に置けない部品(`AppDocument`・`DisplayPreferencesProvider`) | ファイルと理由                                   |
| `INTERNAL_COMPONENTS` | 親の部品の中でだけ描画される部品(`FormMessage`・`DialogOverlay`など)    | ファイル・描画する親の部品(載っていること)・理由 |

### 静的解析

`eslint-plugin-storybook`の推奨規則がストーリーの書き方を検査する。`storybook/no-uninstalled-addons`はアドオンの宣言を作業ディレクトリの`package.json`から探すため、ルートから起動するコミット時の検査では誤って未導入と判定する。共通部品の`eslint.config.ts`で、`.storybook/main.ts`に対して`packageJsonLocation`に共通部品の`package.json`の絶対パスを渡す。作業ディレクトリに依存する規則を使う時は同じ扱いにする。

## 翻訳への耐性

ブラウザの翻訳で文言が長くなっても、部品と画面シェルが崩れないようにする。

- ボタン・タブ・バッジは固定の幅を持たない。共通部品の`Button`・`TabsTrigger`・`Badge`は`whitespace-nowrap`で、文言に合わせて幅が伸びる。これらに`w-*`の固定の幅を付けない。並べる親は`flex-wrap`などで折り返せるようにする。
- 幅320pxの画面で極端に長くなり得る文言のボタン・バッジには、その箇所で`whitespace-normal h-auto`を付けて折り返させる。
- 翻訳させない語(英語の固有名詞など)には`translate="no"`を付ける。`Button`・`Badge`などは受け取った属性を要素へ渡す(`<Badge translate="no">…</Badge>`)。
- 高さを固定したり、はみ出しを切り捨てたりして文言を収めない。
- 共通部品のブラウザテストは、長い文言で`Button`の幅が伸びて内容が切れないこと(`isContentClipped`)と、`translate="no"`が要素へ渡ることを確かめる。レイアウトを作るアプリは、幅320pxで横スクロールが出ないことをブラウザテストで確かめる。
