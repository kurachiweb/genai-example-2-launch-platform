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

| 置き場所                   | 置くもの                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共通部品の`components/`    | 複数のアプリで同じ見た目と振る舞いを持つ部品。基本部品・フォーム・状態表示・トースト・結果の文言・エラーの表示・日時と数値・金額の表示・bot判定・配色の切替・文書の外枠・疎通確認・マークダウンの表示・検索語の強調・ファイルの選択とアップロードの入力欄・画像の表示とダウンロードのリンク・認証の画面部品(TOTPのQRコード・リカバリコードの一覧・パスワードの入力欄・認証の画面の枠・メールのリンクのフラグメントのトークンの読み取り・無効なリンクの失敗の判定・メールのリンクの確定のボタン)・管理画面の部品(ページの見出し・一覧の表・絞り込み・確認のダイアログ・理由の入力欄・管理者のアバター)・利用者と運営のやり取りの表示部品・パスへの遷移のリンク・文中のリンクの装飾・一覧のページ送り |
| アプリの`src/components/`  | 1つのアプリだけの部品。レイアウト(ヘッダー・ナビゲーション・フッター)、ルーターやアプリの導線を共通部品へ結び付けるページの部品(404・エラーの画面など)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| アプリの`src/composition/` | アプリ固有の値(導線・レイアウトに差し込む区画など)の登録箇所                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- 共通部品は、アプリ固有の値(リンク先・問い合わせの導線・サービス名など)を持たず、propsで受け取る。共通部品から利用側アプリの`src`への読み込みは、静的解析の`frontend/direction/*`(「[画面を持つアプリの静的解析](../coding/001-javascript-typescript-conventions.md#画面を持つアプリの静的解析)」)が禁止する。
- 共通部品の`components/`は、`utilities/`・`start/`の値と、`server/`の型だけを読み込める。サーバー専用のファイル(`*.server.ts`)は読み込めない。
- 2つ目のアプリで同じ部品が必要になった時点で、アプリの部品を共通部品へ移す。アプリ固有の値はpropsに出す。

## 部品の一覧

| ディレクトリ                  | 部品                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 役割                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`              | `Badge`・`Button`・`Calendar`・`Card`(`CardHeader`・`CardTitle`・`CardDescription`・`CardAction`・`CardContent`・`CardFooter`)・`Checkbox`・`Dialog`(`DialogTrigger`・`DialogPortal`・`DialogOverlay`・`DialogContent`・`DialogHeader`・`DialogFooter`・`DialogTitle`・`DialogDescription`・`DialogClose`)・`DropdownMenu`(`DropdownMenuTrigger`・`DropdownMenuPortal`・`DropdownMenuContent`・`DropdownMenuGroup`・`DropdownMenuLabel`・`DropdownMenuItem`・`DropdownMenuCheckboxItem`・`DropdownMenuRadioGroup`・`DropdownMenuRadioItem`・`DropdownMenuSeparator`・`DropdownMenuShortcut`・`DropdownMenuSub`・`DropdownMenuSubTrigger`・`DropdownMenuSubContent`)・`Input`・`Label`・`Popover`(`PopoverTrigger`・`PopoverAnchor`・`PopoverContent`・`PopoverHeader`・`PopoverTitle`・`PopoverDescription`)・`RadioGroup`(`RadioGroupItem`)・`Select`(`SelectTrigger`・`SelectValue`・`SelectContent`・`SelectGroup`・`SelectLabel`・`SelectItem`・`SelectSeparator`・`SelectScrollUpButton`・`SelectScrollDownButton`)・`Sheet`(`SheetTrigger`・`SheetPortal`・`SheetOverlay`・`SheetContent`・`SheetHeader`・`SheetFooter`・`SheetTitle`・`SheetDescription`・`SheetClose`)・`Skeleton`・`Switch`・`Table`(`TableHeader`・`TableBody`・`TableFooter`・`TableRow`・`TableHead`・`TableCell`・`TableCaption`)・`Tabs`(`TabsList`・`TabsTrigger`・`TabsContent`)・`Textarea`・`Tooltip`(`TooltipProvider`・`TooltipTrigger`・`TooltipContent`) | shadcn/uiを基にした基本部品                                                                                                                                                                                                 |
| `components/form/`            | `useAppForm`・`AppForm`・`FormField`・`FormMessage`・`SubmitButton`・`useSubmitHold`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 検証規則をZodで定義するフォーム                                                                                                                                                                                             |
| `components/state/`           | `LoadingSkeleton`・`EmptyState`・`ErrorState`・`PartialErrorState`・`UnavailableNotice`・`RecoverableSlot`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 読み込み中・空・エラー・部分的なエラー・縮退運転中の表示と、登録した部品ごとのエラーの境界                                                                                                                                  |
| `components/feedback/`        | `Toaster`・`notify`・`ResultNotice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 操作の結果を短時間表示するトースト、フォームや確定のボタンに代えて描く結果の文言(フォーカスを移す)                                                                                                                          |
| `components/error/`           | `NotFoundView`・`UnexpectedErrorView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 存在しないページと想定外のエラーの表示                                                                                                                                                                                      |
| `components/datetime/`        | `DateTime`・`RelativeTime`・`NumberText`・`DisplayPreferencesProvider`・`useDisplayPreferences`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 利用者のタイムゾーンとロケールでの日時と数値の表示                                                                                                                                                                          |
| `components/payments/`        | `MoneyText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 最小通貨単位の整数で受け取った金額の、決済の通貨と利用者のロケールでの表示                                                                                                                                                  |
| `components/bot-protection/`  | `TurnstileWidget`・`useTurnstileToken`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | bot判定のウィジェットとトークンの管理                                                                                                                                                                                       |
| `components/theme/`           | `ThemeToggle`・`useTheme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ライト・ダークの配色の切替                                                                                                                                                                                                  |
| `components/app-shell/`       | `AppDocument`・`SkipLink`・`RouteAnnouncer`・`MAIN_CONTENT_ID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `<html>`から描画する文書の外枠                                                                                                                                                                                              |
| `components/markdown/`        | `MarkdownContent`・`CollapsibleMarkdownContent`・`useRenderedMarkdown`・`useMarkdownOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | マークダウンの本文の表示と折りたたみ、描画のメモ化・描画の指定                                                                                                                                                              |
| `components/markdown-editor/` | `MarkdownEditor`・`MarkdownToolbar`・`MarkdownLinkDialog`・`MarkdownLengthCounter`・`EditorPlaceholder`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | マークダウンの入力欄(編集領域は遅延読み込み)                                                                                                                                                                                |
| `components/media/`           | `FileDropZone`・`FileSelectionList`・`FileThumbnail`・`ImageCropDialog`・`encodeCroppedImage`・`ImageUploadField`・`AttachmentUploadField`・`useFileUpload`・`MediaPicture`・`MediaPlaceholder`・`PrivateFileLink`・`useImagesOrigin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | アップロードするファイルの選択と、選んだファイルの一覧、画像の切り取りと作り直し、送信と画像・添付の入力欄、画像の表示とダウンロードのリンク                                                                                |
| `components/auth/`            | `TotpQrCode`・`RecoveryCodeList`・`PasswordInput`・`AuthPageLayout`・`useFragmentToken`・`LinkConfirmation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 多要素認証のQRコードの描画、リカバリコードの一覧とコピー、表示を切り替えられるパスワードの入力欄、認証の画面の題名と枠、メールのリンクのフラグメントのトークンの読み取りとURLからの消去、メールのリンクの確定のボタンと結果 |
| `components/admin/`           | `AdminPageHeader`・`AdminDataTable`・`AdminFilterBar`・`ConfirmActionDialog`・`ReasonField`・`REASON_SCHEMAS`・`AdminAvatar`・`CategoryMasterEditor`・`CategoryFormDialog`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 管理画面のページの見出しと操作、状態とページ送りを持つ一覧の表、絞り込みの入力欄の並び、破壊的な操作の確認と理由の入力、管理者のプロフィール画像、カテゴリのマスタの編集                                                    |
| `components/inquiry/`         | `InquiryStatusBadge`・`InquiryMessageCard`・`InquiryAttachmentList`・`InquirerAvatar`・`InquiryAutoRefreshSwitch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | やり取りの対応の状態と、送信者・本文・添付・送信日時を持つやり取りの1件、添付のダウンロードのリンクの一覧、送信者のプロフィール画像、定期の取り直しの切り替え                                                               |
| `components/navigation/`      | `PathLink`・`INLINE_LINK_CLASS_NAME`・`PageNavigation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 行き先の経路を型で指定できないパスへの、ページを読み込み直さない遷移と現在のページの表示、文中のリンクを色に加えて下線で見分けさせる装飾、一覧の前後のページへのページ送り                                                  |
| `components/search/`          | `HighlightedText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 検索語の一致箇所の`<mark>`による強調                                                                                                                                                                                        |
| `components/system/`          | `SystemStatusView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 疎通確認の画面の本体                                                                                                                                                                                                        |

## 使い方

### 基本部品

| 部品               | 主なprops                                                                                                                                                                                  | 使い方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`           | `variant`(`default`・`destructive`・`outline`・`secondary`・`ghost`・`link`)・`size`(`default`・`xs`・`sm`・`lg`・`icon`・`icon-xs`・`icon-sm`・`icon-lg`)・`asChild`                      | リンクは`<Button asChild><a href="…">…</a></Button>`。アイコンだけのボタンは`aria-label`か画面に見えない文言で名前を付ける                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Badge`            | `variant`(`Button`と同じ6種)・`size`(`default`・`lg`)・`asChild`                                                                                                                           | リンクのバッジは`asChild`で`<a>`を渡す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Calendar`         | `react-day-picker`の`DayPicker`のprops(`mode`・`selected`・`onSelect`・`defaultMonth`・`modifiers`・`components`など)・`unavailableReasonOf`(日を受け取り、選べない日なら理由の文言を返す) | 月ごとのカレンダー。前の月・次の月のボタンと矢印キー・`PageUp`・`PageDown`・`Home`・`End`で移動する。`unavailableReasonOf`が理由を返す日は`aria-disabled`でグレーアウトし、フォーカスできるが選べず、名前に理由を加え、フォーカスとポインターで理由の`Tooltip`を開く。押しても選ばれない日を`DayPicker`の`disabled`で渡すと、フォーカスできず理由も示せないため、理由を示す日は`unavailableReasonOf`で渡す。日のボタンは`buttonVariants`を使わない(`aria-disabled`の間にポインターの操作を止め、理由のツールチップが開かなくなる)。曜日・月・日の名前は既定で日本語の表記になる |
| `Card`             | —                                                                                                                                                                                          | 枠と背景で内容をまとめる面。`CardTitle`は`<div>`のため、見出しにする時は中に見出しの要素(`<h2>`など)を置く。名前の付いた区画として読ませる時は`Card`に`role="region"`と`aria-labelledby`を渡す。`CardAction`は`CardHeader`の中に置き、タイトルと説明の右側の上端に並べる                                                                                                                                                                                                                                                                                                        |
| `Checkbox`         | `checked`・`defaultChecked`・`onCheckedChange`・`disabled`                                                                                                                                 | 要素は`role="checkbox"`の`<button>`。`Label`の`htmlFor`か`FormField`で名前を付け、ラベルの押下とSpaceで切り替わる。既定は未選択。`FormField`の子では値を`checked`、変更を`onCheckedChange`で渡す                                                                                                                                                                                                                                                                                                                                                                                |
| `DialogContent`    | `showCloseButton`(既定は真)・`closeButtonDisabled`(右上の「閉じる」を無効にする。既定は偽)                                                                                                 | 文書の末尾への描画と背景の覆いを含む。`DialogTitle`を必ず置く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SheetContent`     | `side`(`top`・`right`・`bottom`・`left`、既定は`right`)・`showCloseButton`                                                                                                                 | 狭い画面のメニューなど。`SheetTitle`を必ず置く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Popover`          | `modal`                                                                                                                                                                                    | 中で入力を完結させる時は`modal`でフォーカスを閉じ込める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Tooltip`          | —                                                                                                                                                                                          | 内容はトリガーの説明として伝わる。必要な情報をツールチップだけに置かない。`TooltipProvider`は`AppDocument`が置くため、アプリでは置かない                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DropdownMenuItem` | `variant`(`default`・`destructive`)・`inset`                                                                                                                                               | 破壊的な操作は`destructive`にし、文言でも示す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TabsList`         | `variant`(`default`・`line`)                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Switch`           | `size`(`default`・`sm`)                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Select`           | `value`・`defaultValue`・`onValueChange`・`name`・`disabled`                                                                                                                               | 開く要素の`SelectTrigger`は`role="combobox"`の`<button>`。`Label`の`htmlFor`か`aria-label`で名前を付け、`SelectValue`の`placeholder`で未選択の文言を示す。`name`を渡すと、フォームの送信に値が入る                                                                                                                                                                                                                                                                                                                                                                              |
| `SelectTrigger`    | `size`(`default`・`sm`)・`aria-invalid`                                                                                                                                                    | 入力のエラーの間は`aria-invalid`で枠を破壊的な操作の色にする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Table`            | —                                                                                                                                                                                          | `TableCaption`で表の名前を付け、見出しのセルの`TableHead`に`scope`(`col`・`row`)を付ける。親の幅を超える表は包む要素の中で横に移動し、その間だけ包む要素がキャプションの文言を名前とする領域になってTabで止まり、矢印キーで動かせる。行の選択の状態は`TableRow`の`data-state="selected"`で背景に示す                                                                                                                                                                                                                                                                            |
| `Skeleton`         | —                                                                                                                                                                                          | `aria`を持たない。読み込み中の表示は`LoadingSkeleton`で包む                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- アイコンは`lucide-react`から読み込み、`aria-hidden="true"`を付ける。
- `DialogContent`・`SheetContent`・`PopoverContent`・`SelectContent`・`DropdownMenuContent`・`TooltipContent`は文書の末尾へ描画するが、Reactの木では呼び出した場所の子のままである。このため、外側の`<form>`や`AppForm`の中に置いても、中の`<form>`の`submit`が外側へ伝わって外側が送信されないよう、各部品が`components/ui/stop-submit-propagation.ts`の`stopSubmitPropagation`で`submit`の伝播を止める。中に`<form>`を置く側は伝播を止める処理を足さない。文書の末尾へ描画する内容の部品を新しく足す時は、同じ処理を渡す。外側のフォームの送信を、これらの部品の中から起こす使い方はできない。
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

| 部品・関数                              | 引数・props                                                                                       | 振る舞い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAppForm(schema, { defaultValues })` | Zodの規則と、全欄の既定値                                                                         | React Hook Formのフォームを返す。最初にフォーカスを外した時に検証し、以降は入力のたびに検証し直す。文言の無い規則のエラーは、Zodの英語の既定の文言を見せず、共通の既定の文言にする。無効の欄の値は検証の前に除き、残りの欄だけを検証する。渡したスキーマの同一性が変わると、新しいスキーマで検証し直す                                                                                                                                                                                              |
| `AppForm`                               | `form`・`onSubmit`・`onSubmitError`・`serverFieldPrefix`と、`<form>`の属性(`method`・`ref`を除く) | 送信の方法を`post`に固定した`<form>`を描く。水和の前に入力欄へ入った値をフォームの状態に取り込んで検証し直す。検証を通った値で`onSubmit`を呼ぶ。送信中の重ねての送信は1回にまとめる。`useSubmitHold`で値を待たせている欄(送信中のアップロードの入力欄など)がある間は送信せず、その欄に待つ理由を示させる。`onSubmit`が投げたエラーの欄ごとの詳細を欄のエラーにし、最初の欄へフォーカスを移す。欄をまとめた値・無効の欄・描かれていない欄に付く詳細は、欄に対応しない詳細として`onSubmitError`へ渡す |
| `FormField`                             | `control`・`name`・`label`・`description`・`className`・`disabled`と、入力欄を描く関数の子        | ラベル・説明・エラーを入力欄に関連付ける。子の関数が受け取る値(`id`・`aria-invalid`・`aria-describedby`・値・変更と離脱の処理・`ref`、無効の時は`disabled`)を入力欄へ渡す。子の関数はラベルの要素のID(`labelId`)も受け取る。`disabled`が真になると、その欄のエラーを消す。`AppForm`の中でだけ使う                                                                                                                                                                                                   |
| `SubmitButton`                          | `pendingLabel`(既定は送信中を示す文言)・`disabled`と`Button`のprops(`type`・`asChild`を除く)      | `disabled`が真の間か、未入力の必須項目・検証エラー、または欄に付いたエラー(サーバーのエラーと、利用側が`setError`で欄に付けたエラー)が残る間は`disabled`、送信中は`aria-disabled`・`aria-busy`と`pendingLabel`の文言                                                                                                                                                                                                                                                                                |

- `defaultValues`は全欄を指定する。サーバーの詳細は、既定値に経路がある欄にだけ対応させるためである。
- `<form>`の`method`は常に`post`で、propsで変えられない。送信はJavaScriptで行い素の送信を止めるが、JavaScriptが動かない状況で素の送信が起きても、入力(パスワードなど)をGETでURLに載せないためである。
- 遅い回線やブラウザの自動入力で水和の前に入力欄へ入った値は、DOMに残ってもフォームの状態に入らず、送信ボタンが無効のまま残る。`AppForm`は水和の直後に、フォームの中のテキスト系の入力欄(`input`の`text`・`email`・`password`・`search`・`tel`・`url`と`textarea`)の値をフォームの状態と比べ、`FormField`で描いた欄の値が異なれば取り込んで検証し直す。登録されていない名前の欄(bot判定の隠し欄など)と、チェックボックス・ラジオ・ファイルは対象にしない。`FormField`が欄の名前を入力欄の`name`へ渡すため、子の関数が受け取った値は入力欄へそのまま展開する。
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
- `<label for>`で名前を付けられない要素(`contenteditable`の要素など)を描く部品には、子の関数が受け取る`labelId`を渡し、その要素の`aria-labelledby`に使う。`labelId`は入力要素へ展開しても属性として出力されない値で、`{...control}`で写らないため、`control.labelId`で読んで渡す。`<label for>`の関連付けが無いため、ラベルの押下で要素へフォーカスが移らない。部品が`labelId`の要素の押下(`click`)を聞き、要素へフォーカスを移す(ラベルの文字を選択している時と無効の時の押下では移さず、ラベルの外の選択は見ない)。
- 必須の印は自動で付かない。ラベルか説明の文言で示し、入力欄に`aria-required`を渡す。
- 値がまだ決まらない間がある欄(送信中のアップロードの入力欄など)を描く部品は、`components/form/submit-hold.ts`の`useSubmitHold(active, onSubmitHeld)`を呼ぶ。`active`が真の間、囲む`AppForm`は送信を止め(検証も`onSubmit`も行わない)、最も早く待たせ始めた欄の`onSubmitHeld`を呼ぶ。部品は`onSubmitHeld`で待つ理由を欄のエラーとして示し、欄へフォーカスを移す。待たせている間の値は前の値のままのため、送ると変更が保存されないまま成功を示してしまうためである。送信ボタンは`disabled`にせず、押した時に理由を示す(送信ボタンへ待たせている理由を結び付けられないため)。`AppForm`の外では何もせず、送信を止められない。
- フォームの部品は、公開のAPIで置き換えられないReact Hook Formの内部の値(欄ごとの無効の集合、欄の描画の状態、一覧の名前の集合)と、公開されていない振る舞い(名前の配列を渡した検証のエラーの置き換えの範囲、resolverが受け取る値、送信の値から無効の欄を外すこと、購読していないフォームでも触れた状態を記録することなど)に頼る。頼る項目は版の番人テスト(`components/form/form-library-internals.unit.test.ts`)が一覧に持ち、`react-hook-form`・`@hookform/resolvers`の版が確かめた版と異なると失敗する。版を上げる時は「[内部の値に頼るパッケージの版を上げる手順](../coding/002-dependency-versions.md#内部の値に頼るパッケージの版を上げる手順)」に従う。

### 状態表示

| 部品                | props                                                                                                   | 表示                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LoadingSkeleton`   | `label`(既定は読み込み中を示す文言)・`children`(スケルトンの形、省略時は3行)                            | 読み込み中の文言を状態の領域で伝え、スケルトンの形を読み上げから外す                                                                                                                                                                                    |
| `EmptyState`        | `title`・`description`・`action`・`headingLevel`(2〜6)                                                  | 空であることと次の行動への導線。`headingLevel`を指定すると見出し付きの`<section>`になる                                                                                                                                                                 |
| `ErrorState`        | `message`・`onRetry`・`contactHref`(省略可)                                                             | ページや区画の読み込みの失敗。再試行のボタンと問い合わせのリンク。`contactHref`を省略すると問い合わせのリンクを描かない。技術的な詳細を`message`に入れない                                                                                              |
| `PartialErrorState` | `message`・`onRetry`                                                                                    | ページの一部の区画の失敗。ページ全体の表示を保ったまま、その区画に再試行のボタンを出す                                                                                                                                                                  |
| `UnavailableNotice` | `reason`                                                                                                | 縮退運転中。利用できないことを示す題と理由                                                                                                                                                                                                              |
| `RecoverableSlot`   | `frame`(省略可)・`fallback`(省略可)・`className`・`contactAvailable`・`contactHref`(省略可)・`children` | 登録口に登録された部品ごとのエラーの境界(`CatchBoundary`と`QueryErrorResetBoundary`)と`Suspense`。1つの部品の描画や取得の失敗をその位置に`ErrorState`で留め、他の部品の表示を続ける。境界が捕まえた失敗の送信と、再試行の後のフォーカスの移動を受け持つ |

- 導線(`contactHref`・`EmptyState`の`action`の中のリンク)は通常の`<a href>`で描画し、クライアント側の遷移を行わない。
- 問い合わせの画面を持たないアプリ(プロファイルの`contactAvailable`が偽)は、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さない。`contactAvailable`が真のアプリだけが渡す。
- `ErrorState`・`PartialErrorState`の`message`は`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。`GraphQLClientError`でない例外では、問い合わせの導線が無いアプリに問い合わせを促す文を出さない(「[エラーの扱い](006-data-fetching.md#エラーの型と画面の分岐)」)。
- `RecoverableSlot`は、登録口(各機能が部品を1件ずつ追記する一覧)の部品を並べるページが、部品ごとに包む(「[登録口に登録された区画の取得](006-data-fetching.md#登録口に登録された区画の取得)」)。`contactAvailable`には`<プロファイル>.contactAvailable`を渡し、失敗の文言は`errorMessageOf(error, contactAvailable)`で選ぶ。`contactHref`は`ErrorState`へそのまま渡すため、`contactAvailable`が真のアプリだけが渡す。
- `RecoverableSlot`の`frame`は、読み込み中(`LoadingSkeleton`)と失敗(`ErrorState`)の表示を包む関数で、部品が自分で描く見出しを部品が描けない間だけ補うために使う。部品が描けた後は`frame`を通さない。
- `RecoverableSlot`の`fallback`は、読み込み中に`frame`の中へ出す表示で、省略すると`LoadingSkeleton`を出す。区画の形に合わせたスケルトンは`fallback`で渡し、`children`の内側に別の`Suspense`を置かない。内側の`Suspense`が読み込み中を受け持つと、再試行の後のフォーカスを内容の描画まで保つ仕組みが働かず、フォーカスが`<body>`へ落ちる。
- `RecoverableSlot`の再試行は、取得の失敗の記録とエラーの境界の両方を解除して描き直す。再試行の後のフォーカスは、描き直した表示の最初の見出しへ移し、見出しが無ければ描いた部品の外側の要素・新しい再試行のボタン・読み込み中の位置へ移す(「[処理の後のフォーカス](004-accessibility-rules.md#処理の後のフォーカス)」)。取得を待つ間に利用者が枠の外へ移したフォーカスは奪い返さない。
- 境界が捕まえた失敗はルーターの`defaultOnCatch`へ届かないため、`RecoverableSlot`が`reportUnexpectedErrorInBrowser`でエラートラッキングへ送る。`GraphQLClientError`は取得の補助が送っているため送り直さない(「[送信の入口](007-frontend-observability.md#送信の入口)」)。

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

### 結果の文言

`ResultNotice`は、確定のボタンやフォームに代えて描く操作の結果の文言である。メールのリンクの確定・パスワードの再設定・送信の後の案内のように、押したボタンが描かれなくなる結果に使う。

```tsx
import { ResultNotice } from '<共通部品の配置先>/components/feedback/result-notice.tsx';
import { INLINE_LINK_CLASS_NAME } from '<共通部品の配置先>/components/navigation/inline-link-class.ts';

<ResultNotice tone="success" message="パスワードを再設定しました。">
  <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
    ログイン画面へ
  </Link>
</ResultNotice>;
```

| props      | 振る舞い                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| `tone`     | `success`は`role="status"`と成功のアイコン、`error`は`role="alert"`と警告のアイコンで描く |
| `message`  | 結果の文言。アイコンと並べて太字で描く                                                    |
| `children` | 省略可。文言の下に置く導線や補足(次の画面へのリンク・やり直しの案内など)                  |

- 描いた時に自分(`tabIndex={-1}`)へフォーカスを移す。押したボタンとともに失われるフォーカスを結果の文言へ移し、キーボードの操作の起点と読み上げを保つためである(「[処理の後のフォーカス](004-accessibility-rules.md#処理の後のフォーカス)」)。
- 操作の途中で入力を続けられる失敗は`ResultNotice`にせず、フォームの`FormMessage`(`role="alert"`)で示す。

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

### 金額の表示

| 部品        | props                                                                           | 表示                                                           |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `MoneyText` | `amount`(最小通貨単位の整数)・`signDisplay`(`auto`・`exceptZero`。既定は`auto`) | 最小通貨単位を主単位に直し、決済の通貨とロケールで整形した金額 |

- 通貨と、主単位あたりの最小通貨単位の数は、共用部品の`payments/money.ts`の定数を使う。`MoneyText`は最小通貨単位から主単位への変換だけを受け持ち、整形は`NumberText`に`Intl.NumberFormatOptions`(`style: currency`)を渡して行う。そのため`NumberText`と同じく`DisplayPreferencesProvider`の内側で使う。
- 負の金額には常に負の符号が付く。返金のように増減を示す一覧では`signDisplay`を`exceptZero`にし、正の金額にも正の符号を付ける。
- 税込などの金額の条件は部品に含めず、画面の文言で示す。

### bot判定のウィジェット

`useTurnstileToken`でトークンを管理し、`TurnstileWidget`にその`widgetProps`を渡す。フォームの送信は`sendWithTurnstile`(`utilities/bot-protection/send-with-turnstile.ts`)で行い、取り出したトークンを中継の要求に付ける。

```tsx
import { sendWithTurnstile } from '<共通部品の配置先>/utilities/bot-protection/send-with-turnstile.ts';

const turnstile = useTurnstileToken();

<TurnstileWidget {...turnstile.widgetProps} action="<操作の名前>" />;

await sendWithTurnstile(turnstile, (turnstileToken) =>
  mutation.mutateAsync({ variables, turnstileToken }),
);
```

- `consume()`はトークンを返した後にウィジェットを初期化し、次のトークンを取り直す。期限切れの時もウィジェットを初期化する。トークンが無い時は`undefined`を返す。
- `waitForToken()`は、受け取り済みのトークンがあれば`consume()`と同じく取り出し、無ければ次のトークンが届くまで待って取り出す。上限の時間(`TOKEN_WAIT_TIMEOUT_MS`)を過ぎた時、待っている間に期限切れ・判定の失敗・スクリプトの読み込みの失敗が起きた時、部品が外れた時は`undefined`で解く。判定に失敗した後は待たずに`undefined`を返す。待ちが複数あれば届いた順に1つずつ渡し、同じトークンを2回返さない。
- 非表示のウィジェットは、画面を開いた後と`consume()`の後にトークンを取り直すため、その間に送るとトークンが無くbot判定に失敗する。`sendWithTurnstile`は`consume()`のトークンで送り、bot判定の失敗(`GraphQLClientError`の`code`が`bot_verification_failed`)の時だけ`waitForToken()`のトークンで1回だけ送り直す。他の失敗(CSRFの拒否など)と送り直しの失敗はそのまま投げ、トークンが得られなければ最初の失敗を投げる。待つ間は送信中の表示が続く。
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

### パスへの遷移

`PathLink`は、行き先の経路を型で指定できないパス(他の機能が作る経路、登録箇所に文字列で並べた項目、組み立て済みのクエリを持つURL)へ、ページを読み込み直さずにルーターで遷移するリンクである。`RouterProvider`の内側で使う。

```tsx
import { PathLink } from '<共通部品の配置先>/components/navigation/path-link.tsx';

<PathLink href="/settings/account">アカウント</PathLink>;
<PathLink href="/" activeOptions={{ exact: true, includeSearch: false }}>
  トップ
</PathLink>;
```

| props           | 振る舞い                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `href`          | 行き先のパス。クエリを含めてよい                                                                                                    |
| `activeOptions` | 現在のページの判定(TanStack Routerの`ActiveOptions`)。既定は同じパスとその下のパスで現在のページとし、`aria-current="page"`を付ける |

- 経路が型で指定できるようになったら、型付きの`Link`へ置き換える。登録箇所の項目のように行き先が常に文字列の導線は`PathLink`のまま使う。
- トップページ(`/`)へのリンクは全ページのパスの先頭に一致するため、メニューで現在のページを示す時は`activeOptions`の`exact`を真にする。クエリの違いで現在のページの表示を変えない時は`includeSearch`を偽にする。
- 文中のリンク(案内の文の中の「パスワードの再設定」など)には、`Link`・`PathLink`・`<a>`の`className`に`INLINE_LINK_CLASS_NAME`(`components/navigation/inline-link-class.ts`)を渡す。主の色に加えて常に下線を引き、色だけに頼らず周りの文と見分けられるようにする(1.4.1)。ボタンの見た目のリンクやメニューの項目には使わない。

### ページ送り

`PageNavigation`は、カーソルで区切る一覧の「前へ」「次へ」のボタンを、名前付きの`<nav>`に並べる。前後のページの位置は`utilities/pagination/cursor-trail.ts`で求める(「[失敗を画面の中で表示する取得](006-data-fetching.md#失敗を画面の中で表示する取得)」)。

```tsx
import { PageNavigation } from '<共通部品の配置先>/components/navigation/page-navigation.tsx';

<PageNavigation
  label="送ったメッセージのページ送り"
  hasPrevious={previous.exists}
  hasNext={nextCursor !== null}
  settled={items !== undefined}
  onPrevious={() => showPage(previous.after)}
  onNext={() => showPage(nextCursor)}
/>;
```

| props                    | 振る舞い                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `label`                  | `<nav>`の名前。1つのページに複数の`<nav>`があるため、一覧の名前を含めて区別する      |
| `hasPrevious`・`hasNext` | 前・次のページの有無。無い側のボタンを押せなくする                                   |
| `settled`                | 一覧を表示している間は真。読み込み中とエラーの間は偽にし、両方のボタンを押せなくする |
| `onPrevious`・`onNext`   | 押せる間だけ呼ぶ                                                                     |

- 押せないボタンは`disabled`にせず`aria-disabled`にし、描いたまま残す。押した直後に最後のページや次のページの読み込み中へ変わっても、フォーカスがボタンに残る(「[操作できない状態](004-accessibility-rules.md#操作できない状態)」)。
- 管理画面の一覧の表(`AdminDataTable`)は、`pagination`を渡すとこの部品を表の下に描く。
- 1ページだけと分かった一覧(1ページ目で次のページが無い)では、押せないボタンだけの`<nav>`を描かなくてよい。読み込み中は描いたままにし、押したボタンからフォーカスを`<body>`へ落とさない。

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
- 部品のテストで`AppDocument`を描画する時は、`start/observability/browser-observability.ts`を`vi.mock`で差し替える。差し替えないと、TanStack Startのパッケージの入口が読み込むサーバー専用の依存(`node:async_hooks`)で失敗する。送信待ちの列は、サーバー専用の依存を持たない`start/observability/browser-error-reporting.ts`から読み込むため差し替えない(「[送信の入口](007-frontend-observability.md#送信の入口)」)。

### 疎通確認

`SystemStatusView`は`initial`(画面を表示した時の結果)・`initialExecutedOn`(その取得を実行した場所、`'server'`または`'browser'`)・`browser`(ブラウザからの再確認の結果、省略可)・`onRecheck`・`rechecking`を受け、自身で`<h1>`と2つの区画を描く。疎通確認のルートは`<h1>`を足さない。

- 画面を表示した時の結果の区画の見出しは`initialExecutedOn`で切り替え、`'server'`なら`SERVER_RESULT_HEADING`、`'browser'`なら`PAGE_LOAD_RESULT_HEADING`(`utilities/messages/system-status-messages.ts`)を出す。区画の中身は実行した場所によらず同じである。
- loaderは同型の関数のため、ページを直接開いた時はサーバーで、画面内の遷移・ルーターの再検証(`router.invalidate()`)・先読みではブラウザで実行される。loaderは`utilities/system/execution-site.ts`の`currentExecutionSite()`(大域に`document`が無ければ`'server'`、あれば`'browser'`)で実行した場所を得て、結果と組にしてloaderのデータで返す。サーバーで得た実行した場所はloaderのデータとしてハイドレーションへ渡るため、ハイドレーションの表示は食い違わない。

### マークダウンの表示

マークダウンの本文は、共用部品の描画部品(`renderMarkdown`)の結果を`MarkdownContent`へ渡して表示し、高さを抑える時は`CollapsibleMarkdownContent`を使う。`MarkdownContent`は、サニタイズ済みの型の値だけを受け取り、生のHTMLを挿入する唯一の部品である。描画の指定・折りたたみ・目次の作り方は「[マークダウンの入力欄と表示部品](008-markdown-editor-and-content.md#表示部品)」に、サニタイズの規約は「[マークダウンのサニタイズ](../security/004-markdown-sanitization.md)」に従う。

### マークダウンの入力欄

フォームでマークダウンを入力させる時は、`MarkdownEditor`を`AppForm`の中の`FormField`の子として描く。フォームとの結合と検証規則、値の受け渡しとカウンター、編集領域の遅延読み込みと読み込みの制限、ツールバーとリンクのダイアログ、アクセシビリティの規約は「[マークダウンの入力欄と表示部品](008-markdown-editor-and-content.md#入力欄)」に従う。

### 検索語の強調

検索結果の項目の見出しや要約のうち検索語に一致した箇所は、`HighlightedText`で`<mark>`の強調にする。使い方は「[検索語の強調](008-markdown-editor-and-content.md#検索語の強調)」に従う。

### ファイルの選択

アップロードするファイルは`FileDropZone`で選ばせ、選んだファイルを`FileSelectionList`で示す。どちらも検査と送信を行わず、選んだファイルの検査・拒否の文言・送信は呼び出し側の入力欄が行う。

```tsx
import { useState } from 'react';

import { FileDropZone } from '<共通部品の配置先>/components/media/file-drop-zone.tsx';
import { FileSelectionList } from '<共通部品の配置先>/components/media/file-selection-list.tsx';

function LogoPicker() {
  const [files, setFiles] = useState<readonly File[]>([]);
  return (
    <>
      <FileDropZone
        label="画像を選択"
        accept={['image/jpeg', 'image/png', 'image/svg+xml']}
        onSelect={setFiles}
      />
      <FileSelectionList items={files.map((file) => ({ file }))} />
    </>
  );
}
```

- `FileDropZone`は、ボタンのクリック・Enter・Spaceで端末標準のファイル選択の画面を開き、ファイルのドラッグ&ドロップでも選べる。ドラッグ中は枠と案内の文言を変える。隠した`<input type="file">`の`accept`属性は、propsの`accept`に渡した形式の一覧になり、`capture`を付けないため、モバイル端末ではカメラでの撮影と端末内のファイルを利用者が選べる。
- 選んだ後は入力欄の値を空に戻し、拒否された同じファイルを選び直せるようにする。`multiple`が偽でも、ドロップした複数のファイルはそのまま`onSelect`へ渡すため、個数の検査は呼び出し側が行う。
- `pending`が真の間(送信中など)は、ボタンを`aria-disabled`・`aria-busy`にし、押しても選択の画面を開かず、ドロップも受け付けない。`disabled`にするとフォーカスのあるボタンからフォーカスが外れるため、処理中は`pending`を使う(「[操作できない状態](004-accessibility-rules.md#操作できない状態)」)。
- `ref`は選択のボタンの要素を受け取る。閉じたダイアログのフォーカスの戻り先(`returnFocusRef`)や、`FormField`の`control.ref`に使う。
- `FormField`の欄に置くときは、`id`を渡さず(`<label for>`で関連付けず)、子へ渡る`labelId`を`aria-labelledby`に、`aria-describedby`・`aria-invalid`をそのまま渡す。ボタンは`aria-labelledby`に欄のラベルとボタンの見えている文言の両方を指定し、名前を「<欄のラベル> <ボタンの文言>」にする。`<label for>`で関連付けると欄のラベルだけが名前になり、見えている文言を言う音声操作でボタンに届かない(2.5.3)。

```tsx
<FormField control={form.control} name="logo" label="ロゴ">
  {(control) => (
    <FileDropZone
      label="画像を選択"
      accept={['image/jpeg', 'image/png', 'image/svg+xml']}
      onSelect={handleSelect}
      aria-labelledby={control.labelId}
      aria-describedby={control['aria-describedby']}
      aria-invalid={control['aria-invalid']}
    />
  )}
</FormField>
```

- `FileSelectionList`は名前・形式・サイズ(1,024を基数とするkB・MB)とサムネイルを並べ、項目ごとの状態の文言(`status`)を添えられる。選んだファイルが変わった時だけ、ファイル名と件数を`aria-live="polite"`の見えない領域で読み上げ、最初の表示では読み上げない。読み上げの領域を最初から置いておくため、ファイルが0件でも描画したままにする。
- `FileThumbnail`は画像を、読み込んだ時点の1コマだけを`canvas`へ描いた静止画にし、描いた後にオブジェクトURLを破棄する。GIFなどのアニメーションを動かし続けない(「[演出の停止手段の義務](004-accessibility-rules.md#演出の停止手段の義務)」)。画像でないファイルはアイコンにする。

#### 画像の切り取り

SVG以外の画像は、送る前に`ImageCropDialog`で切り取る範囲と拡大率を選ばせ、確定した範囲を最大寸法以下へ縮小して作り直したファイルを受け取る。ダイアログは`file`を渡している間だけ開き、`onConfirm`か`onCancel`で呼び出し側が`file`を外して閉じる。

```tsx
import { useRef, useState } from 'react';

import { ImageCropDialog } from '<共通部品の配置先>/components/media/image-crop-dialog.tsx';

function LogoEditor() {
  const [editing, setEditing] = useState<File>();
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <ImageCropDialog
      file={editing}
      edit={{ aspect: 1, maxLongSide: 512 }}
      returnFocusRef={selectButtonRef}
      onConfirm={(file) => {
        setEditing(undefined);
        // 作り直したファイルのサイズを確かめて送る
      }}
      onCancel={() => {
        setEditing(undefined);
      }}
    />
  );
}
```

- `edit`の`aspect`は切り取る縦横比(正方形は`1`)で、`'free'`は原本の縦横比のまま切り取る。`maxLongSide`は作り直す画像の長辺の上限、`cropShape: 'round'`は範囲を円で示す(作り直す画像は四角形のまま)。
- 画像はドラッグ・ホイール・2本指の操作のほか、範囲にフォーカスして矢印キー(Shiftで細かく)、移動のボタン(上下左右)、拡大率のスライダーと拡大・縮小のボタンで動かせる。ドラッグの操作には、ドラッグしない単一のポインターの代わりの操作を必ず用意する(2.5.7)。
- 確定すると`encodeCroppedImage(file, area, maxLongSide)`が、Exifの向きを反映した画素(`createImageBitmap`の`imageOrientation: 'from-image'`)から範囲を切り取り、原本がJPEGならJPEG(品質0.9)、それ以外ならPNGに作り直す。ファイル名の拡張子は出力の形式に合わせる。作り直した画像は向きの情報を含まない。
- 閉じるとフォーカスを`returnFocusRef`の要素(選択のボタン)へ戻す。省略すると、開いた時にフォーカスのあった要素へ戻す。ドラッグ&ドロップで選ぶとフォーカスが選択のボタンに無いため、選択のボタンを渡す。
- 開いたまま別のファイルを渡すと、そのファイルで編集を始め直す(複数の画像を1枚ずつ編集する場合)。作り直している間に取り消すか別のファイルへ替えた結果は`onConfirm`へ渡さない。
- 開く時の拡大の動きが終わり、画像を読み込んでから編集の領域を置く(動きの途中の縮んだ寸法で範囲を決めないため)。読み込めない画像は`role="alert"`で伝え、確定させない。
- 画像を読み込んで確定できるようになるまで、取り消し(「キャンセル」・右上の「閉じる」・Escape・ダイアログの外の操作)を受け付けない。読み込みの前に届いた押下が、同じ位置にすぐ描かれる次の画像まで取り消さないためで、1枚だけの編集と最初の画像も同じにする。読み込めない画像は取り消せ、ダイアログに閉じ込めない。
- 押し続けたEscapeのキーの繰り返し(`KeyboardEvent.repeat`が真)は、読み込んだ後でも取り消しにしない。受け付けない時間の下限は無いため、ダブルクリックの2回目は、次の画像の読み込みが終わっていれば次の画像を取り消し得る(既知の制限)。
- 受け付けない間の「キャンセル」と右上の「閉じる」は確定と同じく`disabled`にする(「[操作できない状態](004-accessibility-rules.md#操作できない状態)」の条件を満たすまで押せない状態)。フォーカスのある右上の「閉じる」の無効化や、受け付けなかった外の押下は、フォーカスを`<body>`へ落とし、Radix UIは要素の取り除きの時と違って戻さない。受け付けない間にフォーカスが`<body>`へ落ちた時だけダイアログへ戻す(ウィンドウの切り替えでは戻さない)。読み込みの途中に開いた時は、押せる操作が無いためフォーカスはダイアログそのものに置かれる。

### 画像の表示

アップロードした画像は`MediaPicture`で表示する。呼び出し側は画像の値(`MediaImageView`)と表示サイズを渡すだけで、配信のURLを組み立てない。画像配信のオリジンは、`useImagesOrigin`がルーターの文脈の公開の設定(`publicConfig.imagesOrigin`)から読む。Providerは無く、ルートの設定を変えずに使える。

```tsx
import { MediaPicture } from '<共通部品の配置先>/components/media/media-picture.tsx';

<MediaPicture
  image={product.logo}
  display={{ kind: 'square', size: 64 }}
  alt={`${product.name}のロゴ`}
  placeholder={{ label: product.name, seed: product.id }}
  loading="lazy"
  className="rounded-lg"
/>;
```

| props         | 内容                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`       | 画像の値。GraphQLの操作の結果(オブジェクトキー・大文字のフォールバックの形式・原本の幅と高さ)をそのまま渡す。`null`は未設定                       |
| `display`     | 正方形の表示サイズ(`{ kind: 'square', size: 32 \| 64 \| 128 }`)か、スクリーンショットの表示(`{ kind: 'screenshot', variant: 'thumb' \| 'full' }`) |
| `alt`         | 代替テキスト。飾りの画像(隣に名前を書いた画像など)は空文字にする                                                                                  |
| `placeholder` | プレースホルダーの先頭1文字を取る名前(`label`)と、配色を決めるID(`seed`)                                                                          |
| `loading`     | 画面外の画像は`'lazy'`にする。省略すると読み込みの方法を指定しない                                                                                |
| `className`   | `<img>`とプレースホルダーに付けるクラス名(角丸・幅など)                                                                                           |

- SVG以外の画像は`<picture>`で、AVIF(提供するバリアントだけ)・WebPの順の`<source>`と、原本の形式に合わせたJPEGかPNGの`<img>`を出す。1x・2xのバリアントを`srcset`で並べる。SVGは`<picture>`を使わず`<img>`だけで表示する(`<object>`・`<iframe>`・インライン展開で表示しない)。
- `<img>`の`width`・`height`は1xのバリアントの表示サイズで、スクリーンショットは原本の幅と高さの縦横比から求める。画像を表示できないときのプレースホルダーも同じ寸法(幅と縦横比)で描き、レイアウトをずらさない。
- 画像が`null`・オブジェクトキーが`null`(隔離中など)・読み込みの失敗のときは、プレースホルダーを表示する。正方形は名前の先頭1文字(書記素)を配色のトークン(`--placeholder-1`〜と`-foreground`)の組で描き、スクリーンショットは`bg-muted`の背景に表示できないことを示す文を重ねる。サーバー側で描画した画像がハイドレーションの前に読み込みに失敗した場合も、結び付けた時点の状態から失敗を見つけて切り替える。
- プレースホルダーは`role="img"`で、正方形は`alt`を、スクリーンショットは`alt`に表示できないことを添えた文言を名前にする。`alt`が空ならプレースホルダーも支援技術に読ませない。
- 呼び出し側のクラス名で`<img>`の大きさを変える場合(`w-full`・`size-8`など)は、プレースホルダーも同じクラス名で同じ大きさになる。
- 画像配信のオリジンは、CSPの`img-src`に環境の値として加わっている(「[許可先の登録](003-frontend-server-security.md#許可先の登録)」)。
- テストとカタログは、ルーターの文脈の公開の設定でオリジンを与える。`<source>`・`srcset`・寸法は、画像を読み込まないサーバー側の描画の結果(`renderToString`を`DOMParser`で読んだ文書)で確かめる。読み込みの成功は、`test/served-media-images.ts`の`serveMediaImages`が画像配信と同じパスの形でテストの開発サーバーから配信する画像(Git管理外の`.vitest-attachments`に書き出す)で確かめ、クライアントの描画とハイドレーションの後に画像のまま残ることを見る。読み込みの失敗は、配信の経路を持たないテストの配信元へ要求させて確かめる。

### ダウンロードのリンク

非公開のファイル(問い合わせの添付など)は`PrivateFileLink`でダウンロードのリンクにする。リンク先は共通のダウンロードの中継の経路(`downloadPathOf(fileId)`)で、識別子を経路の1区画として符号化する。

```tsx
import { PrivateFileLink } from '<共通部品の配置先>/components/media/private-file-link.tsx';

<PrivateFileLink
  fileId={attachment.fileId}
  fileName={attachment.fileName}
  byteSize={attachment.byteSize}
/>;
```

- リンクの文言はファイル名とサイズ(`formatFileSize`のkB・MB)である。長いファイル名は枠の中で折り返す。
- `download`属性と`target`を付けない。保存のファイル名とインライン表示の禁止は、サーバーの`Content-Disposition: attachment`に任せる。

### 認証の画面部品

多要素認証(TOTP)の設定・パスワードの入力・認証の画面の枠・メールのリンクのトークンの読み取りに使う部品を`components/auth/`に置く。画面を持つ各アプリの認証の画面が同じ部品を使う。

```tsx
import { PasswordInput } from '<共通部品の配置先>/components/auth/password-input.tsx';
import { RecoveryCodeList } from '<共通部品の配置先>/components/auth/recovery-code-list.tsx';
import { TotpQrCode } from '<共通部品の配置先>/components/auth/totp-qr-code.tsx';

<TotpQrCode uri={setup.otpauthUri} label="認証アプリで読み取るQRコード" />;

<RecoveryCodeList codes={recoveryCodes} />;

<FormField control={form.control} name="password" label="パスワード">
  {(control) => <PasswordInput {...control} autoComplete="current-password" />}
</FormField>;
```

| 部品               | props                                                                                   | 振る舞い                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TotpQrCode`       | `uri`(`otpauth://`のURI)・`label`(代替テキスト)・`className`                            | `uqr`の`encode`で作ったセルの行列を、`role="img"`と`aria-label`を持つSVGの`<rect>`と`<path>`で描く。生のHTMLを挿入しない。四辺に規格どおり4セルの余白を取る。配色によらず白い地に黒いセルで描く(トークン`qr-code`・`qr-code-background`)。既定の大きさは`size-48` |
| `RecoveryCodeList` | `codes`(表示の形のコード)・`className`                                                  | 名前「リカバリコード」の一覧に等幅の字形で並べ(`translate="no"`)、「すべてコピー」で1行1件の文字列をクリップボードへ書き込む。成功は`role="status"`の文言、失敗(APIが無い・拒否された)は代わりの手段を示す`role="alert"`の文言で伝える。保管の注意を常に表示する  |
| `PasswordInput`    | `autoComplete`(必須。`current-password`・`new-password`)と`<input>`の属性(`type`を除く) | `type="password"`の入力欄と、表示を切り替えるボタン(名前は固定で、状態は`aria-pressed`、`aria-controls`で入力欄を指す)。`FormField`の子の関数が受け取る値をそのまま展開できる。`disabled`の間は切り替えのボタンも無効にする                                       |

- `autoComplete`は、ログインと本人確認では`current-password`、登録とパスワードの変更・再設定では`new-password`を渡す。パスワード管理ツールが保存と提案を正しく行うためである。
- TOTPの手入力用の文字列(秘密鍵)は`TotpQrCode`に含まれないため、呼び出す側がQRコードと並べて表示する。
- `RecoveryCodeList`は、渡すコードが変わると(再発行など)前のコピーの結果の表示を消す。コピーの結果はトーストにせず部品の中に示す。

認証の画面(ログイン・パスワードの再設定・メールのリンクの確定など)の経路の部品は、題名と枠を`AuthPageLayout`で描き、メールのリンクのトークンを`useFragmentToken`で読む。

```tsx
import { AuthPageLayout } from '<共通部品の配置先>/components/auth/auth-page-layout.tsx';
import { useFragmentToken } from '<共通部品の配置先>/components/auth/use-fragment-token.ts';
import { isInvalidLinkError } from '<共通部品の配置先>/utilities/auth/invalid-link.ts';

<AuthPageLayout title="新しいパスワードの設定">
  <NewPasswordForm />
</AuthPageLayout>;

function NewPasswordForm() {
  const link = useFragmentToken();
  if (link.status === 'reading') {
    return null;
  }
  if (link.status === 'missing') {
    return (
      <ResultNotice
        tone="error"
        message="このリンクは無効か、有効期限が切れています。"
      />
    );
  }
  // 送信の時にlink.tokenを足して送る。失敗がisInvalidLinkError(error)なら無効なリンクの表示へ切り替える
}
```

| 部品・関数           | 引数・props                  | 振る舞い                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthPageLayout`     | `title`・`children`          | `title`を`<h1>`にし、その見出しを名前にした`<section>`の中で、本文を幅を絞った枠に入れて描く。ページの見出しを持つため、経路の部品は別に`<h1>`を描かない                                                                                                                                                                        |
| `useFragmentToken`   | なし(`RouterProvider`の内側) | URLのフラグメントの`token=<値>`を`readFragmentToken`で読み、`{ status: 'reading' }`(サーバーの描画とハイドレーションの間)・`{ status: 'found', token }`・`{ status: 'missing' }`を返す。最初の描画で読んだトークンを保ち、描いた後に`history.replace`で同じ履歴の項目からフラグメントだけを消す(パス・クエリ・履歴の状態は残す) |
| `isInvalidLinkError` | `error`(`unknown`)           | GraphQLの失敗が`invalid_link`か、トークンの欄(引数の`token`・入力の型の`input.token`)への入力の検証の失敗(`validation_error`)なら真を返す                                                                                                                                                                                       |

- `reading`の間はフォームも無効なリンクの表示も描かない。フラグメントはサーバーへ送られずサーバーの描画では読めないため、描画の結果をハイドレーションと食い違わせないためである。
- トークンはフォームのスキーマの入力に含めず、送信の時(`onSubmit`)に足して送る。メールのリンクの画面は開いただけでは送信せず、利用者の操作で確定する。
- トークンがフラグメントに無い時と`isInvalidLinkError`が真の時は、同じ無効なリンクの表示(`ResultNotice`の`error`と、手続きのやり直しへの導線)にする。

ボタンを押すだけで確定するメールのリンクの画面(メールアドレスの変更の確定など)は、入力欄を持たないため`LinkConfirmation`で組み立てる。トークンの読み取り・無効なリンクの表示・確定の失敗の表示を部品が行う。

```tsx
import { LinkConfirmation } from '<共通部品の配置先>/components/auth/link-confirmation.tsx';

<LinkConfirmation
  description="ボタンを押すと、メールアドレスの変更が完了します。"
  actionLabel="メールアドレスの変更を確定する"
  confirm={async (token) => {
    const { confirmEmailChange } = await confirm.mutateAsync({
      variables: { token },
    });
    return confirmEmailChange.viewer !== null;
  }}
  renderSuccess={(signedIn) => <ChangedNotice signedIn={signedIn} />}
  invalidLinkMessage="このリンクは無効か、有効期限が切れています。"
  invalidLinkGuide={<RetryGuide />}
  failureMessageOf={(error) =>
    errorMessageOf(error, APP_PROFILE.contactAvailable)
  }
/>;
```

| props                | 振る舞い                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`        | 確定のボタンの前に置く説明。確定で起きること(他の端末のログアウトなど)を書く                                                                                                                                        |
| `actionLabel`        | 確定のボタンの文言                                                                                                                                                                                                  |
| `confirm`            | ボタンを押した時に、フラグメントのトークンを受け取って確定する関数。返した値を`renderSuccess`へ渡す。確定の間はボタンを`aria-busy`・`aria-disabled`にし、重ねた押下を無視する                                       |
| `renderSuccess`      | 確定の結果を受け取り、ボタンに代えて描く結果(`ResultNotice`の`success`など)を返す                                                                                                                                   |
| `invalidLinkMessage` | トークンがフラグメントに無い時と`isInvalidLinkError`が真の時に、ボタンに代えて描く`ResultNotice`の`error`の文言                                                                                                     |
| `invalidLinkGuide`   | 無効なリンクの文言の下に置く、手続きのやり直しへの導線                                                                                                                                                              |
| `failureMessageOf`   | リンクと関係の無い確定の失敗の文言を選ぶ関数。部品はアプリのプロファイルを読まないため、呼び出す側が`errorMessageOf(error, APP_PROFILE.contactAvailable)`で選ぶ。文言はボタンの上の`role="alert"`に示し、押し直せる |

- リンクを開いただけ(メールソフトやセキュリティ製品の事前の取得を含む)では確定しない。
- 入力欄を持つメールのリンクの画面(新しいパスワードの設定・招待の受け入れなど)は、`LinkConfirmation`を使わず、`useFragmentToken`と`AppForm`で組み立てる。

### 管理画面の部品

管理画面の一覧のページを組み立てる部品を`components/admin/`に置く。GraphQLの型と利用側アプリの型に依存せず、行の型は呼び出す側が型引数で決める。画面シェル・メニュー・ロールによる出し分けは「[管理画面のシェルと区画](009-admin-console-shell.md)」に、理由の要否と監査ログの記録は「[監査ログの記録](../backend/008-audit-logging.md)」に従う。

```tsx
import { AdminDataTable } from '<共通部品の配置先>/components/admin/admin-data-table.tsx';
import { AdminFilterBar } from '<共通部品の配置先>/components/admin/admin-filter-bar.tsx';
import { AdminPageHeader } from '<共通部品の配置先>/components/admin/admin-page-header.tsx';

<AdminPageHeader
  title="管理者アカウント"
  actions={<Button type="button">招待する</Button>}
/>;

<AdminFilterBar onApply={applyFilters} onReset={resetFilters}>
  {/* 呼び出す側の入力欄(LabelとInput・Selectなど) */}
</AdminFilterBar>;

<AdminDataTable
  caption="管理者の一覧"
  columns={[
    { key: 'nickname', header: 'ニックネーム', cell: (row) => row.nickname },
  ]}
  rows={query.data?.admins}
  rowKey={(row) => row.id}
  error={
    query.error === null
      ? undefined
      : {
          message: errorMessageOf(query.error, APP_PROFILE.contactAvailable),
          onRetry: () => query.refetch(),
        }
  }
  emptyMessage="管理者はまだいません。"
  pagination={{ hasPrevious, hasNext, onPrevious, onNext }}
/>;
```

| 部品              | props                                                                                                               | 振る舞い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdminPageHeader` | `title`・`description`(省略可)・`actions`(省略可)                                                                   | `title`をページの`<h1>`にし、説明と操作の領域を続けて描く。狭い画面では操作を見出しの下へ折り返す                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `AdminDataTable`  | `caption`・`columns`(`key`・`header`・`cell`・`className`)・`rows`・`rowKey`・`error`・`emptyMessage`・`pagination` | `rows`が`undefined`の間は`LoadingSkeleton`、`error`があれば`ErrorState`(`contactHref`無し)、0件なら`EmptyState`を表の代わりに描く。行があれば`Table`で描き、`caption`を画面に見えない`TableCaption`にし、列の見出しに`scope="col"`を付ける。表・状態の表示を包む領域に、読み込み中の間だけ`aria-busy`を付け、読み上げが遅れないよう`LoadingSkeleton`はその領域の外の兄弟に描く。`pagination`を渡すと、状態によらず名前「ページ送り」の`<nav>`に「前へ」「次へ」を描き、ページの無い側と、読み込み中・エラーの間の両方を`aria-disabled`にして押しても何もしない |
| `AdminFilterBar`  | `children`(入力欄)・`onApply`・`onReset`                                                                            | 名前「絞り込み」の`role="search"`の`<form>`に入力欄と「適用」「解除」を並べる。送信(「適用」と入力欄のEnter)は既定の遷移を止めて`onApply`を呼び、「解除」は`onReset`だけを呼ぶ。入力欄の値は呼び出す側が持つ                                                                                                                                                                                                                                                                                                                                                   |

- 表の名前は`TableCaption`で付け、`aria-labelledby`へは切り替えない。`caption`は文字列で渡すため見出しの要素の`id`に依存せず、横スクロールの領域の名前もキャプションの文言から取れるためである。ページの見出しと同じ文言を画面に二重に出さないよう、キャプションは画面に見えない文言にする。
- `error.message`は呼び出す側が`errorMessageOf(error, APP_PROFILE.contactAvailable)`で選ぶ。部品はアプリのプロファイルを読まず、問い合わせの導線を出さない。
- ページ送りのボタンは`disabled`にせず、読み込み中やエラーの間も消さない。押した直後に最後のページや次のページの読み込み中へ変わっても、フォーカスがボタンに残る(「[操作できない状態](004-accessibility-rules.md#操作できない状態)」)。0件でも前のページがあれば「前へ」で戻れる。
- `pagination`は複数のページになり得る一覧にだけ渡す。渡さなければページ送りを描かない。
- 1つのページに表を複数置くときは、呼び出す側が表ごとに見出しを加え、`caption`をそれぞれ異なる文言にする。

破壊的な操作の確認と理由の入力、管理者のプロフィール画像の表示にも、同じディレクトリの部品を使う。

```tsx
import { AdminAvatar } from '<共通部品の配置先>/components/admin/admin-avatar.tsx';
import { ConfirmActionDialog } from '<共通部品の配置先>/components/admin/confirm-action-dialog.tsx';
import { ReasonField } from '<共通部品の配置先>/components/admin/reason-field.tsx';
import { REASON_SCHEMAS } from '<共通部品の配置先>/components/admin/reason-schema.ts';

<ConfirmActionDialog
  open={open}
  onOpenChange={setOpen}
  title={`管理者「${admin.nickname}」を削除しますか?`}
  description="削除した管理者はログインできなくなります。"
  confirmLabel="削除"
  reason="optional"
  audited
  onConfirm={({ reason }) =>
    deleteAdmin.mutateAsync({ variables: { id: admin.id, reason } })
  }
  failureMessageOf={(error) =>
    errorMessageOf(error, APP_PROFILE.contactAvailable)
  }
  returnFocusRef={headingRef}
/>;

// 理由を自分のフォームに置く時は、検証規則にREASON_SCHEMASを使う
const schema = z.object({ reason: REASON_SCHEMAS.required });
<ReasonField control={form.control} name="reason" required />;

<AdminAvatar image={admin.avatar} nickname={admin.nickname} size={32} />;
```

| 部品・値              | props                                                                                                                                                                          | 振る舞い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfirmActionDialog` | `open`・`onOpenChange`・`title`・`description`・`confirmLabel`・`reason`(`required`・`optional`・`none`)・`audited`・`onConfirm`・`failureMessageOf`・`returnFocusRef`(省略可) | 状態で開く確認のダイアログ。`reason`が`none`でなければ`ReasonField`を描き、`audited`が真なら監査ログに記録される旨を示す。確定のボタンは破壊的な操作の色で、必須の理由が空・空白だけ・上限超えの間は`disabled`。確定すると前後の空白を除いた理由(空なら`undefined`)で`onConfirm`を呼び、成功したら`onOpenChange(false)`で閉じる。処理中は確定のボタンを`aria-disabled`・`aria-busy`と「送信中」、「キャンセル」を`aria-disabled`、右上の「閉じる」を`disabled`にし、取り消し・Escape・外側の押下で閉じない。外側の押下でフォーカスが`<body>`へ落ちた時は、ダイアログへ戻す。`onConfirm`が投げると、開いたまま理由の入力を保ち、`failureMessageOf(error)`の文言をダイアログの中に`role="alert"`で示す。サーバーの欄の詳細が理由の欄に対応する時は、欄のエラーとして示す。閉じた後は`returnFocusRef`の要素、無ければ開いた時にフォーカスのあった要素へフォーカスを戻す |
| `ReasonField`         | `FormField`のprops(`label`・`description`・`children`を除く)・`required`                                                                                                       | 呼び出す側の`AppForm`の中に、名前「理由(必須)」か「理由(任意)」の複数行の入力欄を描き、個人情報を含めない旨を説明として関連付ける。必須なら`aria-required`を付ける                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `REASON_SCHEMAS`      | `required`・`optional`                                                                                                                                                         | 理由の検証規則。共用部品の入力規則(`checkAuditReason`・`AUDIT_REASON_MAX`)で前後の空白を除いた書記素を数え、`AUDIT_REASON_MAX`を超えると上限の文言、必須で空なら入力を求める文言を示す(APIサーバーの監査ログの記録と同じ文言)。出力は前後の空白を除いた理由で、空なら`undefined`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `AdminAvatar`         | `image`・`nickname`・`size`(`32`・`64`・`128`)・`alt`(省略可、既定は空)・`className`                                                                                           | `MediaPicture`で丸い正方形のプロフィール画像を描く。画像が無い・表示できない(隔離中・読み込みの失敗)ときは、ニックネームの先頭1文字の既定のアイコンを同じ寸法で描く。配色はニックネームから決める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

- `failureMessageOf`は呼び出す側が`(error) => errorMessageOf(error, APP_PROFILE.contactAvailable)`で渡す。部品はアプリのプロファイルを読まない。
- 確定で開いた元のボタンが消える操作(一覧の行の削除など)は、`returnFocusRef`で閉じた後のフォーカスの移り先(ページの見出しなど)を渡す。
- 理由の必須・任意は、監査ログの操作種別の理由の要否に合わせる。理由を受け付けない操作種別は`none`にする。
- `AdminAvatar`は既定でニックネームを隣に書く飾りの画像として、支援技術に読ませない。ニックネームを書かずに置く時だけ`alt`を渡す。

カテゴリのマスタ(名前と任意のハンドルを持つ項目の一覧)の一覧・追加・名前の編集・削除にも、同じディレクトリの部品を使う。保存の可否と業務規則(名前の重複・使われているカテゴリの削除の拒否など)は呼び出す側とAPIサーバーが判定し、部品は入力の形の検証と結果の表示だけを行う。

```tsx
import { CategoryMasterEditor } from '<共通部品の配置先>/components/admin/category-master-editor.tsx';

// 描画のたびに作り直さないよう、モジュールの定数にする
const validateCategoryHandle = (handle: string): string | undefined =>
  HANDLE_PATTERN.test(handle) ? undefined : HANDLE_FORMAT_MESSAGE;

<CategoryMasterEditor
  title="記事カテゴリ"
  categories={query.data?.categories}
  withHandle
  canEdit={canEditCategories}
  validateHandle={validateCategoryHandle}
  onCreate={(input) => createCategory.mutateAsync({ variables: input })}
  onUpdate={(id, input) =>
    updateCategory.mutateAsync({ variables: { id, ...input } })
  }
  onDelete={(id) => deleteCategory.mutateAsync({ variables: { id } })}
  failureMessageOf={(error) =>
    errorMessageOf(error, APP_PROFILE.contactAvailable)
  }
/>;
```

| 部品                   | props                                                                                                                                                                                                                                                                                                     | 振る舞い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CategoryMasterEditor` | `title`・`categories`(`id`・`name`・`handle`(省略可)・`systemDefault`、`undefined`は読み込み中)・`withHandle`・`canEdit`・`validateHandle`(省略可)・`onCreate`・`onUpdate`・`onDelete`・`failureMessageOf`・`deleteDescriptionOf`(省略可)・`deleteAudited`(省略可、既定は偽)・`serverFieldPrefix`(省略可) | `title`を`<h2>`の見出しにし、「カテゴリを追加」のボタンと、`AdminDataTable`(`caption`は`title`)でカテゴリ名・ハンドル(`withHandle`が真の時だけ。無ければ「未設定」)・操作の列の一覧を渡した順で描く。行の「編集」「削除」は読み上げの名前を「「<カテゴリ名>」を編集」のようにする。`systemDefault`の行は「システム標準」の印を付けて「削除」を描かず、そうした行があれば削除できない旨を示す。`canEdit`が偽なら追加・編集・削除のボタンを`disabled`にし、権限が無い旨を示す。追加・編集は`CategoryFormDialog`で行い、成功で`onCreate(input)`・`onUpdate(id, input)`を呼ぶ。削除は`ConfirmActionDialog`(理由なし)で確定してから`onDelete(id)`を呼び、成功して閉じた後は見出しへ、取り消した後は開いた元の行の「削除」へフォーカスを移す。ダイアログは開くたびに作り直し、閉じる動きの最中に開き直しても前の入力を残さない。失敗はそれぞれのダイアログの中に`failureMessageOf(error)`の文言で示す。削除の確認の説明は、`deleteDescriptionOf`を渡せば削除する項目を渡して返った文、無ければ元に戻せない旨の既定の文にする。`deleteAudited`が真なら、削除の確認に監査ログに記録される旨を示す。`serverFieldPrefix`は`CategoryFormDialog`へそのまま渡す |
| `CategoryFormDialog`   | `open`・`onOpenChange`・`title`・`submitLabel`・`initialValues`(`undefined`は空)・`withHandle`・`validateHandle`(省略可)・`onSubmit`・`failureMessageOf`・`serverFieldPrefix`(省略可)                                                                                                                     | 状態で開くカテゴリの入力のダイアログ。「カテゴリ名」は共用部品の入力規則(`checkCategoryName`・`CATEGORY_NAME_MAX`)と違反の文言(`CATEGORY_NAME_MESSAGES`)で検証し、前後の空白を除く前の値に使用できない文字があれば使用できない文字の文言、無ければ前後の空白を除いた書記素を数え、空なら入力を求める文言、上限を超えると上限の文言を、最初の1つの違反だけフォーカスを外した時点で示す。APIサーバーも同じ入力規則と文言で検証するため、画面とサーバーの文言が一致する。`withHandle`が真なら「ハンドル」の欄を描き、前後の空白を除いた値を`validateHandle`へ渡して返った文言を示す。保存では前後の空白を除いた名前と、空でないハンドルを渡す。処理中・失敗・サーバーの欄の詳細・閉じた後のフォーカスの扱いは`ConfirmActionDialog`と同じ。`onSubmit`が投げたエラーの欄の詳細は、`serverFieldPrefix`を`AppForm`へ渡して先頭の`<接頭辞>.`を外した経路(`name`・`handle`)の欄に示す。保存の引数を`input`のような1つの引数にまとめて送り、サーバーが欄の詳細を`input.name`のように返す時は`input`を渡す。渡さなければ経路をそのまま欄の名前と照らし、合わない詳細は欄に対応しない失敗として`failureMessageOf(error)`の文言で示す                           |

- `validateHandle`は妥当なら`undefined`、違反なら欄に示す文言を返す関数にする。ハンドルの形式の規則は用途ごとに異なるため、部品は規則を持たない。渡さなければハンドルの形式を検証しない。空のハンドルを受け付けない用途では、空の値にも文言を返す。
- `validateHandle`は描画のたびに作り直さない関数(モジュールの定数や`useCallback`)で渡す。作り直すと、検証規則が変わったとみなして入力済みの欄を検証し直す。
- `title`は部品が見出しとして描くため、呼び出す側は同じ題の見出しを重ねて置かない。
- 削除の確認で項目ごとの情報(紐付くデータの件数や付け替え先など)を示す時は、`deleteDescriptionOf`で項目から文を作る。部品の項目の型(`id`・`name`・`handle`・`systemDefault`)は変えず、文に使う値は呼び出す側が閉包で持つ。
- 削除を監査ログに記録する用途では`deleteAudited`を真にする。部品の削除の確認は理由を受け付けないため、削除の監査ログの操作種別の理由は`optional`か`none`にし、`required`にしない。
- システム標準のカテゴリの名前の変更を拒否するかどうかは呼び出す側の業務規則のため、部品は「編集」を描いたままにし、拒否をAPIサーバーのエラーと`failureMessageOf`の文言で示す。

### 利用者と運営のやり取りの表示

利用者と運営の間のメッセージのやり取り(連絡のフォームから始まるスレッド)を、利用者側と管理画面で同じ見た目に描く部品を`components/inquiry/`に置く。部品はGraphQLの生成した型とアプリの型を読まない。呼び出す側が取得の結果を部品のpropsへ写し、閲覧者から見た配置(自分か相手か)と送信者の表示名(削除済みの送信者の表示を含む)を決めて渡す。

```tsx
import { InquirerAvatar } from '<共通部品の配置先>/components/inquiry/inquirer-avatar.tsx';
import { InquiryMessageCard } from '<共通部品の配置先>/components/inquiry/inquiry-message-card.tsx';
import { InquiryStatusBadge } from '<共通部品の配置先>/components/inquiry/inquiry-status-badge.tsx';

<InquiryStatusBadge status={inquiry.status} />;

<InquiryMessageCard
  side={message.fromViewer ? 'self' : 'other'}
  senderLabel={message.senderLabel}
  avatar={
    <InquirerAvatar
      image={message.avatar}
      nickname={message.senderLabel}
      size="xs"
    />
  }
  body={message.body}
  attachments={message.attachments}
  createdAt={message.createdAt}
/>;
```

| 部品                       | props                                                                                                       | 振る舞い                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InquiryStatusBadge`       | `status`(共用部品の`InquiryStatus`)                                                                         | 共用部品の表示名(`INQUIRY_STATUS_LABELS`)を`Badge`で描く。状態ごとに見た目を変えるが、状態は表示名の文言で伝える                                                                                                                                                         |
| `InquiryMessageCard`       | `side`(`self`・`other`)・`senderLabel`・`avatar`・`body`・`attachments`・`createdAt`(ISO 8601)・`className` | 送信者の表示名と送信日時(`DateTime`の`longDateTime`)を見出しに、本文をテキストとして改行を保って描き(HTMLとして解釈しない)、添付があれば本文の後に`InquiryAttachmentList`を置く。`self`はアバターを右に、`other`は左に置く。改行の無い長い本文と表示名は枠の中で折り返す |
| `InquiryAttachmentList`    | `attachments`(`id`・`originalFileName`・`contentType`・`byteSize`)・`className`                             | 名前「添付ファイル」の一覧に、添付ごとに`PrivateFileLink`(元のファイル名とサイズ)と、その隣に形式の表示名(`MEDIA_TYPE_LABELS`、受け付けない形式は「不明な形式」)を並べる。画像の形式でもインライン表示しない。添付が0件なら何も描かない                                  |
| `InquirerAvatar`           | `image`(`MediaImageView`、`null`は未登録)・`nickname`・`size`(`xs`は32px・`sm`は64px)                       | `MediaPicture`で丸い正方形のプロフィール画像を描く。画像が無い・表示できない(隔離中・読み込みの失敗)ときは、ニックネームの先頭1文字の既定のアイコンを同じ寸法で描く。ニックネームを隣に書く飾りの画像として、支援技術に読ませない                                        |
| `InquiryAutoRefreshSwitch` | `checked`・`onCheckedChange`                                                                                | 名前「自動更新」の`Switch`に、定期再取得の間隔の秒数(`LIVE_REFRESH_INTERVAL_MS`から作る)ごとに新しいメッセージと状態を表示する旨の説明を関連付けて描く。状態は呼び出す側が持ち、切り替えた後の値を`onCheckedChange`で受ける                                              |

- `InquiryAttachmentList`の`id`は、ダウンロードの中継の経路を組み立てるファイルの識別子である。呼び出す側はダウンロードのパスを渡さない。
- 表示中のやり取りを最新に保つ取得は、`utilities/query/live-refresh.ts`の`LIVE_REFRESH_QUERY_OPTIONS`をクエリの設定に重ね、`InquiryAutoRefreshSwitch`を切った間は`refetchInterval`を`false`にする。共通の値・ページの`loader`との組み合わせ・止める手段・送信の後の無効化・テストは「[表示中の画面の定期再取得](010-live-refresh-queries.md)」に従う。
- メッセージの一覧は`role="log"`の領域に置く(「[演出の停止手段の義務](004-accessibility-rules.md#演出の停止手段の義務)」)。

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
2. 部品が新しいパッケージを使う時は、共通部品と利用側アプリの`vitest.browser.config.ts`の`optimizeDeps.include`(事前バンドルする依存の一覧)に加える。サブパスの入口(`<パッケージ>/<入口>`)は入口ごとに別の依存として扱われるため、読み込む入口をそれぞれ加える。エディタの遅延読み込みのモジュールが読み込む入口は`config/editor-prebundled-dependencies.ts`の一覧に加え、共通部品と利用側アプリのブラウザテストの設定とカタログの設定(`.storybook/main.ts`)がこの一覧を事前バンドルする(一覧の漏れは同名の単体テストが検出する)。加えないと、最初の実行の途中で事前バンドルがやり直されてページが再読み込みされ、Reactが2つ読み込まれてフックが失敗する。
3. 共通部品の`bun run test:browser`のカバレッジ(ファイルごとの行と関数)と、カタログの網羅性の検査(下記)を通す。

#### アップロードの入力欄

選んだファイルを検査して送り、結果を示すところまでを1つの欄で行う。画像は`ImageUploadField`、添付ファイル(編集しないファイル)は`AttachmentUploadField`を使う。どちらも`FileDropZone`・`FileSelectionList`を中に持ち、送信は`useFileUpload`で行う。

```tsx
import { ImageUploadField } from '<共通部品の配置先>/components/media/image-upload-field.tsx';

import { APP_PROFILE } from '../../composition/app-profile.ts';

<FormField control={form.control} name="logoFileId" label="ロゴ">
  {(control) => (
    <ImageUploadField
      ref={control.ref}
      label="画像を選択"
      constraints={{
        purpose: '<用途名>',
        allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
        maxBytes: 512_000,
        subjectLabel: 'ロゴ',
      }}
      edit={{ aspect: 1, maxLongSide: 512 }}
      contactAvailable={APP_PROFILE.contactAvailable}
      onUploaded={([uploaded]) => {
        if (uploaded !== undefined) {
          control.onChange(uploaded.fileId);
        }
      }}
      aria-labelledby={control.labelId}
      aria-describedby={control['aria-describedby']}
      aria-invalid={control['aria-invalid']}
    />
  )}
</FormField>;
```

| props                                                        | 内容                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `label`                                                      | 選択のボタンの文言。欄の名前は`FormField`のラベルと合わせて「<欄のラベル> <ボタンの文言>」になる                                        |
| `constraints`                                                | 用途名・許可形式・1件の上限サイズ・文言の主語と、任意の個数・合計の上限と既存の個数・合計                                               |
| `edit`(`ImageUploadField`だけ)                               | 編集ダイアログの縦横比・最大寸法・範囲の形(「[画像の切り取り](#画像の切り取り)」)                                                       |
| `multiple`                                                   | 複数を選べるか。偽なら1件だけを上限にし、既存の個数を数えない(選び直すと前のファイルを置き換える前提)                                   |
| `contactAvailable`                                           | 必須。問い合わせの画面への導線を持つ画面か。`<アプリのプロファイル>.contactAvailable`を渡す。想定外の応答の文言を`errorMessageOf`で選ぶ |
| `onUploaded`                                                 | 送信できたファイル(`UploadedFile`)の一覧を受け取る                                                                                      |
| `ref`・`aria-labelledby`・`aria-describedby`・`aria-invalid` | `FormField`の子の関数が受け取る値をそのまま渡す                                                                                         |

- `ImageUploadField`は、選んだ時点で形式と個数、SVGのサイズと合計を検査し、SVG以外の画像は選んだ時点でサイズを判定しない(`checkSelection`の`editedTypes`に`EDITED_IMAGE_TYPES`を渡す)。SVG以外の画像を選んだ順に1枚ずつ`ImageCropDialog`で編集させ、全部を確定すると、作り直したファイルと編集しないSVGで`editedTypes`なしに検査し直してから送る。作り直したファイルのサイズの超過は、切り取る範囲を狭めるか別の画像を選ぶよう案内する文言にする(`selectionMessagesOf`に作り直したファイルの名前を渡す)。複数の画像の編集の途中で取り消すと、その画像だけを選択から外し、編集を済ませた画像と編集しないSVGを残して、残りの画像の編集を続ける。検査し直しは外した後の選択で行う。取り消した画像のダイアログの中身は次の画像に入れ替わり、フォーカスはダイアログの中に留まって、ダイアログの説明が次の画像のファイル名を伝える。次の画像を読み込むまでは取り消しを受け付けず、押し続けたEscapeの繰り返しも取り消しにしないため、Escapeを押し続けても外れるのは最初の1枚だけになる(ダブルクリックの2回目は、次の画像の読み込みが終わっていれば次の画像を取り消し得る)。次の画像を読み込めない時は、その画像も取り消して外せる。最後の画像を取り消すとダイアログを閉じて選択のボタンへフォーカスを戻し、残った画像を送る。全ての画像を取り消すと何も加えず、前の結果の表示を残す。
- `AttachmentUploadField`は、編集ダイアログを出さず、選んだファイルのサイズで判定してそのまま送る。
- 送信は`useFileUpload`が1件ずつ順に`fetch`で行い、`sendUpload`と`parseUploadResponse`で結果を文言にする。再試行できる失敗(一時的に利用できない・要求の集中・通信の失敗・送信の不備)では「再試行」のボタンを出し、失敗したファイルから同じファイルで送り直す。押すと、消えるボタンからフォーカスを選択のボタンへ移す。選び直しの拒否では再試行を出さず、別のファイルを選ばせる。
- 文言は、画面が用途の表示名などから作るエラーコード(`rejectionOf`の対象)ではその文言にし、それ以外のエラーコードでは共通のエラー形式(`errorEnvelopeSchema`)の本文の文言をそのまま示す(中継の`csrf_rejected`・`internal_error`など)。本文がJSONでない・共通のエラー形式でない・文言が空の時と、画面からは起きない用途の誤り(`upload_purpose_not_found`)は、`errorMessageOf`で想定外の文言にする。503・429は、本文に文言が無くても状態コードの文言で再試行できる失敗にする。
- 送信中に失敗で止まった時は、それまでに送れたファイルを`onUploaded`へ渡し、再試行で送れた残りを改めて渡す。各ファイルは1度だけ渡る。
- 送信の結果の型(`UploadedFile`)の識別子をフォームの値にするのは呼び出し側である。送信中の部品を外すと送信を中断し、結果を渡さない。
- 一覧はファイルごとに送信待ち・送信中・アップロード済みを示し、送信済みのファイルの縮小画像をプレビューにする。選択・検査・送信の結果は、最初から置いた`aria-live="polite"`の領域で読み上げる。エラーの文言はこの領域の中に表示し、選択のボタンへ`aria-describedby`で結び付けて`aria-invalid`を付ける。
- 送信中は選択のボタンを`pending`にし、選び直しを受け付けない。
- 送信中は`useSubmitHold`で囲む`AppForm`の送信を止める。送信中にフォームを送信すると、送らずに「<主語>のアップロードが終わってから、もう一度お試しください。」をエラーの文言として示し、選択のボタンへフォーカスを移す。文言は複数のファイルの送信が全て終わるか失敗で止まると消え、送信が終わった後に改めて送信すると、`onUploaded`で受け取った新しい値で送る。前の値のまま保存して成功を示さないためである。`AppForm`の外では送信を止められないため、フォームの欄として使う時は`AppForm`の中の`FormField`に置く。
- 想定外の応答と、本文の文言を示した失敗のうち想定外のエラーコード(`isUnexpectedErrorCode`。GraphQLの失敗と同じ基準)の失敗は、`UnexpectedUploadResponseError`としてエラートラッキングへ送る(「[送信の入口](007-frontend-observability.md#送信の入口)」)。中継の拒否(`csrf_rejected`など)とAPIの`AppError`のコードは想定内として送らない。再試行できる503・429の失敗も送らない(中継の`upstream_*`は中継が送る)。
- ブラウザテストでは大域の`fetch`を`test/fake-upload-fetch.ts`の`stubUploadFetch`で差し替え、要求を記録して応答を1件ずつ返す。カタログのストーリーは`test/story-upload-endpoint.ts`の`installStoryUploadEndpoint`を`beforeEach`で使い、アップロードの中継の経路への要求だけを偽の応答にする。画像の読み込みの途中の状態は、`test/held-image-decoding.ts`の`holdImageDecoding`で大域の`createImageBitmap`を止めて保ち、返した関数で再開する。後始末は`vi.unstubAllGlobals()`で行う。

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

- `title`は`<分類>/<部品名>`にする。分類は、基本部品・重ねて表示する部品・フォーム・状態表示・フィードバック・エラーの表示・日時と数値・bot判定・文書の外枠・疎通確認・マークダウン・検索・メディア・認証・管理画面のいずれかにする。
- 主要な状態(既定・無効・エラー・読み込み中・送信中・開いた状態など)ごとにストーリーを分ける。操作で作る状態(検証エラー・送信中など)は`play`で操作する。押した時の処理などの関数のpropsには`fn()`を渡す。
- ライト・ダークはツールバーで切り替えるため、配色ごとのストーリーは作らない。ただし、配色そのものを確かめる対象にする部品(本文の文字組みのように、配色で文字色や背景色の組み合わせが大きく変わる部品)は、ダークの配色を確かめるストーリーを作ってよい。そのストーリーはツールバーの値をストーリーの`globals`(`globals: { theme: 'dark' }`)で指定し、配色の切り替えを部品のpropsにしない。
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

- ボタン・タブ・バッジは固定の幅を持たない。共通部品の`Button`・`TabsTrigger`・`Badge`は、場所が足りる間は文言を1行で表示して幅を伸ばし、親の幅を超える時は文言を折り返して高さを伸ばす。文言の行は`whitespace-nowrap`で禁止せず、高さは`min-h-*`で下限だけを決める。`TabsList`はトリガーが1行に並ばない時に次の行へ折り返す。
- `Button`は`max-w-full`で親の幅を上限にし、`shrink-0`で横に並べた親の中では縮まない。ボタンを横に並べる親は`flex-wrap`などで折り返せるようにし、折り返さない親に複数のボタンを並べない。
- 利用側で`w-*`の固定の幅・`whitespace-nowrap`・`h-*`の固定の高さを付けない。
- 共通部品の`DialogFooter`(640px以上)や画面シェルのヘッダーのように部品を横に並べる行は、幅が足りない時に部品を次の行へ折り返す。高さを決めている行(画面シェルのヘッダー)は、高さを`min-h-*`で下限だけにする。
- 翻訳させない語(英語の固有名詞など)には`translate="no"`を付ける。`Button`・`Badge`・`TabsTrigger`などは受け取った属性を要素へ渡す(`<Badge translate="no">…</Badge>`)。
- 高さを固定したり、はみ出しを切り捨てたりして文言を収めない。
- 共通部品のブラウザテストは、長い文言で幅が伸びて内容が切れないこと(`isContentClipped`)、`translate="no"`が要素へ渡ること、幅を絞った親の中に置いても親から溢れないこと(`elementsOverflowingContainer`)を確かめる。レイアウトを作るアプリは、横スクロールが出ず要素が画面の左右の端を越えないこと(`hasHorizontalScroll`・`elementsBeyondViewportEdges`)を、幅320pxで初期の区画と翻訳で長くなった文言の部品を区画と本文に差し込んだ状態の両方について、区画の部品がヘッダーの行に並ぶ画面幅では長い文言の部品を差し込んだ状態について、ブラウザテストで確かめる。
