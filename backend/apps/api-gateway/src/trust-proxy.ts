import { NestExpressApplication } from '@nestjs/platform-express';

// ThrottlerGuard는 req.ip를 키로 요청 수를 센다. trust proxy가 없으면 req.ip가 TCP 상대방인
// Traefik Pod IP가 되어 모든 사용자가 한 버킷을 나눠 쓴다(비로그인 챗봇 분당 10회가 전체 합산으로 걸림).
// 사설 대역(loopback·link-local·10/8·172.16/12·192.168/16 등)의 프록시만 신뢰해서, Express가
// X-Forwarded-For를 오른쪽부터 읽으며 신뢰 주소를 건너뛰고 처음 만난 주소를 req.ip로 쓰게 한다.
// - 운영: ALB(10.10.x)·워커 SNAT·Traefik Pod(10.0.x)를 건너뛰고 ALB가 붙인 클라이언트 공인 IP가 나온다.
//   클라이언트가 XFF 왼쪽에 넣은 가짜 값은 그 앞에서 멈추므로 무시된다.
// - 온프레미스 dev: Traefik이 XFF를 접속 IP(Tailscale 100.64/10, 신뢰 대상 아님)로 다시 써서 그 값이 나온다.
// 홉 수(숫자) 대신 대역으로 지정해 Traefik replica·SNAT 여부가 바뀌어도 깨지지 않게 했다.
export function configureTrustProxy(app: NestExpressApplication): void {
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
}
