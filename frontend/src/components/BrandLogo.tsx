import logoGold from '../assets/images/brand/logo-gold.webp'
import logoDark from '../assets/images/brand/logo-dark.webp'
import './BrandLogo.css'

// 머묾 로고 (심볼 + 머묾 + MEOMULM). 어두운 화면은 금색, 밝은 화면은 진한 갈색 — 높이는 감싸는 요소를 따른다.
// width·height는 원본 크기 — 사진이 오기 전에 가로세로 비율만큼 자리를 잡아 화면이 밀리지 않는다 (LDP-222)
function BrandLogo() {
  return (
    <>
      <img className="brand-logo is-on-light" src={logoDark} width={486} height={88} alt="머묾 MEOMULM" />
      <img className="brand-logo is-on-dark" src={logoGold} width={491} height={88} alt="머묾 MEOMULM" />
    </>
  )
}

export default BrandLogo
