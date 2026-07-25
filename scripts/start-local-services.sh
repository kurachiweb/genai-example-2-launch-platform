#!/bin/sh
# ローカル開発用コンテナの常駐プロセス(Valkey・Mailpit)を起動する。
# 単一コンテナ構成のため、DockerfileのCMDから読み込まれる。
#
# このスクリプトはCMDのshに`.`(source)で読み込ませる前提である。
# 別プロセスとして実行すると、ここで登録したtrapと各プロセスの親子関係がスクリプト終了時に失われ、
# 停止時にValkeyへSIGTERMを転送できなくなるため。

# 各プロセスはDockerのポートフォワーディングが機能するよう0.0.0.0で待ち受ける(既定の127.0.0.1待受だとホストから48041/48046へ到達できない)。
# Valkeyの代替元であるCloudflare KVは永続ストレージのため、Valkeyもスナップショット(dump.rdb)で永続化し、コンテナ再作成後もデータを引き継ぐ。
# 書き出しの契機は定期スナップショット（900 秒で 1 件以上、300 秒で 10 件以上、60 秒で 10000 件以上の変更）と、コンテナの終了時である。
# 出力先はWrangler D1ローカルモードのDBデータと同じ。
valkey-server \
  --port 48041 \
  --bind 0.0.0.0 \
  --dir /workspace/apps/db/data \
  --dbfilename dump.rdb \
  --save 900 1 300 10 60 10000 \
  --daemonize no \
  >/workspace/apps/db/data/valkey.log 2>&1 &
valkey_pid=$!

mailpit \
  --listen 0.0.0.0:48046 \
  --smtp 0.0.0.0:1025 \
  >/workspace/apps/email/mailpit.log 2>&1 &
mailpit_pid=$!

# `docker compose down`のSIGTERMはPID1のshにしか届かず、そのままではValkeyが終了時スナップショットを取れずに直近の書き込みを失うため、trapで子プロセスへ転送する。
# スナップショット書き出しの完了を待つため、Valkeyの終了までwaitする。
trap 'kill -TERM $valkey_pid $mailpit_pid 2>/dev/null; wait $valkey_pid 2>/dev/null' TERM INT
