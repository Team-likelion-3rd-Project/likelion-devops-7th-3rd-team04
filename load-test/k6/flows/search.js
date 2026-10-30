// B. 검색 — 예약 가능 객실 검색 → 객실 상세 (2 요청)
import { check } from 'k6';
import { get, json, query } from '../lib/http.js';
import { pick, pickStay, think } from '../lib/data.js';

export function search(data) {
  const hotelId = pick(data.hotelIds);
  const { checkIn, checkOut } = pickStay();
  const res = get(
    `/api/hotels/${hotelId}/rooms/search?${query({ checkIn, checkOut, guests: 2 })}`,
    'GET /hotels/:id/rooms/search',
    'read',
  );
  const results = (json(res) || {}).results || [];
  check(res, { 'B 검색 200': (r) => r.status === 200 });
  think();

  // 검색 결과가 없으면(전부 매진) 수집해 둔 객실 중 하나를 본다 — 요청 수를 흐름 정의(2)와 맞추려고
  let room;
  if (results.length > 0) {
    room = pick(results).room;
  } else {
    const inHotel = data.rooms.filter((r) => r.hotelId === hotelId);
    room = pick(inHotel.length > 0 ? inHotel : data.rooms);
  }
  const detail = get(`/api/hotels/${room.hotelId}/rooms/${room.roomId}`, 'GET /hotels/:id/rooms/:id', 'read');
  check(detail, { 'B 객실 상세 200': (r) => r.status === 200 });
}
