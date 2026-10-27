import { Suspense, lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import ScrollToTop from './components/ScrollToTop'
import ErrorBoundary from './components/ErrorBoundary'
import RootLayout from './layouts/RootLayout'
import HotelLayout from './layouts/HotelLayout'
import AccountLayout from './layouts/AccountLayout'
import MainPage from './pages/MainPage'
import PhilosophyPage from './pages/PhilosophyPage'
import HotelsPage from './pages/HotelsPage'
import HotelDetailPage from './pages/HotelDetailPage'
import HotelStayPage from './pages/HotelStayPage'
import RoomDetailPage from './pages/RoomDetailPage'
import HotelWatersPage from './pages/HotelWatersPage'
import NoticesPage from './pages/NoticesPage'
import ReservationPage from './pages/ReservationPage'
import RoomSelectionPage from './pages/RoomSelectionPage'
import ReservationOptionsPage from './pages/ReservationOptionsPage'
import ReservationCompletePage from './pages/ReservationCompletePage'
import PaymentSuccessPage from './pages/PaymentSuccessPage'
import PaymentFailPage from './pages/PaymentFailPage'
import ReservationHistoryPage from './pages/ReservationHistoryPage'
import ReservationDetailPage from './pages/ReservationDetailPage'
import MyPage from './pages/MyPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import WithdrawPage from './pages/WithdrawPage'
import PaymentsPage from './pages/PaymentsPage'
import PaymentsPendingPage from './pages/PaymentsPendingPage'
import PaymentDetailPage from './pages/PaymentDetailPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import NotFoundPage from './pages/NotFoundPage'
import ErrorPage from './pages/ErrorPage'
import { refreshAccessToken } from './api/gateway'
import { loadHotels } from './data/hotelStore'

// 고객 프론트와 완전히 독립된 관리자 화면. 별도 청크로 code splitting되도록 lazy import한다.
const AdminApp = lazy(() => import('./admin/AdminApp'))

function App() {
  const location = useLocation()

  useEffect(() => {
    // 액세스 토큰은 메모리에만 두므로 새로고침하면 사라진다. httpOnly 리프레시 토큰 쿠키가
    // 남아있다면 앱 부팅 시 조용히 재발급받아 로그인 상태를 복구한다 (없거나 만료됐으면 그냥 비로그인 상태).
    refreshAccessToken().catch(() => {})
    // 호텔 이름·소개 등을 DB 값으로 갱신한다 (실패하면 data/hotels.ts 기본값 유지).
    loadHotels()
  }, [])

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<MainPage />} />
          <Route path="philosophy/:slug" element={<PhilosophyPage />} />
          <Route path="hotels" element={<HotelsPage />} />
          <Route path="hotels/:hotelId" element={<HotelLayout />}>
            <Route index element={<HotelDetailPage />} />
            <Route path="stay" element={<HotelStayPage />} />
            <Route path="rooms/:roomId" element={<RoomDetailPage />} />
            <Route path="waters" element={<HotelWatersPage />} />
          </Route>
          <Route path="notices" element={<NoticesPage />} />
          {/* 예약하기(신규 예약 플로우)는 사이드바 없는 일반 페이지로 둔다. */}
          <Route path="reservation" element={<ReservationPage />} />
          <Route path="reservation/rooms" element={<RoomSelectionPage />} />
          <Route path="reservation/options" element={<ReservationOptionsPage />} />
          <Route path="reservation/complete/:reservationId" element={<ReservationCompletePage />} />
          {/* 결제 결과 화면. 토스 결제창의 성공·실패 URL로 쓰이며, MOCK도 같은 성공 화면에서 승인을 요청한다. */}
          <Route path="reservation/payment/success" element={<PaymentSuccessPage />} />
          <Route path="reservation/payment/fail" element={<PaymentFailPage />} />
          {/* 예약 내역/마이페이지/결제 내역은 서로 사이드바로 바로 이동할 수 있도록 한 그룹으로 묶는다. */}
          <Route element={<AccountLayout />}>
            <Route path="mypage" element={<MyPage />} />
            <Route path="mypage/password" element={<ChangePasswordPage />} />
            <Route path="mypage/withdraw" element={<WithdrawPage />} />
            <Route path="mypage/reservations" element={<ReservationHistoryPage />} />
            <Route path="mypage/reservations/:reservationId" element={<ReservationDetailPage />} />
            <Route path="mypage/payments" element={<PaymentsPage />} />
            <Route path="mypage/payments/pending" element={<PaymentsPendingPage />} />
            <Route path="mypage/payments/:paymentId" element={<PaymentDetailPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          {/* 위에 없는 주소는 모두 404 안내 (LDP-158) */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* RootLayout 바깥의 형제 라우트: 고객용 Header/Footer/MobileDock을 렌더링하지 않는
            완전히 독립된 레이아웃 + 별도 라우트 네임스페이스(/admin/*)를 갖는다. */}
        <Route
          path="/admin/*"
          element={
            // 새 버전 배포 직후 예전 관리자 화면 파일을 못 불러오면 하얀 화면 대신 안내한다 (LDP-158)
            <ErrorBoundary resetKey={location.pathname} fallback={<ErrorPage />}>
              <Suspense fallback={null}>
                <AdminApp />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Routes>
    </>
  )
}

export default App
