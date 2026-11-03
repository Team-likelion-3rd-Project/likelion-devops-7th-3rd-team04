# 결제 VPC 지표 저장소 (LDP-181). Amazon Managed Service for Prometheus(AMP) 워크스페이스 · Alertmanager · 규칙.
#
#   결제 서버 Alloy ──(sigv4 remote_write, 44 aps-workspaces 엔드포인트)──→ AMP 워크스페이스
#   메인 Grafana ──(IRSA team04-hotel-grafana, AMP 데이터 소스 플러그인)──→ AMP 조회
#   AMP 규칙 → AMP Alertmanager → 알림 토픽(team04-hotel-alerts) → Chatbot → #alerts
#
# 메인 → 결제는 PrivateLink 단방향이라 메인 Prometheus 가 결제 서버를 scrape 할 수 없다 (결제 VPC 로 가는 경로 없음).
# 결제 서버가 AWS API(AMP)로 밀어 넣고 메인은 AWS API 로 읽는다. VPC 간 경로는 늘지 않는다.
#
# 🔒 상시 유지: 워크스페이스 ID 가 gitops Grafana 데이터 소스 URL 에 들어가므로 매일 바뀌면 안 된다.
# 지표는 AMP 기본 보관 기간(150일) 동안 남아 매일 재생성 전후를 비교할 수 있다. 워크스페이스는 시간 과금이 없고 수집 · 조회량만 과금된다.
# 결제 지표는 AMP 에만 있어 메인 Prometheus 지표와 한 쿼리 · 한 규칙으로 묶을 수 없다 (규칙은 아래 결제 전용).

resource "aws_prometheus_workspace" "payment" {
  alias = "${var.project}-payment"

  lifecycle {
    prevent_destroy = true
  }
}

# 메시지는 Chatbot 사용자 정의 알림 형식 (gitops kube-prometheus-stack chatbot.tmpl 과 같은 형식). Chatbot 은 이 JSON 이 아니면 버린다.
# 동적 값은 toJson 으로 escape 한 뒤 양 끝 따옴표를 뗀다. 시각은 UTC (tz 함수는 tzdata 가 없으면 알림이 실패할 수 있음)
resource "aws_prometheus_alert_manager_definition" "payment" {
  workspace_id = aws_prometheus_workspace.payment.id

  definition = yamlencode({
    template_files = {
      chatbot = <<-EOT
        {{ define "team04.chatbot.message" -}}
        {"version":"1.0","source":"custom","content":{"textType":"client-markdown",
        "title":"{{ if eq .Status "firing" }}:rotating_light: Prometheus 알림{{ else }}:white_check_mark: Prometheus 해소{{ end }} | {{ .CommonLabels.alertname | toJson | reReplaceAll `^"|"$` "" }}",
        "description":"
        {{- range .Alerts -}}
        {{ if eq .Status "firing" }}:red_circle:{{ else }}:large_green_circle:{{ end }} *{{ .Labels.severity | toJson | reReplaceAll `^"|"$` "" }}*
        {{- with .Labels.instance }} `{{ . | toJson | reReplaceAll `^"|"$` "" }}`{{ end }}
        {{- with .Labels.service }} `{{ . | toJson | reReplaceAll `^"|"$` "" }}`{{ end }}\n
        {{- or .Annotations.summary .Annotations.description | toJson | reReplaceAll `^"|"$` "" }}\n
        {{- end -}}
        *클러스터* payment (prod, AMP) · *시작* {{ (index .Alerts 0).StartsAt.Format "2006-01-02 15:04:05 MST" }}"},
        "metadata":{"summary":"Prometheus {{ .Status }} | {{ .CommonLabels.alertname | toJson | reReplaceAll `^"|"$` "" }}","eventType":"prometheus_alert"}}
        {{- end }}
      EOT
    }

    alertmanager_config = yamlencode({
      templates = ["chatbot"]
      route = {
        receiver        = "sns-alerts"
        group_by        = ["alertname", "instance"]
        group_wait      = "30s"
        group_interval  = "5m"
        repeat_interval = "12h"
      }
      receivers = [
        {
          name = "sns-alerts"
          sns_configs = [
            {
              topic_arn     = aws_sns_topic.alerts.arn
              sigv4         = { region = var.region }
              send_resolved = true
              message       = "{{ template \"team04.chatbot.message\" . }}"
            },
          ]
        },
      ]
    })
  })

  # 토픽 · 키 정책이 먼저 AMP 를 허용해야 첫 알림부터 발행된다
  depends_on = [aws_sns_topic_policy.alerts, aws_kms_key.notifications]
}

# 결제 서버 · 결제 DB 규칙. 라벨은 Alloy external_labels(cluster=payment)와 온프레미스와 같은 job 이름.
# absent() 규칙은 두지 않는다 — 매일 destroy 하면 지표가 끊겨 매일 밤 울린다. 결제 서버 자체의 장애는
# 90 의 결제 NLB unhealthy 알람(CloudWatch)이 알린다
resource "aws_prometheus_rule_group_namespace" "payment" {
  name         = "payment"
  workspace_id = aws_prometheus_workspace.payment.id

  data = yamlencode({
    groups = [
      {
        name = "payment-node"
        rules = [
          {
            alert  = "PaymentTargetDown"
            expr   = "up{cluster=\"payment\"} == 0"
            for    = "5m"
            labels = { severity = "warning" }
            annotations = {
              summary = "결제 서버 {{ $labels.instance }} 의 {{ $labels.job }} 수집이 5분 동안 실패했습니다 (Alloy → 127.0.0.1)"
            }
          },
          {
            alert  = "PaymentDbExporterDown"
            expr   = "mysql_up{cluster=\"payment\"} == 0"
            for    = "5m"
            labels = { severity = "critical" }
            annotations = {
              summary = "결제 서버 {{ $labels.instance }} 에서 결제 DB 에 5분 동안 접속하지 못했습니다 (mysql_up 0 — exporter 계정 · TLS · SG P3 확인)"
            }
          },
          {
            alert  = "PaymentHostDiskAlmostFull"
            expr   = "node_filesystem_avail_bytes{cluster=\"payment\", mountpoint=\"/\"} / node_filesystem_size_bytes{cluster=\"payment\", mountpoint=\"/\"} < 0.15"
            for    = "10m"
            labels = { severity = "warning" }
            annotations = {
              summary = "결제 서버 {{ $labels.instance }} 루트 디스크 남은 공간 15% 미만 (이미지 · 로그 확인)"
            }
          },
          {
            alert  = "PaymentHostMemoryLow"
            expr   = "node_memory_MemAvailable_bytes{cluster=\"payment\"} / node_memory_MemTotal_bytes{cluster=\"payment\"} < 0.10"
            for    = "10m"
            labels = { severity = "warning" }
            annotations = {
              summary = "결제 서버 {{ $labels.instance }} 사용 가능 메모리 10% 미만"
            }
          },
        ]
      },
    ]
  })
}
