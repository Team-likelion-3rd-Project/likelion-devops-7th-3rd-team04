// A. 둘러보기 (비회원) — 호텔 목록 → 호텔 상세 → 객실 목록 → 객실 가용성 (4 요청)
import { check } from 'k6';
import { get, json, query } from '../lib/http.js';
import { pick, pickStay, think } from '../lib/data.js';

export function browse(data) {
  const list = get('/api/hotels', 'GET /hotels', 'read');
  const hotels = (json(list) || {}).hotels || [];
  check(list, { 'A 호텔 목록 200': (r) => r.status === 200 && hotels.length > 0 });
  const hotelId = hotels.length > 0 ? pick(hotels).hotelId : pick(data.hotelIds);
  think();

  const detail = get(`/api/hotels/${hotelId}`, 'GET /hotels/:id', 'read');
  check(detail, { 'A 호텔 상세 200': (r) => r.status === 200 });
  think();

  const roomsRes = get(`/api/hotels/${hotelId}/rooms`, 'GET /hotels/:id/rooms', 'read');
  const rooms = (json(roomsRes) || {}).rooms || [];
  check(roomsRes, { 'A 객실 목록 200': (r) => r.status === 200 && rooms.length > 0 });
  if (rooms.length === 0) return;
  think();

  const { checkIn, lastNight } = pickStay();
  const roomId = pick(rooms).roomId;
  const avail = get(
    `/api/hotels/${hotelId}/rooms/${roomId}/availability?${query({ startDate: checkIn, endDate: lastNight })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'read',
  );
  check(avail, { 'A 가용성 200': (r) => r.status === 200 });
}
