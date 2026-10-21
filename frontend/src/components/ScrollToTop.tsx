import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** react-router는 페이지 전환 시 스크롤 위치를 유지하므로, 매 라우트 변경마다 최상단으로 되돌린다. */
function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

export default ScrollToTop
