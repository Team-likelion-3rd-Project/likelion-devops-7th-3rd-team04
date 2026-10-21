import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMe, isUnauthorized, refreshAccessToken, updateMe, type UserProfile } from '../api/gateway'
import { currentLoginState } from '../utils/loginRedirect'
import './MyPage.css'

// 비밀번호 변경(/mypage/password)·회원 탈퇴(/mypage/withdraw)는 각각 별도 페이지로 분리돼 있다.
// 예전엔 이 셋을 /mypage 한 페이지 안에서 해시(#info 등)로 구분했는데, react-router의 NavLink는
// className을 문자열로 넘겨도 같은 pathname을 가리키는 링크를 전부 "active"로 표시해버려서
// (해시는 무시하고 pathname만 비교) 사이드바 항목 세 개가 한꺼번에 눌린 것처럼 보이는 문제가 있었다.
// 페이지를 진짜로 나누면 pathname 자체가 달라져 이 문제가 근본적으로 사라진다.
function MyPage() {
  const navigate = useNavigate()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhoneNumber, setEditPhoneNumber] = useState('')
  const [editError, setEditError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const data = await fetchMe()
        if (!cancelled) setProfile(data)
      } catch (err) {
        if (cancelled) return
        // fetchMe()는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이 필요한
        // 상태(401)가 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError('일시적으로 내 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const data = await fetchMe()
          if (!cancelled) setProfile(data)
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError('일시적으로 내 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate, retryTick])

  const startEditing = () => {
    if (!profile) return
    setEditName(profile.name)
    setEditPhoneNumber(profile.phoneNumber)
    setEditError('')
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditError('')
  }

  const handleEditSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setEditError('')
    setIsSaving(true)
    try {
      const updated = await updateMe({ name: editName, phoneNumber: editPhoneNumber })
      setProfile(updated)
      setIsEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '정보 수정에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">내 정보</h1>
          </div>

          {isLoading && <p className="mypage-status">불러오는 중...</p>}

          {!isLoading && loadError && (
            <div className="mypage-status">
              <p className="mypage-error">{loadError}</p>
              <button type="button" className="mypage-ghost-btn" onClick={() => setRetryTick((t) => t + 1)}>
                다시 시도
              </button>
            </div>
          )}

          {!isLoading &&
            profile &&
            (!isEditing ? (
              <>
                <dl className="mypage-info-list">
                  <div className="mypage-info-row">
                    <dt>이메일</dt>
                    <dd>{profile.email}</dd>
                  </div>
                  <div className="mypage-info-row">
                    <dt>이름</dt>
                    <dd>{profile.name}</dd>
                  </div>
                  <div className="mypage-info-row">
                    <dt>휴대폰 번호</dt>
                    <dd>{profile.phoneNumber}</dd>
                  </div>
                </dl>
                <div className="mypage-actions">
                  <button type="button" className="mypage-submit" onClick={startEditing}>
                    정보 수정
                  </button>
                </div>
              </>
            ) : (
              <form className="mypage-form" onSubmit={handleEditSubmit} noValidate>
                <label className="mypage-field">
                  <span>이름</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </label>

                <label className="mypage-field">
                  <span>휴대폰 번호</span>
                  <input
                    type="tel"
                    name="phoneNumber"
                    autoComplete="tel"
                    placeholder="010-1234-5678"
                    value={editPhoneNumber}
                    onChange={(e) => setEditPhoneNumber(e.target.value)}
                    required
                  />
                </label>

                {editError && <p className="mypage-error">{editError}</p>}

                <div className="mypage-actions">
                  <button type="button" className="mypage-ghost-btn" onClick={cancelEditing} disabled={isSaving}>
                    취소
                  </button>
                  <button type="submit" className="mypage-submit" disabled={isSaving}>
                    {isSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </form>
            ))}
        </div>
      </div>
    </section>
  )
}

export default MyPage
