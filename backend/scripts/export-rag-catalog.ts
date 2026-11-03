// 챗봇 RAG 문서의 원본(rag catalog)을 seed-catalog.ts에서 만들어 llm-service에 JSON으로 내보낸다.
// llm-service 이미지는 빌드 컨텍스트가 langchain_rag/llm-service라 backend 파일을 직접 읽을 수 없어서,
// 생성한 JSON을 커밋해 두고 corpus.py·intent.py가 읽는다. 일치 여부는 export-rag-catalog.spec.ts가 검사한다.
//
//   cd backend && npm run rag:export-catalog
//
// 시딩(DB)용 값 중 챗봇에 필요 없는 것(images, totalCount, capacity, 공지 pinned)은 넣지 않는다.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACILITY_SEEDS,
  HOTEL_SEEDS,
  NOTICE_SEEDS,
  WEEKEND_PRICE_RATE,
} from './seed-catalog';

export const RAG_CATALOG_PATH = join(
  __dirname,
  '../../langchain_rag/llm-service/app/rag_catalog.json',
);

export function buildRagCatalog() {
  return {
    _comment:
      '생성 파일 — 직접 고치지 마세요. backend/scripts/seed-catalog.ts를 고친 뒤 `npm run rag:export-catalog`',
    weekendPriceRate: WEEKEND_PRICE_RATE,
    hotels: HOTEL_SEEDS.map(({ slug, hotel, rooms }) => ({
      slug,
      name: hotel.name,
      address: hotel.address,
      phone: hotel.phoneNumber,
      description: hotel.description,
      rooms: rooms.map(({ slug: roomSlug, name, weekdayPrice, detail }) => ({
        slug: roomSlug,
        name,
        weekdayPrice,
        ...detail,
      })),
    })),
    facilities: FACILITY_SEEDS.map(({ name, price }) => ({ name, price })),
    notices: NOTICE_SEEDS.map(({ date, category, title, body }) => ({
      date,
      category,
      title,
      body,
    })),
  };
}

if (require.main === module) {
  writeFileSync(
    RAG_CATALOG_PATH,
    `${JSON.stringify(buildRagCatalog(), null, 2)}\n`,
    'utf-8',
  );
  console.log(`[rag] ${RAG_CATALOG_PATH} 생성 완료`);
}
