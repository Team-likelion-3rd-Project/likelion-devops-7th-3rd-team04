import { useEffect, useRef, useState, type FormEvent } from 'react'
import { sendChatMessage } from '../api/gateway'
import './ChatWidget.css'

type Tab = 'faq' | 'chat'

type ChatMessage = {
  id: number
  role: 'user' | 'bot'
  text: string
  time: string
}

const formatTime = () =>
  new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

// 단순 정보 안내: 미리 정해진 답이 있는 항목이라 목록에서 펼치면 고정된 답변을 바로 보여준다(규칙 시나리오 방식).
const FAQ_TOPICS: { id: string; label: string; answer: string }[] = [
  { id: 'checkin', label: '체크인/체크아웃 시간', answer: '체크인은 오후 3시, 체크아웃은 오전 11시입니다.' },
  { id: 'parking', label: '주차 안내', answer: '투숙객은 별도 요금 없이 호텔 내 주차장을 이용하실 수 있어요.' },
  { id: 'cancel', label: '예약 변경/취소', answer: '마이페이지 > 예약내역에서 직접 변경하거나 취소하실 수 있어요.' },
  {
    id: 'payment',
    label: '결제 수단/결제 확인',
    answer: '예약 시 온라인 카드 결제를 이용하실 수 있고, 결제 내역은 마이페이지 > 결제내역에서 확인하실 수 있어요.',
  },
  {
    id: 'refund',
    label: '취소 시 환불 안내',
    answer: '예약을 취소하시면 결제하신 금액은 결제하신 수단으로 환불되며, 진행 상황은 마이페이지 > 결제내역에서 확인하실 수 있어요.',
  },
  {
    id: 'waterpark',
    label: '워터파크 이용 안내',
    answer: '투숙객은 별도 요금 없이 워터파크를 이용하실 수 있고, 외부 동반 이용객은 추가 요금이 부과돼요. 이용시간 등 자세한 안내는 각 호텔 소개 페이지에서 확인해주세요.',
  },
  {
    id: 'options',
    label: '부대시설 옵션 요금',
    answer: '실내수영장·라운지 등 부대시설 옵션 요금은 1인 1회 기준이며, 부가가치세 10%가 포함된 금액이에요.',
  },
  {
    id: 'guests',
    label: '기준 인원/인원 추가',
    answer: '객실별 기준 인원은 각 객실 상세 페이지에서 확인하실 수 있고, 예약하실 투숙 인원이 기준 인원을 넘으면 예약이 제한될 수 있어요.',
  },
]

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 0, role: 'bot', text: '안녕하세요! 궁금하신 내용을 자유롭게 입력해주세요.', time: formatTime() },
]

