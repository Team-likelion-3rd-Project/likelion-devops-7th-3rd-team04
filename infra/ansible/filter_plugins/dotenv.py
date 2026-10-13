# backend/.env 같은 dotenv 파일을 dict 로 파싱하는 필터.
# DB 노드가 backend 와 같은 .env 를 단일 소스로 쓰기 위해 사용합니다.
#   {{ lookup('file', path) | parse_dotenv }}
#
# 지원: KEY=VALUE, export KEY=VALUE, '...' / "..." 따옴표, 공백 뒤의 인라인 '# 주석'
# (따옴표 없는 값 안의 '#' 은 앞에 공백이 없으면 값의 일부로 취급 — docker compose 와 동일)
import re

_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_INLINE_COMMENT = re.compile(r"\s+#.*$")


def parse_dotenv(text):
    result = {}
    for raw in (text or "").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _LINE.match(raw)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if value[:1] in ("'", '"'):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            value = _INLINE_COMMENT.sub("", value).strip()
        result[key] = value
    return result


class FilterModule(object):
    def filters(self):
        return {"parse_dotenv": parse_dotenv}
