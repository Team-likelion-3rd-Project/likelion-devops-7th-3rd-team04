// hotel-service 조회 캐시 키 (ReadCache, Valkey). 읽는 곳과 무효화하는 곳이 같은 키를 쓰도록 한곳에 모은다.
//
//  키                            채우는 곳                       무효화하는 곳
//  hotels, hotel:{id}            GetHotels, GetHotel             UpdateHotel
//  hotel:{id}:rooms              GetRooms, SearchRooms           Create/Update/DeleteRoom, 호실 추가·점검(보유 수량)
//  hotel:{id}:room:{roomId}      GetRoom, GetRoomAvailability    Update/DeleteRoom, 호실 추가·점검(보유 수량)
//  hotel:{id}:facilities         GetFacilities                   CreateFacility
//  notices:{ver}:..., notice:{id}  ListNotices, GetNotice        Create/Update/DeleteNotice (목록은 버전을 올림)
//
// 날짜별 재고(room_availabilities)는 예약·취소마다 바뀌어 캐시하지 않는다 — SearchRooms · GetRoomAvailability 도
// 객실 종류만 캐시에서 읽고 재고는 매번 DB 에서 읽는다.
export const HotelCacheKeys = {
  hotels: () => 'hotels',
  hotel: (hotelId: number) => `hotel:${hotelId}`,
  rooms: (hotelId: number) => `hotel:${hotelId}:rooms`,
  room: (hotelId: number, roomId: number) => `hotel:${hotelId}:room:${roomId}`,
  facilities: (hotelId: number) => `hotel:${hotelId}:facilities`,
  noticeVersion: () => 'notices:version',
  notices: (version: string, hotelId: number, page: number, size: number) =>
    `notices:${version}:hotel:${hotelId}:page:${page}:size:${size}`,
  notice: (noticeId: number) => `notice:${noticeId}`,
};

// 객실 종류 하나가 바뀌면 그 호텔의 객실 목록과 객실 단건을 함께 지운다
export function roomCacheKeys(hotelId: number, roomId: number): string[] {
  return [HotelCacheKeys.rooms(hotelId), HotelCacheKeys.room(hotelId, roomId)];
}
