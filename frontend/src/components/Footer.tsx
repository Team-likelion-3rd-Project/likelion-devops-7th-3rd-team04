import BrandLogo from './BrandLogo'
import './Footer.css'

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        {/* TODO: 실제 상호/사업자 정보로 교체 */}
        <p className="footer-brand">
          <BrandLogo />
        </p>
        <ul className="footer-links">
          <li>
            <a href="#">이용약관</a>
          </li>
          <li>
            <a href="#">개인정보처리방침</a>
          </li>
          <li>
            <a href="#">고객센터</a>
          </li>
        </ul>
      </div>

      <div className="footer-bottom">
        <address className="footer-info">
          상호: 머묾(MEOMULM) · 대표: OOO · 사업자등록번호: 000-00-00000
          <br />
          주소: 서울특별시 OO구 OO로 00 · 고객센터: 1588-0000
        </address>

        {/* TODO: 실제 소셜 채널 링크로 교체 */}
        <ul className="footer-social">
          <li>
            <a href="#" aria-label="Instagram">
              IG
            </a>
          </li>
          <li>
            <a href="#" aria-label="YouTube">
              YT
            </a>
          </li>
          <li>
            <a href="#" aria-label="Blog">
              Blog
            </a>
          </li>
        </ul>
      </div>

      <p className="footer-copyright">&copy; {new Date().getFullYear()} MEOMULM (Team 04). All rights reserved.</p>
    </footer>
  )
}

export default Footer
