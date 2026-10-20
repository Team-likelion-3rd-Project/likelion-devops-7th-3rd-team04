import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mariaDbSslOptions } from './mariadb-ssl';

describe('mariaDbSslOptions (DB TLS 옵션, LDP-101)', () => {
  let dir: string;
  let caPath: string;
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const env = (values: Record<string, string>) => (key: string) => values[key];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mariadb-ssl-'));
    caPath = join(dir, 'ca.pem');
    writeFileSync(caPath, pem);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('설정하지 않거나 false면 TLS를 쓰지 않는다 (지금처럼 평문)', () => {
    expect(mariaDbSslOptions('DB', env({}))).toBeUndefined();
    expect(mariaDbSslOptions('DB', env({ DB_SSL: '' }))).toBeUndefined();
    expect(mariaDbSslOptions('DB', env({ DB_SSL: 'false' }))).toBeUndefined();
  });

  it('true면 CA를 읽고 인증서 검증을 켠다', () => {
    expect(
      mariaDbSslOptions('DB', env({ DB_SSL: 'true', DB_SSL_CA_PATH: caPath })),
    ).toEqual({ ca: pem, rejectUnauthorized: true });
  });

  it('결제 DB는 PAYMENT_DB_ 이름을 쓴다', () => {
    expect(
      mariaDbSslOptions(
        'PAYMENT_DB',
        env({ PAYMENT_DB_SSL: 'TRUE', PAYMENT_DB_SSL_CA_PATH: caPath }),
      ),
    ).toEqual({ ca: pem, rejectUnauthorized: true });
    // 메인 DB 설정은 결제 DB에 영향을 주지 않는다
    expect(
      mariaDbSslOptions(
        'PAYMENT_DB',
        env({ DB_SSL: 'true', DB_SSL_CA_PATH: caPath }),
      ),
    ).toBeUndefined();
  });

  it('true인데 CA 경로가 없으면 기동 시 실패한다', () => {
    expect(() => mariaDbSslOptions('DB', env({ DB_SSL: 'true' }))).toThrow(
      'DB_SSL_CA_PATH',
    );
  });

  it('CA 파일을 읽을 수 없거나 PEM이 아니면 실패한다', () => {
    expect(() =>
      mariaDbSslOptions(
        'DB',
        env({ DB_SSL: 'true', DB_SSL_CA_PATH: join(dir, 'none.pem') }),
      ),
    ).toThrow('읽을 수 없습니다');
    const notPem = join(dir, 'not.pem');
    writeFileSync(notPem, 'hello');
    expect(() =>
      mariaDbSslOptions('DB', env({ DB_SSL: 'true', DB_SSL_CA_PATH: notPem })),
    ).toThrow('PEM');
  });

  it('true / false가 아닌 값은 실수로 보고 실패한다', () => {
    expect(() => mariaDbSslOptions('DB', env({ DB_SSL: 'yes' }))).toThrow(
      'true 또는 false',
    );
  });
});
