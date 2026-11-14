#!/usr/bin/env bash
# Claudeが入力を待つことを知らせるフックから呼ばれる。
# コンテナには音声デバイスが無いため、VSCode統合ターミナルの疑似端末へBEL文字を書き込み、ホスト側のVSCodeにターミナルベル音を鳴らさせる。

stamp=/tmp/claude-terminal-bell.stamp

# 権限確認の通知は質問・プラン承認でも確認開始の6秒後に届くため、直前に鳴らしていれば二重に鳴らさない。
if [ "${1:-}" = "--skip-if-recent" ]; then
  last=$(stat -c %Y "$stamp" 2>/dev/null || echo 0)
  if (( $(date +%s) - last < 7 )); then
    exit 0
  fi
fi
touch "$stamp"

for pty in /dev/pts/[0-9]*; do
  [ -O "$pty" ] && timeout 1 sh -c 'printf "\a" > "$1"' _ "$pty"
done 2>/dev/null

exit 0
