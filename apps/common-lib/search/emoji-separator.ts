// 絵文字の並びを構成する文字(絵文字・肌色の修飾・地域指示記号・ゼロ幅接合子・キーキャップ・異体字セレクタ・タグ文字)。数字・#・*はキーキャップの土台にもなるが、通常の文字として残す
const EMOJI_CHARACTERS =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{e0020}-\u{e007f}]|\u200d|\u20e3|\ufe0e|\ufe0f/gu;

// FTS5のunicode61はUnicode 6.1より後の絵文字を語の文字として扱うため、索引と検索語の両方で絵文字を空白に置き換えて語の区切りにする
export const separateEmoji = (text: string): string =>
  text.replace(EMOJI_CHARACTERS, ' ');
