// 예약 플로우 4단계. ReservationPage(1단계)/RoomSelectionPage(2단계) 등 플로우 내 모든
// 페이지가 상단에 공통으로 띄우는 진행 표시라 컴포넌트로 공유한다.
export const RESERVATION_STEPS = ['호텔/날짜/투숙인원 선택', '객실 선택', '옵션 선택', '예약 완료'] as const
