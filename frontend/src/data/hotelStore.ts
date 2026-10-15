import { useSyncExternalStore } from 'react'
import { fetchHotels } from '../api/hotels'
import type { HotelInfo } from '../api/hotels'
import { HOTELS } from './hotels'
import type { Hotel } from './hotels'

// 호텔 정보 저장소. 처음에는 data/hotels.ts의 기본값으로 시작하고, 앱 시작 시 GET /api/hotels 응답이 오면
// hotelId로 맞춰 이름·소개·주소·전화번호를 DB 값으로 바꾼다 (관리자 화면에서 수정한 내용이 고객 화면에 반영됨).
// - id(주소용 slug)·사진·색은 DB에 없어 기본값을 그대로 쓴다. 그래서 기본값에 없는 호텔(관리자가 새로 등록)은
//   고객 화면에 나오지 않는다 — 사진·slug를 data/hotels.ts에 추가해야 한다.
// - API가 실패하면 기본값 그대로 보여준다 (backend가 없어도 호텔 화면은 깨지지 않음).
let hotels: Hotel[] = HOTELS
let loadStarted = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHotels(): Hotel[] {
  return hotels
}

// "서울 강남구 테헤란로 123" -> "서울 강남구" (카드·목록에 쓰는 짧은 위치 표시)
function shortLocation(address: string): string {
  return address.split(/\s+/).slice(0, 2).join(' ')
}

function merge(base: Hotel, info: HotelInfo): Hotel {
  const next: Hotel = {
    ...base,
    name: info.name,
    summary: info.description || base.summary,
    location: info.address ? shortLocation(info.address) : base.location,
    address: info.address,
    phoneNumber: info.phoneNumber,
  }
  // 값이 같으면 기존 객체를 그대로 써서, hotel을 의존성으로 쓰는 화면(객실 검색 등)이 다시 조회하지 않게 한다.
  const unchanged = (['name', 'summary', 'location', 'address', 'phoneNumber'] as const).every(
    (key) => next[key] === base[key],
  )
  return unchanged ? base : next
}

// 앱 시작 시 한 번만 호출한다 (App.tsx). 여러 번 불러도 요청은 한 번만 나간다.
export function loadHotels(): void {
  if (loadStarted) return
  loadStarted = true

  fetchHotels()
    .then((infos) => {
      const byId = new Map(infos.map((info) => [info.hotelId, info]))
      const next = hotels.map((hotel) => {
        const info = byId.get(hotel.hotelId)
        return info ? merge(hotel, info) : hotel
      })
      if (next.every((hotel, i) => hotel === hotels[i])) return
      hotels = next
      listeners.forEach((listener) => listener())
    })
    .catch(() => {
      // 실패해도 기본값으로 계속 보여준다. 다음 새로고침 때 다시 시도한다.
    })
}

// 호텔 목록을 화면에 그리는 컴포넌트용. API 응답이 오면 다시 렌더링된다.
export function useHotels(): Hotel[] {
  return useSyncExternalStore(subscribe, getHotels)
}
