import {
  Body,
  Controller,
  Get,
  Inject,
  OnModuleInit,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  OptionalCurrentUser,
  OptionalJwtAuthGuard,
} from '@app/common';
import { SendMessageDto } from './dto/send-message.dto';

// proto의 ChatBotService 스펙과 1:1 대응되는 TS 인터페이스
interface ChatBotService {
  getHello(data: {}): Observable<{ message: string }>;
  sendMessage(data: {
    userId: number;
    message: string;
  }): Observable<SendMessageResponseDto>;
  getHistory(data: { userId: number }): Observable<GetHistoryResponseDto>;
}

// proto의 SendMessageResponse 메시지와 1:1 대응되는 응답 형태
interface SendMessageResponseDto {
  sessionId: string;
  reply: string;
  createdAt: string;
}

// proto의 ChatMessage 메시지와 1:1 대응되는 응답 형태
interface ChatMessageDto {
  role: string;
  content: string;
  createdAt: string;
}

// proto의 GetHistoryResponse 메시지와 1:1 대응되는 응답 형태
interface GetHistoryResponseDto {
  messages: ChatMessageDto[];
}

@ApiTags('ChatBotService')
@ApiCommonResponses()
@Controller('api/chat-bots')
export class ChatBotController implements OnModuleInit {
  private chatBotService!: ChatBotService;

  constructor(
    @Inject('CHAT_BOT_SERVICE') private readonly client: ClientGrpc,
  ) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.chatBotService =
      this.client.getService<ChatBotService>('ChatBotService');
  }

  /**
   * GET http://localhost:3000/api/chat-bot/hello
   * 브라우저/프론트엔드 HTTP 요청 수신 -> chat-bot-service gRPC 호출
   */
  @Get('hello')
  @ApiOperation({
    summary: '챗봇 도메인 서버 헬스체크',
    description:
      'gRPC를 통해 chat-bot-service 서버의 상태 및 Hello 메시지를 가져옵니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'ChatBot Hello World! 출력',
  })
  getHello(): Observable<{ message: string }> {
    return this.chatBotService.getHello({});
  }

  /**
   * POST http://localhost:3000/api/chat-bots/messages
   * 로그인 여부와 무관하게 호출 가능. Authorization 헤더가 있으면 대화가 세션에 저장되어
   * 이어지고, 없으면 이번 메시지만 처리하는 1회성 질문으로 취급됩니다(이력 저장 없음).
   *
   * OptionalJwtAuthGuard 때문에 토큰 없이도 호출 가능한 라우트라 익명 남용(LLM 비용/부하)
   * 여지가 있어, 게이트웨이 기본 rate limit(분당 100회)보다 훨씬 타이트하게 IP당 분당 10회로
   * 제한합니다.
   */
  @Post('messages')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '챗봇에게 메시지 전송',
    description:
      'n8n AI workflow에 메시지를 위임해 응답을 받습니다. Bearer 토큰을 함께 보내면 대화 ' +
      '이력이 세션에 저장되어 다음 메시지의 context로 이어지고, 토큰 없이 호출하면 ' +
      '이력을 남기지 않는 1회성 질문으로 처리됩니다(Bearer 토큰은 선택 사항). ' +
      'IP당 분당 10회로 rate limit이 걸려 있습니다.',
  })
  @ApiResponse({
    status: 201,
    description:
      '챗봇 응답 생성 성공. sessionId는 비로그인 호출인 경우 빈 문자열입니다.',
  })
  @ApiResponse({
    status: 429,
    description: 'rate limit 초과 (IP당 분당 10회)',
  })
  @ApiResponse({
    status: 503,
    description: 'n8n/LLM 처리 실패 또는 타임아웃',
  })
  async sendMessage(
    @Body() dto: SendMessageDto,
    @OptionalCurrentUser() user: AuthenticatedUser | null,
  ): Promise<SendMessageResponseDto> {
    return firstValueFrom(
      this.chatBotService.sendMessage({
        userId: user?.userId ?? 0,
        message: dto.message,
      }),
    ).catch((err) => {
      throw new ServiceUnavailableException(
        err?.details || err?.message || '챗봇 응답 생성에 실패했습니다.',
      );
    });
  }

  /**
   * GET http://localhost:3000/api/chat-bots/messages
   * 로그인 사용자 전용. 현재 이어지고 있는 세션의 최근 대화 이력을 가져옵니다.
   */
  @Get('messages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 챗봇 대화 이력 조회',
    description:
      '로그인한 사용자의 진행 중인 세션에서 최근 대화 이력을 가져옵니다. 아직 대화한 적이 ' +
      '없으면 빈 배열을 반환합니다.',
  })
  @ApiResponse({ status: 200, description: '대화 이력 조회 성공' })
  async getHistory(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GetHistoryResponseDto> {
    return firstValueFrom(
      this.chatBotService.getHistory({ userId: user.userId }),
    ).catch((err) => {
      throw new ServiceUnavailableException(
        err?.details || err?.message || '대화 이력 조회에 실패했습니다.',
      );
    });
  }
}
