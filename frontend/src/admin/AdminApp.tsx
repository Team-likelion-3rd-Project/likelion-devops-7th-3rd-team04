import { Route, Routes } from 'react-router-dom'
import AdminGuard, { AdminAreaRoute } from './AdminGuard'
import AdminLayout from './layouts/AdminLayout'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminUserDetailPage from './pages/AdminUserDetailPage'
import AdminHotelsPage from './pages/AdminHotelsPage'
import AdminHotelDetailPage from './pages/AdminHotelDetailPage'
import AdminRoomDetailPage from './pages/AdminRoomDetailPage'
import AdminRoomAssignmentsPage from './pages/AdminRoomAssignmentsPage'
import AdminReservationsPage from './pages/AdminReservationsPage'
import AdminNoticesPage from './pages/AdminNoticesPage'
import { AdminNotFound } from './components/AdminStatusCard'

// /admin/* 전용 서브 라우터. 고객 프론트의 라우트 트리와 분리되어 있고,
// App.tsx에서 React.lazy로만 불러오므로 별도 청크로 코드 스플리팅된다.
function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginPage />} />
      <Route element={<AdminGuard />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          {/* 직급별 메뉴 (LDP-184) — 회원은 본사만, 호텔·객실·공지는 본사·지점 관리자 */}
          <Route element={<AdminAreaRoute area="users" />}>
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="users/:userId" element={<AdminUserDetailPage />} />
          </Route>
          <Route element={<AdminAreaRoute area="hotels" />}>
            <Route path="hotels" element={<AdminHotelsPage />} />
            <Route path="hotels/:hotelId" element={<AdminHotelDetailPage />} />
            <Route path="hotels/:hotelId/rooms/:roomId" element={<AdminRoomDetailPage />} />
          </Route>
          <Route path="room-assignments" element={<AdminRoomAssignmentsPage />} />
          <Route path="reservations" element={<AdminReservationsPage />} />
          <Route element={<AdminAreaRoute area="notices" />}>
            <Route path="notices" element={<AdminNoticesPage />} />
          </Route>
          <Route path="*" element={<AdminNotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default AdminApp
