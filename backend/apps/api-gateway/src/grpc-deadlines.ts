import type { GrpcOptions } from '@nestjs/microservices';
import { getGrpcOptions, grpcDeadlineInterceptor } from '@app/common';

// api-gateway → 각 서비스 gRPC 호출 기한 (LDP-223).
// 기한을 넘기면 호출이 DEADLINE_EXCEEDED로 끝나고, 컨트롤러의 기존 에러 변환에 따라 503(*_SERVICE_UNAVAILABLE)으로 응답한다.
// 기한 초과는 grpc_client 메트릭에 grpc_code="DEADLINE_EXCEEDED"로 따로 잡힌다 (LDP-169).
// 규칙: 안에서 다른 서비스·외부 API를 기다리는 호출은 그 기한보다 길게 잡는다 — 안쪽이 먼저 실패해야 실패 사유가 그대로 전달된다.
export const DEFAULT_GRPC_DEADLINE_MS = 5_000;

export const GRPC_DEADLINE_MS_BY_PATH: Record<string, number> = {
  // 결제 승인: booking → payment 승인 기한 25초 (booking-service PAYMENT_APPROVE_DEADLINE_MS)
  '/booking.BookingService/ConfirmPayment': 30_000,
  // 예약 취소(환불 포함): booking → payment 환불 기한 15초 (PAYMENT_REFUND_DEADLINE_MS)
  '/booking.BookingService/CancelBooking': 20_000,
  '/booking.BookingService/AdminCancelBooking': 20_000,
  // 챗봇 답변: chat-bot → n8n 기본 50초 (chat-bot-service n8n.client.ts)
  '/chatBot.ChatBotService/SendMessage': 55_000,
  // 카카오 로그인: 카카오 토큰 교환 + 사용자 정보 조회, 각 5초 (auth-service KAKAO_TIMEOUT_MS)
  '/auth.AuthService/SocialLogin': 15_000,
};

const gatewayDeadlineInterceptor = grpcDeadlineInterceptor(
  DEFAULT_GRPC_DEADLINE_MS,
  GRPC_DEADLINE_MS_BY_PATH,
);

// api-gateway의 ClientsModule.register에서 getGrpcOptions 대신 쓴다 (호출 기한이 함께 걸린다)
export function getGatewayGrpcOptions(
  packageName: string,
  protoFile: string,
  url: string,
): GrpcOptions {
  return getGrpcOptions(packageName, protoFile, url, [
    gatewayDeadlineInterceptor,
  ]);
}
