#!/usr/bin/env bash
# destroy 뒤 남은 PVC EBS 볼륨 삭제 (nodes.tf terraform_data.pvc_volume_cleanup, LDP-248).
#
# 클러스터를 통째로 지우면 PVC 보존 정책(whenDeleted: Delete)이 동작하기 전에 EBS CSI 컨트롤러도 사라져 볼륨이 남는다.
# 클러스터가 지워진 뒤(노드가 없어 볼륨이 떨어진 상태) 이 namespace 의 PVC 로 EBS CSI 가 만든 볼륨만 지운다.
#   - 대상: PVC 로 만들어진 볼륨 태그(kubernetes.io/created-for/pv/name 있음 + kubernetes.io/created-for/pvc/namespace=<namespace>) + 상태 available
#     (11-06 남은 Prometheus 볼륨에서 확인한 태그)
#   - 실패해도 destroy 를 막지 않는다 (남은 볼륨은 경고로 알리고 수동 삭제)
#
# 사용: cleanup-pvc-volumes.sh <region> <namespace>
set -uo pipefail

region="${1:?region}"
namespace="${2:?namespace}"

list() {
  aws ec2 describe-volumes --region "$region" \
    --filters "Name=tag-key,Values=kubernetes.io/created-for/pv/name" \
              "Name=tag:kubernetes.io/created-for/pvc/namespace,Values=${namespace}" \
              "Name=status,Values=$1" \
    --query 'Volumes[].VolumeId' --output text
}

# 노드 종료 직후 볼륨이 detaching 일 수 있어 잠깐 기다린다 (최대 약 3분)
for _ in $(seq 1 18); do
  [ -z "$(list in-use,detaching)" ] && break
  sleep 10
done

ids=$(list available)
if [ -z "$ids" ]; then
  echo "[pvc-cleanup] ${namespace} PVC 볼륨 없음"
  exit 0
fi

for id in $ids; do
  if aws ec2 delete-volume --region "$region" --volume-id "$id"; then
    echo "[pvc-cleanup] 삭제: $id"
  else
    echo "[pvc-cleanup] 경고: $id 삭제 실패 — 수동으로 지운다 (aws ec2 delete-volume --volume-id $id)" >&2
  fi
done

left=$(list in-use,detaching)
[ -n "$left" ] && echo "[pvc-cleanup] 경고: 아직 붙어 있는 볼륨 $left — 수동 확인" >&2
exit 0
