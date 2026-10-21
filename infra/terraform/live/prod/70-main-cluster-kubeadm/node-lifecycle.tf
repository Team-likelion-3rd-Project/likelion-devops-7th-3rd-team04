# 워커 종료 전 drain. AWS Node Termination Handler(NTH) 큐 모드가 받는 이벤트 경로를 만든다.
#
#   워커 ASG 종료 lifecycle hook ─┐
#   EC2 상태 변경 (stopping 등)  ──┼─ EventBridge ─▶ SQS ─▶ NTH (CP, hostNetwork) ─ cordon · drain ─▶ CompleteLifecycleAction
#   Spot 중단 · 리밸런스          ─┘
#
# NTH 설치는 CP-a 부트스트랩(aws_node_lifecycle role) 이 한다. 큐 URL 은 CP extra vars 로 넘긴다.
# NTH 는 aws-node-termination-handler/managed 태그가 있는 인스턴스(워커) 만 drain 한다.

resource "aws_sqs_queue" "nth" {
  name                      = "${local.name}-nth"
  message_retention_seconds = 300 # 5분 넘게 처리 못 한 이벤트는 의미가 없다 (lifecycle hook 은 그 전에 timeout)
  sqs_managed_sse_enabled   = true
}

locals {
  # NTH 문서의 큐 모드 이벤트. ASG lifecycle 은 워커 ASG 로 좁힌다
  nth_event_patterns = {
    asg-terminate = {
      source      = ["aws.autoscaling"]
      detail-type = ["EC2 Instance-terminate Lifecycle Action"]
      detail      = { AutoScalingGroupName = [aws_autoscaling_group.worker.name] }
    }
    # 계정의 모든 인스턴스가 대상이라(다른 팀 공유 계정) NTH 가 처리하는 상태만 보낸다
    instance-state-change = {
      source      = ["aws.ec2"]
      detail-type = ["EC2 Instance State-change Notification"]
      detail      = { state = ["stopping", "stopped", "shutting-down", "terminated"] }
    }
    spot = {
      source      = ["aws.ec2"]
      detail-type = ["EC2 Spot Instance Interruption Warning", "EC2 Instance Rebalance Recommendation"]
    }
  }
}

resource "aws_cloudwatch_event_rule" "nth" {
  for_each = local.nth_event_patterns

  name          = "${local.name}-nth-${each.key}"
  event_pattern = jsonencode(each.value)
}

resource "aws_cloudwatch_event_target" "nth" {
  for_each = local.nth_event_patterns

  rule = aws_cloudwatch_event_rule.nth[each.key].name
  arn  = aws_sqs_queue.nth.arn
}

# 위 규칙만 큐에 보낼 수 있다
data "aws_iam_policy_document" "nth_queue" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.nth.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [for r in aws_cloudwatch_event_rule.nth : r.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "nth" {
  queue_url = aws_sqs_queue.nth.id
  policy    = data.aws_iam_policy_document.nth_queue.json
}

# 종료 대상 워커를 Terminating:Wait 에 잡아 둔다. NTH 가 drain 후 완료하고, 응답이 없으면 timeout 뒤 그대로 종료한다.
# ASG 와 별도 리소스라 destroy 때 ASG 보다 먼저 지워져 워커 종료가 hook 에 막히지 않는다
resource "aws_autoscaling_lifecycle_hook" "worker_terminate" {
  name                   = "${local.name}-worker-terminate"
  autoscaling_group_name = aws_autoscaling_group.worker.name
  lifecycle_transition   = "autoscaling:EC2_INSTANCE_TERMINATING"
  heartbeat_timeout      = 300 # NTH drain 최대 120초(nodeTerminationGracePeriod) + 여유
  default_result         = "CONTINUE"
}
