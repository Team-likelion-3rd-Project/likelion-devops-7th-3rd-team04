#!/bin/bash
# Helm post-renderer. 렌더 결과의 Deployment · DaemonSet 에 hostNetwork: true 를 넣는다.
# CCM · NTH(큐 모드) 차트는 hostNetwork 값을 지원하지 않는데, 노드 IMDS hop limit 이 1 이라
# 파드 네트워크에서는 CP Role 자격 증명을 얻지 못한다
set -euo pipefail

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

cat > "$dir/rendered.yaml"
cat > "$dir/kustomization.yaml" <<'EOF'
resources:
  - rendered.yaml
patches:
  - target:
      kind: Deployment|DaemonSet
    patch: |-
      - op: add
        path: /spec/template/spec/hostNetwork
        value: true
EOF

kubectl kustomize "$dir"
