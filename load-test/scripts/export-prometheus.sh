#!/usr/bin/env bash
#
# 운영 Prometheus 지표를 구간 단위로 내려받아 로그 버킷 load-test/<날짜>/prometheus/ 에 올린다 (LDP-228).
# Prometheus 저장소는 emptyDir 라 매일 destroy 하면 지표가 사라진다 — 테스트 날 마무리(destroy 전)에 실행한다.
#
# 사용법 (노트북, kubeconfig = 운영 EKS, AWS 프로필 = 로그 버킷 쓰기 권한):
#   load-test/scripts/export-prometheus.sh <시작 UTC> [끝 UTC] [이름]
#   load-test/scripts/export-prometheus.sh 2026-11-04T01:30:00Z                        # 끝 = 지금, 이름 = all
#   load-test/scripts/export-prometheus.sh 2026-11-04T07:20:00Z 2026-11-04T08:30:00Z node2
#
# 결과: prometheus-<날짜>-<이름>.tar.gz (쿼리마다 /api/v1/query_range 응답 JSON 1개 + README.txt), step 15s
set -euo pipefail

START="${1:?시작 시각(UTC, 예: 2026-11-04T01:30:00Z)}"
END="${2:-$(date -u +%FT%TZ)}"
NAME="${3:-all}"
STEP="${STEP:-15s}"
PROFILE="${AWS_PROFILE:-team04}"
BUCKET="${RESULT_BUCKET:-team04-hotel-logs}"
DAY="${START:0:10}"
PORT=19090

work=$(mktemp -d)
trap 'kill "${pf:-0}" 2>/dev/null || true; wait "${pf:-0}" 2>/dev/null || true; rm -rf "$work"' EXIT

kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus "$PORT:9090" >/dev/null 2>&1 &
pf=$!
for _ in $(seq 1 20); do curl -sf "localhost:$PORT/-/ready" >/dev/null && break; sleep 1; done

# 부하 테스트 분석에 쓰는 지표 (위키 「성능 테스트」 결과 문서의 근거 수치)
queries=(
  "pod_cpu|sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{namespace=~\"backend|traefik|monitoring|kube-system\",container!=\"\",container!=\"POD\"}[1m]))"
  "pod_cpu_throttled_ratio|sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{namespace=\"backend\"}[1m])) / sum by (pod) (rate(container_cpu_cfs_periods_total{namespace=\"backend\"}[1m]))"
  "pod_memory_working_set|max by (pod) (container_memory_working_set_bytes{namespace=\"backend\",container!=\"\",container!=\"POD\"})"
  "node_cpu_util|1 - avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[1m]))"
  "node_memory_util|1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes"
  "eventloop_lag_p99|max by (pod) (nodejs_eventloop_lag_p99_seconds{namespace=\"backend\"})"
  "gateway_http_p95|histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service=\"api-gateway\"}[1m])))"
  "gateway_http_rps_by_status|sum by (http_status_code) (rate(http_server_request_duration_seconds_count{service=\"api-gateway\"}[1m]))"
  "rpc_client_p95_by_method|histogram_quantile(0.95, sum by (peer_service, rpc_method, le) (rate(rpc_client_duration_seconds_bucket{namespace=\"backend\"}[1m])))"
  "rpc_server_p95_by_method|histogram_quantile(0.95, sum by (service, rpc_method, le) (rate(rpc_server_duration_seconds_bucket{namespace=\"backend\"}[1m])))"
  "rpc_server_rps_by_method|sum by (service, rpc_method) (rate(rpc_server_duration_seconds_count{namespace=\"backend\"}[1m]))"
  "db_pool_pending|max by (pod) (db_client_connections_pending{namespace=\"backend\"})"
  "db_pool_connections|max by (pod, state) (db_client_connections{namespace=\"backend\"})"
  "mysql_threads_connected|mysql_global_status_threads_connected"
  "mysql_questions_rate|sum(rate(mysql_global_status_questions[1m]))"
  "mysql_slow_queries_rate|sum(rate(mysql_global_status_slow_queries[1m]))"
  "traefik_entrypoint_rps_by_code|sum by (code) (rate(traefik_entrypoint_requests_total{entrypoint=\"web\"}[1m]))"
  "container_restarts|sum by (pod) (kube_pod_container_status_restarts_total{namespace=\"backend\"})"
  "deployment_replicas|kube_deployment_status_replicas_available{namespace=\"backend\"}"
  "hpa_replicas|kube_horizontalpodautoscaler_status_current_replicas{namespace=\"backend\"}"
  "nodes_ready|count(kube_node_status_condition{condition=\"Ready\",status=\"true\"} == 1)"
)

for entry in "${queries[@]}"; do
  name="${entry%%|*}"
  query="${entry#*|}"
  curl -sf --get "localhost:$PORT/api/v1/query_range" \
    --data-urlencode "query=$query" --data-urlencode "start=$START" \
    --data-urlencode "end=$END" --data-urlencode "step=$STEP" > "$work/$name.json"
  printf '%-32s series=%s\n' "$name" "$(jq '.data.result | length' "$work/$name.json")"
done

cat > "$work/README.txt" <<EOF
운영 Prometheus 지표 (Prometheus API query_range, step $STEP)
구간: $START ~ $END (UTC)
파일 = 쿼리 이름, 내용 = /api/v1/query_range 응답 JSON. 쿼리는 load-test/scripts/export-prometheus.sh 참고
EOF

out="prometheus-$DAY-$NAME.tar.gz"
tar czf "$work/$out" -C "$work" --exclude "$out" .
AWS_PROFILE="$PROFILE" aws s3 cp "$work/$out" "s3://$BUCKET/load-test/$DAY/prometheus/$out" --no-progress
echo "s3://$BUCKET/load-test/$DAY/prometheus/$out ($(du -h "$work/$out" | cut -f1))"
