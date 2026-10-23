{{/* 공통 라벨 (dict "root" $ "name" <서비스 이름>) */}}
{{- define "backend.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: backend
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
{{- end -}}

{{/* selector 라벨 — Deployment 생성 후 바꿀 수 없으므로 최소한으로 */}}
{{- define "backend.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/*
이미지 참조 (dict "root" $ "image" <image 값>)
<global.imageRegistry>/<global.imageRepositoryPrefix><repository>:<tag | global.imageTag>
imageRegistry 는 tpl 로 렌더링 (prod: <계정 ID 템플릿>.dkr.ecr...)
태그가 비었거나 latest 면 렌더링을 중단 — 커밋 SHA 태그만 허용
*/}}
{{- define "backend.image" -}}
{{- $g := .root.Values.global -}}
{{- $tag := .image.tag | default $g.imageTag | toString -}}
{{- if not $tag -}}
{{- fail (printf "이미지 태그가 비어 있습니다 (%s): global.imageTag 를 커밋 SHA 로 지정하세요" .image.repository) -}}
{{- end -}}
{{- if eq $tag "latest" -}}
{{- fail "latest 태그는 사용할 수 없습니다 — 커밋 SHA 를 쓰세요" -}}
{{- end -}}
{{- $repo := printf "%s%s" ($g.imageRepositoryPrefix | default "") .image.repository -}}
{{- $registry := tpl ($g.imageRegistry | default "") .root -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}

{{/* imagePullSecrets 블록 */}}
{{- define "backend.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
GCP Workload Identity Federation (prod llm-service · llm-ingest — Terraform 14-gcp-llm).
파드 projected SA 토큰(aud = Provider)과 external_account 설정(credentials.json)을 한 projected 볼륨으로 넣고
GOOGLE_APPLICATION_CREDENTIALS 로 가리킨다 → google-auth 가 STS 교환 후 운영 GCP 서비스 계정을 impersonate (키 없음)
*/}}
{{- define "backend.gcpWif.env" -}}
- name: GOOGLE_APPLICATION_CREDENTIALS
  value: {{ printf "%s/credentials.json" .Values.gcpWorkloadIdentity.mountPath | quote }}
{{- end -}}

{{- define "backend.gcpWif.volumeMount" -}}
- name: gcp-workload-identity
  mountPath: {{ .Values.gcpWorkloadIdentity.mountPath }}
  readOnly: true
{{- end -}}

{{- define "backend.gcpWif.volume" -}}
- name: gcp-workload-identity
  projected:
    sources:
      - serviceAccountToken:
          audience: {{ required "gcpWorkloadIdentity.audience 가 필요합니다 (Terraform 14-gcp-llm output workload_identity_audience)" .Values.gcpWorkloadIdentity.audience | quote }}
          expirationSeconds: {{ .Values.gcpWorkloadIdentity.tokenExpirationSeconds }}
          path: token
      - configMap:
          name: gcp-workload-identity
          items:
            - key: credentials.json
              path: credentials.json
{{- end -}}
