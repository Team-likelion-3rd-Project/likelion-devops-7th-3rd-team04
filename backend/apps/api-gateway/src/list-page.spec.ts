import { listPage } from './list-page';

describe('listPage (회원 목록 상한, 부하 테스트 11-06)', () => {
  it('page 없이 부르면 전체가 아니라 1페이지 100건', () => {
    expect(listPage({})).toEqual({ page: 1, size: 100 });
  });

  it('page 없이 size만 주면 그 크기로 1페이지', () => {
    expect(listPage({ size: 30 })).toEqual({ page: 1, size: 30 });
  });

  it('page를 주면 한 페이지 기본 20건', () => {
    expect(listPage({ page: 3 })).toEqual({ page: 3, size: 20 });
    expect(listPage({ page: 2, size: 50 })).toEqual({ page: 2, size: 50 });
  });
});
