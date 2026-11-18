#!/usr/bin/env bash
# TekirExtra Cloudflare Tunnel Yönetim Betiği

set -e

PORT="${PORT:-3100}"
PID_FILE="/tmp/tekirextra-cloudflared.pid"
LOG_FILE="/tmp/tekirextra-cloudflared.log"

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Tünel zaten çalışıyor (PID: $(cat "$PID_FILE"))."
      cat .tunel-adresi.txt 2>/dev/null || grep -o 'https://[^ ]*trycloudflare\.com' "$LOG_FILE" | tail -n 1
      exit 0
    fi

    echo "Tünel başlatılıyor..."
    nohup node scripts/uzaktan-erisim-tuneli.mjs > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    echo "Bağlantı kurulması bekleniyor..."
    for i in {1..15}; do
      sleep 1
      URL=$(cat .tunel-adresi.txt 2>/dev/null || grep -o 'https://[^ ]*trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)
      if [ -n "$URL" ]; then
        echo "=========================================="
        echo "Uzak Erişim Tüneli Hazır:"
        echo "URL: $URL"
        echo "=========================================="
        exit 0
      fi
    done
    echo "Tünel başlatıldı ancak URL henüz tespit edilemedi. Log: $LOG_FILE"
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "Tünel durduruluyor (PID: $PID)..."
        kill "$PID"
        rm -f "$PID_FILE"
        echo "Durduruldu."
      else
        echo "PID dosyası var ancak süreç çalışmıyor."
        rm -f "$PID_FILE"
      fi
    else
      echo "Çalışan tünel bulunamadı."
    fi
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Tünel AKTİF (PID: $(cat "$PID_FILE"))"
      URL=$(grep -o 'https://[^ ]*trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)
      echo "URL: $URL"
    else
      echo "Tünel çalışmıyor."
    fi
    ;;

  *)
    echo "Kullanım: $0 {start|stop|status}"
    exit 1
    ;;
esac
