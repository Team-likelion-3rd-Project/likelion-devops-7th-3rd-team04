-- 같은 서비스 안 FK 5개 추가 (ERD 위키 "FK 관계" 1~5번).
-- 서비스 경계를 넘는 참조(reservations.user_id -> users.id 등)는 원칙대로 FK를 걸지 않는다.

-- 1. rooms.hotel_id -> hotels.hotelId (객실이 남아있는 호텔은 삭제 불가)
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_hotel
  FOREIGN KEY (hotel_id) REFERENCES hotels (hotelId)
  ON DELETE RESTRICT;

-- 2. facilities.hotel_id -> hotels.hotelId (시설이 남아있는 호텔은 삭제 불가)
ALTER TABLE facilities
  ADD CONSTRAINT fk_facilities_hotel
  FOREIGN KEY (hotel_id) REFERENCES hotels (hotelId)
  ON DELETE RESTRICT;

-- 3. room_images.room_id -> rooms.roomId (객실 삭제 시 사진도 같이 삭제)
ALTER TABLE room_images
  ADD CONSTRAINT fk_room_images_room
  FOREIGN KEY (room_id) REFERENCES rooms (roomId)
  ON DELETE CASCADE;

-- 4. room_availabilities.room_id -> rooms.roomId (객실 삭제 시 재고도 같이 삭제)
ALTER TABLE room_availabilities
  ADD CONSTRAINT fk_room_availabilities_room
  FOREIGN KEY (room_id) REFERENCES rooms (roomId)
  ON DELETE CASCADE;

-- 5. reservation_facilities.reservation_id -> reservations.reservationId (예약은 금전 기록, 삭제 불가)
ALTER TABLE reservation_facilities
  ADD CONSTRAINT fk_reservation_facilities_reservation
  FOREIGN KEY (reservation_id) REFERENCES reservations (reservationId)
  ON DELETE RESTRICT;
