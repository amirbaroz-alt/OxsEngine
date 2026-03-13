#!/bin/bash
MINIO_DATA="./storage/minio_data"
mkdir -p "$MINIO_DATA"

export MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin123}"

if pgrep -x minio > /dev/null 2>&1; then
  echo "[minio] Already running"
  exit 0
fi

minio server "$MINIO_DATA" --address ":9000" --console-address ":9001" &
MINIO_PID=$!
echo "[minio] Started with PID $MINIO_PID on :9000 (console :9001)"

for i in $(seq 1 15); do
  if curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    echo "[minio] Health check passed"
    exit 0
  fi
  sleep 1
done

echo "[minio] Warning: health check timed out, but process is running"
