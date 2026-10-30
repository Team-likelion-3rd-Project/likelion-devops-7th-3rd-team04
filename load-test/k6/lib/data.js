// 테스트 데이터 선택 — 호텔 · 객실 · 날짜 · 사용자 · 생각 시간
import { sleep } from 'k6';
import {
  THINK_MIN,
  THINK_MAX,
  NEAR_RATIO,
  NEAR_DAYS,
  FAR_DAYS,
  MAX_NIGHTS,
} from './config.js';

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// 'YYYY-MM-DD' (한국 날짜 기준 — 서버가 체크인 오늘/내일을 한국 날짜로 판단)
function kstDate(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

// 체크인 · 체크아웃. 체크인은 내일부터 (오늘 체크인은 결제 마감이 30분이라 일부러 피함)
export function pickStay() {
  const offset = Math.random() < NEAR_RATIO ? randInt(1, NEAR_DAYS) : randInt(NEAR_DAYS + 1, FAR_DAYS);
  const nights = randInt(1, MAX_NIGHTS);
  return { checkIn: kstDate(offset), checkOut: kstDate(offset + nights), lastNight: kstDate(offset + nights - 1) };
}

// 화면 사이 생각 시간
export function think() {
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

// 사용자 토큰 — 같은 VU 는 같은 사용자를 쓴다 (실제 사용자처럼 한 사람의 예약이 쌓이도록)
export function userFor(data, vu) {
  return data.users[(vu - 1) % data.users.length];
}
