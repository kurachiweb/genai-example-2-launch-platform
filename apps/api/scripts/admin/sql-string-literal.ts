const CONTROL_CHARACTER = /\p{Cc}/u;

// 値はwranglerのコマンドの引数やSQLのファイルへ埋め込まれ、文の分割をwranglerに委ねるため、引用符の内側でも扱いが揺れ得る制御文字は受け付けない
export function sqlStringLiteral(value: string): string {
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error('SQLの文字列のリテラルに制御文字は使えません。');
  }
  return `'${value.replaceAll("'", "''")}'`;
}
