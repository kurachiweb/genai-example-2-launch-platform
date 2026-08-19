#!/bin/bash
set -euo pipefail
# ローカル開発用コンテナのセットアップ(ディレクトリ作成・Chromium導入)と、常駐プロセス(Mailpit)の起動を行う。
# このスクリプトはCMDのbashに`.`(source)で読み込ませる前提である。
# 別プロセスとして実行すると、ここで登録したtrapと各プロセスの親子関係がスクリプト終了時に失われ、停止時にMailpitへSIGTERMを転送できなくなるため。

# `/home/bun/.claude`は名前付きボリュームで永続化されており、イメージの内容がコピーされるのはボリュームが空の初回マウント時のみである。
# そのためワークスペース信頼設定とRTKフックの登録はDockerfileのビルド時ではなくここで毎起動時に行うことで、将来の仕様変更が反映されるようにする。
bun /workspace/scripts/merge-claude-trust-config.ts || echo '[entrypoint] 信頼設定のマージに失敗しました' >&2
# RTKフックの登録
HOME=/home/bun RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch || echo '[entrypoint] RTKフックの登録に失敗しました' >&2

# プロジェクトルートディレクトリの非所有者でもgitコマンドを実行できるよう、安全なディレクトリとして設定する。
# `--add`ではコンテナ再起動のたびに重複行が増えるため、`--replace-all`で冪等にする。
git config --global --replace-all safe.directory /workspace /workspace || echo '[entrypoint] safe.directoryの設定に失敗しました' >&2

# DockerfileのRUN命令でホストに存在しないディレクトリを作成しても、bindマウントによって隠れてしまう。
# ここはホストからのbindマウント後に実行されるため、確実にコンテナ内でディレクトリにアクセスできる。
mkdir -p /workspace/apps/email || echo '[entrypoint] メールボックスディレクトリの作成に失敗しました' >&2

# Chromiumをインストールする。
# ただし`bun install`前にコンテナが起動した場合はそのスクリプトがスキップされるので、後ほどクイックスタート手順(docs/onboardings/README.md参照)に従いそのスクリプトを手動実行する。
/workspace/scripts/setup-chromium.sh || echo '[entrypoint] Chromium導入に失敗しました' >&2

# Mailpitのポートをこのプロジェクトの規約通り48041に変更し、起動する。
mailpit --listen 0.0.0.0:48041 >/workspace/apps/email/mailpit.log 2>&1 &
mailpit_pid=$!
# Mailpitプロセスの不正終了(バイナリ不在やポート競合など)を検知するため、起動後に生存確認する。正常起動なら1秒程度では終了しない。
sleep 1
if ! kill -0 "$mailpit_pid" 2>/dev/null; then
  echo 'Mailpitの起動に失敗しました。ログ末尾:' >&2
  tail -n 20 /workspace/apps/email/mailpit.log >&2
  # trapが既に無効なPIDへkillを送ってしまうのを防ぐ。
  mailpit_pid=
fi

# `docker compose down`のSIGTERMはPID1(docker-init)の子であるshに転送されるがその子(mailpit)には届かないため、trapで子プロセスへ転送する。
# `mailpit_pid`が空(起動失敗)の場合はkill・wait自体をスキップする。
terminate_mailpit() {
  # waitはmailpitがSIGTERMで正常終了した場合でも非ゼロを返しうるが、それは停止成功の結果であり失敗ではない。
  # このスクリプトは`.`でCMDのshに読み込まれ終了ステータスがそのままコンテナの終了コードになるため、trapが非ゼロで終わると`docker compose down`による正常停止がコンテナの異常終了として誤って扱われてしまう。
  # それを防ぐため常に成功で終える。
  [ -n "$mailpit_pid" ] || exit 0
  kill -TERM "$mailpit_pid" 2>/dev/null || true
  wait "$mailpit_pid" 2>/dev/null || true
  exit 0
}
trap terminate_mailpit TERM INT EXIT