// 오른쪽 사이드에 항상 떠 있는 채팅상담 위젯.
// 하단 탭으로 "자주묻는질문(규칙 시나리오)"와 "대화하기(대화형)"를 먼저 분리해두고,
// 단순 정보 안내는 목록에서 펼쳐 정해진 답을 바로 보여주는 방식으로, 그 외 복잡한 질문은
// 대화하기 탭에서 직접 입력해 챗봇 API(POST /api/chat-bots/messages)로 실시간 응답을 받는다.
function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('faq')
  const [openFaqId, setOpenFaqId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [draft, setDraft] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const nextId = useRef(1)
  // 응답을 기다리는 동안 위젯이 닫히거나(언마운트) 라우트가 바뀌어도 그 이후 setState를 호출하지 않도록 막는 가드.
  const isMountedRef = useRef(true)

  useEffect(() => {
    // StrictMode(dev)가 mount -> cleanup -> mount를 한 번 더 시뮬레이션하므로, cleanup에서
    // false로 내린 뒤 재마운트 시 다시 true로 되돌려야 실제 마운트 상태와 어긋나지 않는다.
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const appendMessage = (message: Omit<ChatMessage, 'id' | 'time'>) => {
    setMessages((prev) => [...prev, { ...message, id: nextId.current++, time: formatTime() }])
  }

  // 규칙 시나리오: 목록에서 항목을 펼치면 정해진 답변을 바로 보여준다(다시 누르면 접힘).
  const toggleFaq = (topicId: string) => {
    setOpenFaqId((current) => (current === topicId ? null : topicId))
  }

  // 대화형 방식: 정해진 답이 없는 자유 질문이라 챗봇 API에 그대로 위임하고, 응답이 오는 동안 타이핑
  // 인디케이터를 보여준다. 로그인 상태면 authorizedFetch가 토큰을 실어 보내 대화가 세션에 이어진다.
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || isTyping) return

    appendMessage({ role: 'user', text })
    setDraft('')
    setIsTyping(true)

    try {
      const { reply } = await sendChatMessage(text)
      if (!isMountedRef.current) return
      appendMessage({ role: 'bot', text: reply })
    } catch (err) {
      if (!isMountedRef.current) return
      const message = err instanceof Error ? err.message : ''
      const isRateLimited = /429|too many/i.test(message)
      appendMessage({
        role: 'bot',
        text: isRateLimited
          ? '문의가 너무 많아 잠시 제한되었어요. 1분 후 다시 시도해주세요.'
          : '일시적으로 답변을 가져오지 못했어요. 잠시 후 다시 시도해주세요.',
      })
    } finally {
      if (isMountedRef.current) setIsTyping(false)
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="chat-widget-toggle" onClick={() => setIsOpen(true)}>
        <span className="chat-widget-toggle-icon" aria-hidden="true">
          💬
        </span>
        채팅상담
      </button>
    )
  }

  return (
    <section className="chat-widget-panel" aria-label="채팅상담">
      <header className="chat-widget-header">
        <span className="chat-widget-avatar" aria-hidden="true">
          🏨
        </span>
        <div className="chat-widget-header-text">
          <h2>채팅상담</h2>
          <p>AI 챗봇이 24시간 바로 답변해드려요</p>
        </div>
        <button
          type="button"
          className="chat-widget-close"
          onClick={() => setIsOpen(false)}
          aria-label="채팅상담 닫기"
        >
          ✕
        </button>
      </header>

      <div className="chat-widget-content">
        {activeTab === 'faq' ? (
          <div className="chat-widget-faq">
            <p className="chat-widget-faq-intro">자주 묻는 질문이에요. 궁금하신 항목을 선택해주세요.</p>
            <ul className="chat-widget-faq-list">
              {FAQ_TOPICS.map((topic) => {
                const isFaqOpen = openFaqId === topic.id
                return (
                  <li key={topic.id}>
                    <button
                      type="button"
                      className={`chat-widget-faq-question${isFaqOpen ? ' open' : ''}`}
                      onClick={() => toggleFaq(topic.id)}
                      aria-expanded={isFaqOpen}
                    >
                      <span>{topic.label}</span>
                      <span className="chat-widget-faq-caret" aria-hidden="true">
                        {isFaqOpen ? '−' : '+'}
                      </span>
                    </button>
                    {isFaqOpen && <p className="chat-widget-faq-answer">{topic.answer}</p>}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div className="chat-widget-chat">
            <ul className="chat-widget-messages">
              {messages.map((message) => (
                <li key={message.id} className={`chat-widget-message ${message.role}`}>
                  {message.role === 'bot' && (
                    <span className="chat-widget-message-avatar" aria-hidden="true">
                      🏨
                    </span>
                  )}
                  <div className="chat-widget-message-body">
                    <span className="chat-widget-bubble">{message.text}</span>
                    <span className="chat-widget-time">{message.time}</span>
                  </div>
                </li>
              ))}

              {isTyping && (
                <li className="chat-widget-message bot">
                  <span className="chat-widget-message-avatar" aria-hidden="true">
                    🏨
                  </span>
                  <div className="chat-widget-message-body">
                    <span className="chat-widget-bubble chat-widget-typing" aria-label="답변을 준비하고 있어요">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </li>
              )}
            </ul>

            <form className="chat-widget-input" onSubmit={handleSubmit}>
              <input
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="궁금하신 점을 자유롭게 입력해주세요"
                aria-label="채팅 메시지 입력"
              />
              <button
                type="submit"
                className="chat-widget-send"
                disabled={!draft.trim() || isTyping}
                aria-label="메시지 전송"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2z" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>

      <nav className="chat-widget-tabs" aria-label="채팅상담 메뉴">
        <button
          type="button"
          className={`chat-widget-tab${activeTab === 'faq' ? ' active' : ''}`}
          onClick={() => setActiveTab('faq')}
        >
          <span className="chat-widget-tab-icon" aria-hidden="true">
            📋
          </span>
          자주묻는질문
        </button>
        <button
          type="button"
          className={`chat-widget-tab${activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <span className="chat-widget-tab-icon" aria-hidden="true">
            💬
          </span>
          대화하기
        </button>
      </nav>
    </section>
  )
}

export default ChatWidget
