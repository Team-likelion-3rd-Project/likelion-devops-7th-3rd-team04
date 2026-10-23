import logoGold from '../assets/images/brand/logo-gold.png'
import logoDark from '../assets/images/brand/logo-dark.png'
import './BrandLogo.css'

// 머묾 로고 (심볼 + 머묾 + MEOMULM). 어두운 화면은 금색, 밝은 화면은 진한 갈색 — 높이는 감싸는 요소를 따른다.
function BrandLogo() {
  return (
    <>
      <img className="brand-logo is-on-light" src={logoDark} alt="머묾 MEOMULM" />
      <img className="brand-logo is-on-dark" src={logoGold} alt="머묾 MEOMULM" />
    </>
  )
}

export default BrandLogo
