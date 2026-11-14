export type HelpCategoryEditDenial = 'protected';

// 並べ替えは標準カテゴリも対象にするため、この判定は名前の変更と削除にだけ使う
export const checkHelpCategoryEditable = (category: {
  readonly systemDefault: boolean;
}): HelpCategoryEditDenial | undefined =>
  category.systemDefault ? 'protected' : undefined;
