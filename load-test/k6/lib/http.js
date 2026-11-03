// HTTP 호출 공통 — 태그 규칙
//   name : 요청 묶음 이름 (경로의 ID 를 :id 로 묶어 지표가 URL 수만큼 쪼개지지 않게)
//   kind : SLO 그룹. read = 흐름 A · B · D (p95 < 300ms), write = 흐름 C (p95 < 1s),
//          poll = 예약 확정 지연 표본 재조회, setup = setup() 로그인 · 목록 수집 (둘 다 SLO 제외)
import http from 'k6/http';
import { BASE_URL } from './config.js';

function params(name, kind, token, extra) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return Object.assign({ headers, tags: { name, kind } }, extra || {});
}

export function get(path, name, kind, token, extra) {
  return http.get(`${BASE_URL}${path}`, params(name, kind, token, extra));
}

export function post(path, body, name, kind, token, extra) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), params(name, kind, token, extra));
}

// 응답 본문 JSON. 실패하면 null (check 에서 걸러진다)
export function json(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}

export function query(obj) {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`)
    .join('&');
}
