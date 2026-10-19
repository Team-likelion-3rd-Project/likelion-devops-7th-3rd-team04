// 챗봇 답변에 붙는 "액션 카드" 데이터를 백엔드 입구에서 거르는 검증기입니다.
//
// n8n → llm-service가 돌려주는 intent/action은 사용자가 쓴 텍스트를 LLM이 가공한 결과라, 프롬프트
// 인젝션이 성공하면 어떤 JSON이든 올 수 있습니다. 그래서 사용자 입력과 같은 수준으로 믿지 않고 여기서
// 화이트리스트로 다시 거릅니다 (llm-service에서도 거르지만 이중 방어).
//
// - 액션은 "제안"일 뿐이고 실제 예약·결제·취소는 프론트가 사용자 JWT로 기존 API를 호출해서 합니다.
// - 예약 ID·금액·URL 같은 값은 통과시키지 않습니다. 결제·취소 대상은 프론트가 본인 예약을 직접 조회합니다.
// - 비로그인(userId 0)이면 액션을 모두 버리고, 의도가 있었을 때만 LOGIN_REQUIRED로 바꿉니다.
//   LOGIN_REQUIRED는 여기서만 만들 수 있습니다(LLM이 보내면 버림).
// - 규칙에 맞지 않으면 예외 없이 null을 돌려줍니다 — 액션이 깨졌다고 답변까지 실패시키지 않습니다.

export type ChatIntent = 'BOOK' | 'PAY' | 'CANCEL';

// proto의 ChatAction과 1:1 대응. 문자열 ''·숫자 0은 "값 없음"입니다(proto3 기본값과 같은 약속).
export interface ChatAction {
  type: ChatIntent | 'LOGIN_REQUIRED';
  hotel: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

const INTENTS: readonly string[] = ['BOOK', 'PAY', 'CANCEL'];

// frontend/src/data/hotels.ts의 문자열 id(slug)와 같아야 합니다.
const HOTEL_SLUGS: readonly string[] = ['seoul', 'busan', 'jeju'];

const MAX_ADVANCE_DAYS = 365;
const MAX_ADULTS = 10;
const MAX_CHILDREN = 10;
const DEFAULT_ADULTS = 2;
const MAX_ROOM_NAME_LENGTH = 50;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_FIELDS = {
  hotel: '',
  roomName: '',
  checkIn: '',
  checkOut: '',
  adults: 0,
  children: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntent(value: unknown): value is ChatIntent {
  return typeof value === 'string' && INTENTS.includes(value);
}

function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// 실제로 존재하는 YYYY-MM-DD인지 확인합니다(2026-02-30 같은 값은 Date가 다음 달로 넘겨 버려서 왕복 비교).
function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && toIsoDate(parsed) === value;
}

function intInRange(value: unknown, min: number, max: number): number | null {
  return Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
    ? (value as number)
    : null;
}

function sanitizeBook(
  raw: Record<string, unknown>,
  now: Date,
): ChatAction | null {
  const { hotel, checkIn, checkOut, roomName, adults, children } = raw;
  if (typeof hotel !== 'string' || !HOTEL_SLUGS.includes(hotel)) return null;
  if (!isValidIsoDate(checkIn) || !isValidIsoDate(checkOut)) return null;

  // ISO 날짜 문자열은 사전순 비교가 곧 날짜 비교입니다.
  const today = toIsoDate(now.getTime() + KST_OFFSET_MS);
  const lastBookableDay = toIsoDate(
    Date.parse(`${today}T00:00:00Z`) + MAX_ADVANCE_DAYS * DAY_MS,
  );
  if (!(
    today <= checkIn &&
    checkIn < checkOut &&
    checkOut <= lastBookableDay
  )) {
    return null;
  }

  const trimmedRoomName = typeof roomName === 'string' ? roomName.trim() : '';
  return {
    type: 'BOOK',
    hotel,
    // 실제 객실인지는 프론트가 자기 호텔 데이터와 대조합니다(없으면 객실 선택 단계로 보냄).
    roomName:
      trimmedRoomName.length <= MAX_ROOM_NAME_LENGTH ? trimmedRoomName : '',
    checkIn,
    checkOut,
    adults: intInRange(adults, 1, MAX_ADULTS) ?? DEFAULT_ADULTS,
    children: intInRange(children, 0, MAX_CHILDREN) ?? 0,
  };
}

export function sanitizeChatAction(
  rawAction: unknown,
  rawIntent: unknown,
  userId: number,
  now: Date = new Date(),
): ChatAction | null {
  if (!userId) {
    return isIntent(rawIntent)
      ? { type: 'LOGIN_REQUIRED', ...EMPTY_FIELDS }
      : null;
  }
  if (!isRecord(rawAction)) return null;

  const { type } = rawAction;
  if (type === 'PAY' || type === 'CANCEL') {
    // 다른 필드(예약 ID 등)는 전부 버리고 type만 남깁니다.
    return { type, ...EMPTY_FIELDS };
  }
  if (type === 'BOOK') {
    return sanitizeBook(rawAction, now);
  }
  return null;
}
