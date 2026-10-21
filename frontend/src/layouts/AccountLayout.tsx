import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { fetchMyBookings, isUnauthorized, refreshAccessToken } from '../api/gateway'
import './AccountLayout.css'

// 마이페이지/예약 내역/결제 내역처럼 "내 정보"에 속한 페이지들이 공유하는 좌측 사이드바.
// 이 그룹 안에서는 메인 페이지를 거치지 않고 서로 바로 이동할 수 있다.
const ACCOUNT_NAV_GROUPS = [
  {
    label: '내정보 관리',
    items: [
      { to: '/mypage', label: '내 정보 수정' },
      { to: '/mypage/password', label: '비밀번호 변경' },
      { to: '/mypage/withdraw', label: '회원탈퇴' },
    ],
  },
  {
    label: '예약 현황',
    items: [{ to: '/mypage/reservations', label: '예약내역' }],
  },
  {
    label: '결제',
    items: [
      { to: '/mypage/payments/pending', label: '결제대기' },
      { to: '/mypage/payments', label: '결제내역' },
    ],
  },
]

function AccountLayout() {
  const location = useLocation()

  // 결제 대기(PENDING_PAYMENT) 예약 개수 — 사이드바의 "결제대기" 항목 옆 뱃지용.
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const countPending = (bookings: Awaited<ReturnType<typeof fetchMyBookings>>) =>
      bookings.filter((b) => b.status === 'PENDING_PAYMENT').length

    const load = async () => {
      try {
        const bookings = await fetchMyBookings()
        if (!cancelled) setPendingCount(countPending(bookings))
      } catch (err) {
        // fetchMyBookings()는 429 등을 이미 내부에서 예산껏 재시도했다. 진짜 401이 아니면 재발급을
        // 또 시도하지 않는다 — 뱃지는 부가 정보라 실패하면 조용히 숨긴다.
        if (!isUnauthorized(err)) {
          if (!cancelled) setPendingCount(null)
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다. 뱃지는 부가 정보라
        // 재시도까지 실패하면 조용히 숨긴다(로그인 여부는 각 페이지가 자체적으로 처리한다).
        try {
          await refreshAccessToken()
          const bookings = await fetchMyBookings()
          if (!cancelled) setPendingCount(countPending(bookings))
        } catch {
          if (!cancelled) setPendingCount(null)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // 마이페이지 구역 안에서 페이지를 이동할 때마다(결제 후 다른 페이지로 이동 등) 새로 세어
    // 뱃지가 최신 상태를 유지하도록 pathname을 의존성에 둔다.
  }, [location.pathname])

  return (
    <section className="account-layout">
      <aside className="account-sidebar">
        <h1 className="account-sidebar-title">마이페이지</h1>
        <nav aria-label="내 정보 메뉴">
          {ACCOUNT_NAV_GROUPS.map((group) => (
            <div className="account-nav-group" key={group.label}>
              <h2 className="account-nav-group-label">{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    {/* end를 반드시 줘야 한다: /mypage와 /mypage/password처럼 경로가 겹치는
                        항목들이 있어서, end 없이는 상위 경로(/mypage)가 하위 경로에서도 함께
                        active로 표시된다. */}
                    <NavLink to={item.to} end className={({ isActive }) => (isActive ? 'active' : undefined)}>
                      <span>{item.label}</span>
                      {item.to === '/mypage/payments/pending' && !!pendingCount && (
                        <span className="account-nav-badge">{pendingCount}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="account-content">
        <Outlet />
      </div>
    </section>
  )
}

export default AccountLayout
