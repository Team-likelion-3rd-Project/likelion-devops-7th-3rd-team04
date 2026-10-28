import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { getRequiredEnv, rpcError } from '@app/common';
import { ChatRole } from '../message/message.service';

export interface N8nChatRequest {
  sessionId?: string;
  userId?: number;
  message: string;
  history: { role: ChatRole; content: string }[];
}

export interface N8nChatResponse {
  reply: string;
  // LLM이 만든 값이라 타입을 믿지 않습니다 — chat-action.ts의 sanitizeChatAction으로만 꺼내 씁니다.
  intent?: unknown;
  action?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// n8n workflow(AI 오케스트레이션)를 호출하는 유일한 진입점입니다. n8n은 RAG 조회, LLM Service
// 호출 등 내부 구현을 이 계약 뒤로 숨기므로, chat-bot-service는 n8n의 워크플로 구성을 알 필요가 없습니다.
@Injectable()
export class N8nClient {
  private readonly logger = new Logger(N8nClient.name);

  constructor(private readonly httpService: HttpService) {}

  async sendMessage(request: N8nChatRequest): Promise<N8nChatResponse> {
    // N8N_WEBHOOK_URL 누락은 배포 설정 실수이므로 즉시 죽이고(getRequiredEnv), 그 외
    // 호출 실패(타임아웃/5xx/응답 형식 오류)만 RpcException으로 변환해 클라이언트에 노출합니다.
    const webhookUrl = getRequiredEnv('N8N_WEBHOOK_URL');
    const timeout = Number(process.env.N8N_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<N8nChatResponse>(webhookUrl, request, {
          timeout,
        }),
      );

      if (!data?.reply) {
        throw new Error('n8n 응답에 reply 필드가 없습니다.');
      }

      return data;
    } catch (error) {
      const err = error as AxiosError | Error;
      this.logger.error(`n8n 호출 실패: ${err.message}`, err.stack);
      throw rpcError(GrpcStatus.UNAVAILABLE, 'AI 응답 생성에 실패했습니다.');
    }
  }
}
