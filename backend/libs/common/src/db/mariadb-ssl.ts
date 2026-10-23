import { readFileSync } from 'fs';

// MariaDB(TypeORM `type: 'mariadb'`, mysql2 드라이버) 접속에 TLS를 켜는 옵션 (LDP-101).
//
// 운영 RDS는 require_secure_transport = ON이라 TLS가 아닌 접속을 거부한다. 환경변수로 켜고 끈다.
//   <prefix>_SSL=true           TLS 사용 (true / false, 비우면 false — 로컬 docker compose·온프레미스는 지금처럼 평문)
//   <prefix>_SSL_CA_PATH=<경로>  서버 인증서를 검증할 CA 파일 (운영: RDS CA 번들, 인프라가 파드에 마운트)
// prefix: 메인 DB = 'DB', 결제 DB = 'PAYMENT_DB'
//
// 인증서 검증은 항상 켠다(rejectUnauthorized: true). 검증을 끄는 설정은 일부러 만들지 않는다 —
// 끄면 중간에서 가짜 DB 서버가 끼어들어도 알 수 없다.
// 호스트 이름 검증(verifyIdentity: true)도 켠다 — mysql2 는 이 값이 없으면 CA 만 보고 인증서의 이름은 확인하지 않아,
// 같은 CA 로 발급된 다른 서버 인증서도 통과한다 (LDP-141 운영 검증에서 확인). <prefix>_HOST 는 인증서에 있는 이름(RDS 엔드포인트)이어야 한다.
// IP 주소로 접속하면 mysql2 가 이름 검증을 건너뛴다.
// 켜져 있는데 CA가 없거나 읽을 수 없으면 기동 시점에 바로 실패한다 (조용히 평문으로 넘어가지 않게).

export type MariaDbSslPrefix = 'DB' | 'PAYMENT_DB';

export interface MariaDbSslOptions {
  ca: string;
  rejectUnauthorized: true;
  verifyIdentity: true;
}

export function mariaDbSslOptions(
  prefix: MariaDbSslPrefix,
  getEnv: (key: string) => string | undefined = (key) => process.env[key],
): MariaDbSslOptions | undefined {
  const flagKey = `${prefix}_SSL`;
  const caPathKey = `${prefix}_SSL_CA_PATH`;

  const flag = (getEnv(flagKey) ?? '').trim().toLowerCase();
  if (flag === '' || flag === 'false') {
    return undefined;
  }
  if (flag !== 'true') {
    throw new Error(
      `${flagKey} 값은 true 또는 false여야 합니다 (현재: ${getEnv(flagKey)}).`,
    );
  }

  const caPath = (getEnv(caPathKey) ?? '').trim();
  if (!caPath) {
    throw new Error(
      `${flagKey}=true이면 ${caPathKey}(DB 서버 인증서를 검증할 CA 파일 경로)가 필요합니다.`,
    );
  }

  let ca: string;
  try {
    ca = readFileSync(caPath, 'utf8');
  } catch (error) {
    throw new Error(
      `${caPathKey}의 CA 파일을 읽을 수 없습니다: ${caPath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  if (!ca.includes('BEGIN CERTIFICATE')) {
    throw new Error(`${caPathKey}가 PEM 형식 인증서가 아닙니다: ${caPath}`);
  }

  return { ca, rejectUnauthorized: true, verifyIdentity: true };
}
