import type { CSSProperties } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { HotelOutletContext } from '../layouts/HotelLayout'
import './HotelWatersPage.css'

interface RuleGroup {
  title: string
  items: string[]
}

// 입장 제한 및 이용 규정: 제목 + 불릿 목록으로 구조가 동일해 배열로 관리한다.
const RULE_GROUPS: RuleGroup[] = [
  {
    title: '안내사항',
    items: [
      '개인 부주의로 인한 소지품의 도난, 분실, 손상에 대한 책임은 이용객에게 있으므로, 시설 이용 시 개인 소지품에 대한 각별한 주의를 부탁 드립니다.',
      '상업적 목적의 촬영 시 이용이 제한될 수 있으며, 다른 고객에게 불편을 주는 지나친 촬영은 제재할 수 있으니 이에 협조 바랍니다.',
      '안전하고 쾌적한 이용을 위하여 착용형 구명조끼 외 수영용품(스노클링 장비, 오리발, 물총) 사용과 외부 음식물 반입을 제한하고 있습니다.',
      '수영장은 별도 샤워시설을 운영하지 않습니다. 객실에서 환복 후 이용하시기 바랍니다.',
    ],
  },
  {
    title: '안전사항',
    items: [
      '안전한 이용을 위해 안전요원 및 직원의 안내에 적극적으로 협조해 주시기 바랍니다.',
      '13세 이하 어린이는 보호자 동반 시 이용이 가능합니다.',
      '수영장 내에서 다이빙은 금지되어 있습니다.',
      '신장 120cm 미만 어린이는 구명조끼를 필수로 착용해 주시기 바랍니다.',
      '금속, 플라스틱, 유리제품 등 날카롭거나 깨질 수 있는 물건의 반입을 금하고 있습니다.',
      '타인에게 상해를 입힐 수 있는 액세서리 및 안경 등의 착용을 삼가 주시기 바랍니다.',
      '고객의 안전을 위하여 음주 후 수영장 시설 이용은 제한될 수 있습니다.',
    ],
  },
  {
    title: '위생사항',
    items: [
      '공중 위생에 영향을 미치는 감염성 질환이 있는 경우 이용이 제한됩니다.',
      '수영장에 들어가기 전 객실에서 샤워 후 입장해주시기 바랍니다.',
      '36개월 미만의 어린이는 방수 기저귀를 착용 후 이용 가능합니다.',
      '수영장 입수 시에는 수영복 착용 후 이용 가능합니다. (수영장 전용 외 의류 착용 제한)',
    ],
  },
]

/**
 * WATERS는 백엔드에 별도의 부대시설(amenities) 데이터가 없으므로 fetch 없이
 * 정적 이미지 플레이스홀더 + 소개 문구 + 이용 안내로 구성한다.
 */
function HotelWatersPage() {
  const { hotel } = useOutletContext<HotelOutletContext>()

  return (
    <>
      {/* HotelDetailPage의 히어로처럼 폭 제약 없이 렌더되어 화면 가로축을 그대로 채운다.
          사진이 없는 호텔(제주점 등)은 틸 그라디언트 플레이스홀더로 자동 대체된다. */}
      <div
        className="hotel-waters-image"
        style={hotel.images.waters ? ({ '--waters-photo': `url(${hotel.images.waters})` } as CSSProperties) : undefined}
        aria-hidden="true"
      />
      <div className="hotel-waters-body">
        <Link to={`/hotels/${hotel.id}`} className="hotel-back-link">
          ← {hotel.name}
        </Link>
        <h1>WATERS</h1>
        <div className="hotel-waters-copy">
          <p>
            {hotel.name}의 워터스는 사계절 내내 이용할 수 있는 실내 온수 풀과, 탁 트인 전망의 야외
            인피니티 풀로 이루어져 있습니다.
          </p>
        </div>

        {/* TODO: 크기/시간/요금 등 세부 수치는 실제 운영 데이터가 준비되면 교체 */}
        <dl className="hotel-waters-info">
          <div className="hotel-waters-info-row">
            <dt>크기</dt>
            <dd>16.0m x 4.2m / 수심 1.2m</dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>이용시간</dt>
            <dd>
              <p>1부: 09:00-13:00 (Break time 13:00-14:00)</p>
              <p>2부: 14:00-16:30 (Break time 16:30-17:00)</p>
              <p>3부: 17:00-19:00 (Break time 19:00-19:30)</p>
              <p>4부: 19:30-22:00</p>
              <ul className="hotel-waters-notes">
                <li>수영장 정비시간에는 수영장 입장이 제한됩니다.</li>
                <li>운영 시간은 시즌마다 상이합니다.</li>
                <li>운영 시간은 영업 방침에 따라 변동될 수 있습니다.</li>
              </ul>
            </dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>이용대상</dt>
            <dd>{hotel.name} 투숙객 &amp; 피트니스 멤버십 회원</dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>회원혜택</dt>
            <dd>{hotel.name} 멤버십 회원 전용 이용 시간 07:00 ~ 09:00</dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>이용요금</dt>
            <dd>
              <p>성인 77,000원</p>
              <p>소인 44,000원 (소인 : 36개월~16세, 36개월 미만 무료)</p>
              <ul className="hotel-waters-notes">
                <li>투숙객 외 추가 동반 이용객은 별도 요금이 부과됩니다.</li>
                <li>결제 당일에 한해서 이용 가능합니다.</li>
              </ul>
            </dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>대여 용품</dt>
            <dd>구명조끼, 조끼형 튜브</dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>입장 제한 및 이용 규정</dt>
            <dd>
              {RULE_GROUPS.map((group) => (
                <div key={group.title} className="hotel-waters-rule-group">
                  <h3>{group.title}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </dd>
          </div>

          <div className="hotel-waters-info-row">
            <dt>이용문의</dt>
            {/* 실제 타 업체의 연락처가 아닌 프로젝트용 가공 플레이스홀더 */}
            <dd>프런트 데스크 (02-0000-0000)</dd>
          </div>
        </dl>
      </div>
    </>
  )
}

export default HotelWatersPage
