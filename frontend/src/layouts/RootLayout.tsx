import { Outlet, useLocation } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import MobileDock from '../components/MobileDock'
import ChatWidget from '../components/ChatWidget'
import { customerAuth } from '../api/tokenStore'
import './RootLayout.css'

function RootLayout() {
  // 로그인 사용자가 바뀌면(로그아웃·다른 계정 로그인) 챗봇 위젯을 새로 그려 대화 내역을 지운다 — 같은 PC의 다음 사용자에게
  // 앞사람 대화가 보이지 않게 (LDP-154). 토큰 자동 갱신은 사용자가 같아서 대화가 유지된다.
  const user = customerAuth.useUser()
  // 로그아웃처럼 상태가 바뀐 이동은 location.state.notice로 안내를 받아, 짧은 안내 문구 + 화면이 새로 뜨는 효과를 준다
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  return (
    <div className="root-layout">
      <Header />
      {notice && (
        <div key={location.key} className="root-layout-toast" role="status">
          {notice}
        </div>
      )}
      <main key={notice ? location.key : 'main'} className={`root-layout-main${notice ? ' is-fresh' : ''}`}>
        <Outlet />
      </main>
      <Footer />
      <MobileDock />
      <ChatWidget key={user?.userId ?? 'guest'} />
    </div>
  )
}

export default RootLayout
