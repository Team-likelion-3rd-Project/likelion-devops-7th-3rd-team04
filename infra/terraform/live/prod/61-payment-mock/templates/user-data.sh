#!/bin/bash
# pg-mock 인스턴스 최소 부트스트랩 (LDP-115). 진행 · 실패 로그는 /var/log/cloud-init-output.log
# docker 설치까지 한다 (AL2023 저장소, S3 게이트웨이 엔드포인트 경유). pg-mock 컨테이너 배포는 LDP-116.
set -Eeuo pipefail

echo "[bootstrap] docker 설치"
dnf install -y -q docker
systemctl enable --now docker

echo "[bootstrap] 완료"
