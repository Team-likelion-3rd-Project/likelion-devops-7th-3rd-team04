import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

// 컨테이너/파드가 "살아서 요청을 받을 수 있는 상태인지"만 확인하는 헬스체크 엔드포인트입니다.
// docker-compose healthcheck와 K8s liveness/readiness probe가 GET /health를 주기적으로 호출합니다.
// DB/Redis 같은 외부 의존성은 일부러 확인하지 않습니다 — DB가 잠깐 끊겼다고 모든 서비스가
// unhealthy로 판정되어 한꺼번에 재시작되는 것을 막기 위함입니다.
@ApiExcludeController()
// api-gateway의 전역 rate limit(ThrottlerGuard)에 헬스체크 호출이 걸리지 않도록 제외합니다.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
