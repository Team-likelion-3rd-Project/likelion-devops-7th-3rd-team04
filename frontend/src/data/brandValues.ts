import valueArchitecture from '../assets/images/brand/value-architecture.jpg'
import valueDesign from '../assets/images/brand/value-design.jpg'
import valueNature from '../assets/images/brand/value-nature.jpg'
import valueEco from '../assets/images/brand/value-eco.jpg'

// 브랜드 가치(헤더 "브랜드 가치" 메뉴) 페이지 내용. 서버에 두지 않고 화면에서 바로 쓴다.
export interface BrandValue {
  slug: string
  label: string
  eyebrow: string
  title: string
  lead: string
  /** 세로 사진 — 메인 "머묾이 지키는 네 가지" 타일과 브랜드 가치 페이지에 같이 쓴다 (지점 사진과 겹치지 않게 따로 둔다) */
  image: string
  sections: { title: string; body: string }[]
}

export const BRAND_VALUES: BrandValue[] = [
  {
    slug: 'architecture',
    label: '건축',
    eyebrow: 'Architecture',
    title: '머무름을 위한 건축',
    lead: '머묾의 건물은 머무는 사람의 시선에서 시작합니다. 창이 향하는 곳, 빛이 드는 시간, 걸음이 닿는 거리까지 하루의 흐름에 맞춰 설계했습니다.',
    image: valueArchitecture,
    sections: [
      {
        title: '풍경을 향한 창',
        body: '모든 객실은 그 도시의 가장 좋은 풍경을 향합니다. 서울점은 남산을, 부산점은 바다를, 제주점은 오름과 숲을 창 가득 담았습니다.',
      },
      {
        title: '낮은 소음, 넓은 여백',
        body: '복도와 객실 사이에 완충 공간을 두고 두꺼운 벽과 이중창을 써서, 도심 한가운데서도 조용한 밤을 보낼 수 있습니다.',
      },
      {
        title: '지역의 재료',
        body: '서울의 화강석, 부산의 해송, 제주의 현무암처럼 지점마다 그 땅에서 난 재료로 로비와 외벽을 마감했습니다.',
      },
    ],
  },
  {
    slug: 'design',
    label: '디자인',
    eyebrow: 'Design',
    title: '덜어낸 자리의 편안함',
    lead: '눈에 띄는 장식보다 오래 머물수록 편안해지는 공간을 만듭니다. 따뜻한 목재와 리넨, 부드러운 조명이 하루의 긴장을 천천히 풀어 줍니다.',
    image: valueDesign,
    sections: [
      {
        title: '따뜻한 색',
        body: '베이지와 브라운, 금빛 조명을 바탕으로 낮에는 밝고 밤에는 아늑하게 바뀌는 색을 골랐습니다.',
      },
      {
        title: '손에 닿는 것부터',
        body: '침구는 고밀도 면, 가운은 와플 리넨, 손잡이는 무광 황동으로 — 자주 손이 가는 것일수록 좋은 재료를 씁니다.',
      },
      {
        title: '필요한 만큼의 기술',
        body: '조명과 커튼, 온도는 머리맡 패널 하나로 조절합니다. 기술은 보이지 않게, 쓰기 쉽게 두었습니다.',
      },
    ],
  },
  {
    slug: 'nature',
    label: '자연',
    eyebrow: 'Nature',
    title: '자연이 들어오는 시간',
    lead: '바다와 숲, 계절의 빛은 머묾이 손님에게 드리는 가장 큰 선물입니다. 자연을 바라보는 데서 그치지 않고 가까이 느낄 수 있도록 공간을 열었습니다.',
    image: valueNature,
    sections: [
      {
        title: '계절을 담은 정원',
        body: '로비와 테라스에 그 지역에서 자라는 나무와 풀을 심어, 계절마다 다른 색과 향을 만날 수 있습니다.',
      },
      {
        title: '물가의 휴식',
        body: '세 지점 모두 수영장과 라운지를 두어, 도시의 야경이나 바다, 숲을 바라보며 쉴 수 있습니다.',
      },
      {
        title: '아침 산책',
        body: '체크인 때 지점 주변의 산책길 지도를 드립니다. 남산 둘레길, 해운대 해변, 제주 숲길을 천천히 걸어 보세요.',
      },
    ],
  },
  {
    slug: 'eco',
    label: '에코',
    eyebrow: 'Eco',
    title: '다음 손님을 위한 약속',
    lead: '오늘의 편안함이 내일의 풍경을 해치지 않도록, 머묾은 매일의 운영에서 작은 실천을 이어 갑니다.',
    image: valueEco,
    sections: [
      {
        title: '일회용품 줄이기',
        body: '객실 어메니티는 다회용 디스펜서로, 생수는 유리병으로 드립니다. 칫솔·면도기는 필요한 분께만 요청 시 드립니다.',
      },
      {
        title: '에너지 아끼기',
        body: '손님이 객실을 비우면 조명과 냉난방이 자동으로 절전 모드로 바뀌고, 수영장 물은 여과해 다시 씁니다.',
      },
      {
        title: '지역과 함께',
        body: '조식과 라운지 메뉴는 가까운 지역의 농가와 어가에서 받은 재료로 만듭니다.',
      },
    ],
  },
]
