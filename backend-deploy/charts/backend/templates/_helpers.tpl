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
{{- if $g.imageRegistry -}}
{{- printf "%s/%s:%s" $g.imageRegistry $repo $tag -}}
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
