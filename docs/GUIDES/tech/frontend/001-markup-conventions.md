# マークアップの規約

HTMLのマークアップで、表示する内容の意味に合った要素と属性を選ぶための規約を定める。

## 前提と用語

HTMLを直接書く場合に加え、ReactなどのJSXでHTMLを出力する場合も対象とする。JSXでは、HTMLの属性をDOMのプロパティ名で書く(例:`datetime`属性は`dateTime`)。

| 用語                | 意味                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| ISO形式の日時文字列 | ISO 8601の拡張形式で表した日時の文字列。JavaScriptでは`Date.prototype.toISOString()`の戻り値(例:`2026-01-15T09:30:00.000Z`) |
| 表示用の文字列      | 利用者に見せるために、言語・地域・タイムゾーンに合わせて整形した日時の文字列                                                |

## 日時の表示

HTML要素で日時を表示する場合は、必ず`<time>`要素を使い、`datetime`属性にISO形式の日時文字列を設定する。

```html
<time datetime="2026-01-15T09:30:00.000Z">2026年1月15日 18:30</time>
```

```tsx
<time dateTime={publishedAt.toISOString()}>{formatDateTime(publishedAt)}</time>
```

- `<time>`要素の内容には表示用の文字列を書く。表示用の文字列の形式は問わない(上の`formatDateTime`は表示用の文字列を返す任意の関数)。
- `datetime`属性は、内容が表す日時の機械可読な値を持つ(HTML Living Standardの「[The time element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-time-element)」)。表示用の文字列の形式に関わらず、プログラムが日時を一意に解釈できる。
- `toISOString()`はUTC(末尾の`Z`)で表す。表示用の文字列のタイムゾーンと異なってもよい。ISO形式の日時文字列は、タイムゾーンを含めて時点を一意に示すためである。
