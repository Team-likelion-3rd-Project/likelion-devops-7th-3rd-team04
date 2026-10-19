"""llm-service HTTP API의 요청/응답 모델."""

from typing import Literal

from pydantic import BaseModel, Field


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


class ChatResponse(BaseModel):
    """POST /chat 응답 본문."""

    reply: str
