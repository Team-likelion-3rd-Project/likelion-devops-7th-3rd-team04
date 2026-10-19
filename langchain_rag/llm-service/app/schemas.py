"""llm-service HTTP API의 요청/응답 모델."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

Intent = Literal["BOOK", "PAY", "CANCEL"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """POST /chat 요청 본문."""

    message: str = Field(..., min_length=1, description="사용자의 최신 메시지.")
    history: list[ChatMessage] = Field(
        default_factory=list,
        description="이전 대화 턴(오래된 순). 새 대화/비로그인이면 빈 배열.",
    )
    context: str | None = Field(
        default=None,
        description=(
            "답변 근거로 쓸 context를 호출자가 직접 지정 (선택). "
            "생략하면 retrieval.py의 S3 Vectors RAG 검색 결과를 씁니다."
        ),
    )
    authenticated: bool = Field(
        default=False,
        description=(
            "로그인 사용자인지 여부(n8n이 chat-bot-service의 userId로 채움). 답변 문구에만 쓰이며, "
            "액션 차단은 chat-bot-service가 합니다."
        ),
    )


class BookAction(BaseModel):
    """예약 화면으로 보낼 딥링크 재료. 필수 슬롯(hotel, checkIn, checkOut)이 다 모였을 때만 만듭니다."""

    type: Literal["BOOK"] = "BOOK"
    hotel: str
    roomName: str | None = None
    checkIn: str
    checkOut: str
    adults: int
    children: int = 0


class SimpleAction(BaseModel):
    """대상 예약은 프론트가 사용자 JWT로 직접 조회하므로 type만 담습니다."""

    type: Literal["PAY", "CANCEL"]


ChatAction = Annotated[BookAction | SimpleAction, Field(discriminator="type")]


class ChatResponse(BaseModel):
    """POST /chat 응답 본문."""

    reply: str
    intent: Intent | None = None
    action: ChatAction | None = None
