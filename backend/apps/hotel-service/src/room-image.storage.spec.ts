import { RoomImageStorage } from './room-image.storage';

// 사진 보기 URL: IMAGE_BASE_URL 이 있으면(운영 CloudFront) 서명 없는 고정 URL, 없으면(로컬 · 온프레미스) Presigned GET URL.
// 환경 변수는 생성자에서 읽으므로 테스트마다 값을 바꾼 뒤 새로 만든다. 서명은 로컬 계산이라 저장소에 요청하지 않는다.
describe('RoomImageStorage.createViewUrl', () => {
  const objectKey = 'room-types/7/0f8b6c1e-1234-4abc-9def-001122334455.jpg';
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      S3_BUCKET: 'room-images',
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: '',
      S3_PUBLIC_ENDPOINT: '',
      S3_FORCE_PATH_STYLE: 'false',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
    };
    delete process.env.IMAGE_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('IMAGE_BASE_URL 이 있으면 서명 없는 고정 URL 을 돌려준다', async () => {
    process.env.IMAGE_BASE_URL = 'https://meomulm.click';
    const storage = new RoomImageStorage();

    await expect(storage.createViewUrl(objectKey)).resolves.toBe(
      `https://meomulm.click/${objectKey}`,
    );
  });

  it('IMAGE_BASE_URL 끝의 / 는 한 번만 붙인다', async () => {
    process.env.IMAGE_BASE_URL = 'https://meomulm.click/';
    const storage = new RoomImageStorage();

    await expect(storage.createViewUrl(objectKey)).resolves.toBe(
      `https://meomulm.click/${objectKey}`,
    );
  });

  it('IMAGE_BASE_URL 이 없으면 Presigned GET URL 을 돌려준다', async () => {
    const storage = new RoomImageStorage();

    const url = new URL(await storage.createViewUrl(objectKey));
    expect(url.host).toBe('room-images.s3.us-east-1.amazonaws.com');
    expect(url.pathname).toBe(`/${objectKey}`);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('IMAGE_BASE_URL 이 빈 값이면 Presigned GET URL 을 돌려준다', async () => {
    process.env.IMAGE_BASE_URL = '';
    const storage = new RoomImageStorage();

    const url = await storage.createViewUrl(objectKey);
    expect(url).toContain('X-Amz-Signature=');
  });
});
