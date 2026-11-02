import { readFileSync } from 'node:fs';
import { buildRagCatalog, RAG_CATALOG_PATH } from './export-rag-catalog';

// seed-catalog.ts(DB 시딩 원본)와 llm-service가 읽는 rag_catalog.json이 어긋나면 챗봇이 옛 정보로
// 답하게 된다. 다르면 `npm run rag:export-catalog`로 다시 만들어 커밋하세요.
describe('rag catalog', () => {
  it('langchain_rag/llm-service/app/rag_catalog.json matches seed-catalog.ts', () => {
    const committed: unknown = JSON.parse(
      readFileSync(RAG_CATALOG_PATH, 'utf-8'),
    );

    expect(committed).toEqual(buildRagCatalog());
  });

  it('gives every hotel and room a unique slug', () => {
    const { hotels } = buildRagCatalog();
    const hotelSlugs = hotels.map((hotel) => hotel.slug);

    expect(new Set(hotelSlugs).size).toBe(hotelSlugs.length);
    for (const hotel of hotels) {
      const roomSlugs = hotel.rooms.map((room) => room.slug);
      expect(new Set(roomSlugs).size).toBe(roomSlugs.length);
    }
  });
});
