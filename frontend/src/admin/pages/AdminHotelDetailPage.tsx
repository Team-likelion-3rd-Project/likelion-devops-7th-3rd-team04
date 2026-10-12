import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  createAdminRoom,
  fetchAdminHotelById,
  fetchAdminHotelRooms,
  fetchAdminHotelStats,
  readImageFileAsInput,
  toAdminImageDataUrl,
} from '../../api/adminApi'
import type { AdminHotel, AdminHotelStats, AdminRoom, AdminRoomImageInput } from '../../api/adminApi'
import './AdminPages.css'

// 이미지 하나당 허용하는 최대 용량. 오브젝트 스토리지 없이 DB에 Base64로 직접 저장하는 구조라
// 너무 큰 파일이 들어가지 않도록 클라이언트에서 먼저 막는다.
const MAX_IMAGE_SIZE_MB = 5

function AdminHotelDetailPage() {
  const { hotelId } = useParams<{ hotelId: string }>()
  const navigate = useNavigate()
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined)
  const [hotel, setHotel] = useState<AdminHotel | null>(null)
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null)
  const [stats, setStats] = useState<AdminHotelStats | null>(null)
  const [error, setError] = useState('')

  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<AdminRoomImageInput[]>([])
  const [imageError, setImageError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // hotelId가 바뀌면(다른 호텔 상세로 이동) 렌더링 중에 바로 이전 데이터를 비워
  // 새 호텔의 데이터가 도착하기 전까지 이전 호텔 정보가 잠깐 보이지 않게 한다.
  if (loadedFor !== hotelId) {
    setLoadedFor(hotelId)
    setHotel(null)
    setRooms(null)
    setStats(null)
    setError('')
    setIsAdding(false)
  }

  useEffect(() => {
    if (!hotelId) return
    let ignore = false

    Promise.all([fetchAdminHotelById(hotelId), fetchAdminHotelRooms(hotelId), fetchAdminHotelStats(hotelId)])
      .then(([hotelData, roomsData, statsData]) => {
        if (ignore) return
        setHotel(hotelData)
        setRooms(roomsData)
        setStats(statsData)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : '호텔 정보를 불러오지 못했습니다.')
      })

    return () => {
      ignore = true
    }
  }, [hotelId])

  const openAddForm = () => {
    setName('')
    setCapacity('')
    setDescription('')
    setImages([])
    setImageError('')
    setFormError('')
    setIsAdding(true)
  }

  // 선택한 이미지 파일들을 즉시 Base64로 변환해 미리보기 목록에 추가한다. 배열 순서 = 노출 순서(첫 번째가 대표 이미지).
  const handleImageFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 다시 선택해도 onChange가 발생하도록 초기화
    if (files.length === 0) return

    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024)
    if (oversized) {
      setImageError(`${oversized.name}의 용량이 너무 큽니다. (최대 ${MAX_IMAGE_SIZE_MB}MB)`)
      return
    }

    try {
      const converted = await Promise.all(files.map(readImageFileAsInput))
      setImages((prev) => [...prev, ...converted])
      setImageError('')
    } catch {
      setImageError('이미지를 불러오지 못했습니다.')
    }
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddRoom = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!hotelId) return

    const capacityNum = Number(capacity)
    if (!name.trim() || !Number.isInteger(capacityNum) || capacityNum < 1) {
      setFormError('이름과 정원(1 이상의 정수)을 올바르게 입력해주세요.')
      return
    }

    setIsSaving(true)
    setFormError('')
    try {
      const created = await createAdminRoom(hotelId, {
        name: name.trim(),
        capacity: capacityNum,
        description: description.trim() || undefined,
        images: images.length > 0 ? images : undefined,
      })
      setRooms((prev) => [...(prev ?? []), created])
      setIsAdding(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '객실을 등록하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section>
      <button type="button" className="admin-back-link" onClick={() => navigate('/admin/hotels')}>
        ← 호텔 목록으로
      </button>

      <div className="admin-page-header">
        <h1>호텔 상세</h1>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !hotel && <p className="admin-state">불러오는 중...</p>}

      {!error && hotel && (
        <div className="admin-card">
          <dl className="admin-detail-grid">
            <dt>ID</dt>
            <dd>{hotel.hotelId}</dd>
            <dt>이름</dt>
            <dd>{hotel.name}</dd>
            <dt>주소</dt>
            <dd>{hotel.address}</dd>
            <dt>전화번호</dt>
            <dd>{hotel.phoneNumber}</dd>
            <dt>설명</dt>
            <dd>{hotel.description || '-'}</dd>
          </dl>
        </div>
      )}

      {!error && stats && (
        <div className="admin-stat-grid">
          <div className="admin-card admin-stat-tile">
            <span className="admin-stat-label">오늘 예정된 체크인 / 체크아웃</span>
            <span className="admin-stat-value">
              {stats.checkInsToday} / {stats.checkOutsToday}
            </span>
          </div>
          <div className="admin-card admin-stat-tile">
            <span className="admin-stat-label">오늘 객실 점유율</span>
            <span className="admin-stat-value">
              {rooms && rooms.length > 0
                ? `${Math.round((stats.occupiedRoomsToday / rooms.length) * 100)}%`
                : '—%'}
            </span>
          </div>
          <div className="admin-card admin-stat-tile">
            <span className="admin-stat-label">오늘 매출 현황</span>
            <span className="admin-stat-value">₩{stats.revenueToday.toLocaleString()}</span>
          </div>
          <div className="admin-card admin-stat-tile">
            <span className="admin-stat-label">신규 예약 / 취소 건수</span>
            <span className="admin-stat-value">
              {stats.newReservationsToday} / {stats.cancellationsToday}
            </span>
          </div>
        </div>
      )}

      {!error && rooms && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>객실 목록</h2>
            {!isAdding && (
              <button type="button" className="admin-btn is-primary" onClick={openAddForm}>
                객실 추가
              </button>
            )}
          </div>
          <p className="admin-stat-note" style={{ marginBottom: 12 }}>
            객실을 누르면 상세 정보와 예약 가능 날짜 달력을 볼 수 있습니다.
          </p>

          {isAdding && (
            <form className="admin-form" onSubmit={handleAddRoom} noValidate>
              <label className="admin-form-row">
                <span>이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </label>
              <label className="admin-form-row">
                <span>정원</span>
                <input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  required
                />
              </label>
              <label className="admin-form-row">
                <span>설명</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="admin-form-row">
                <span>이미지</span>
                <input type="file" accept="image/*" multiple onChange={handleImageFilesSelected} />
              </label>

              {images.length > 0 && (
                <div className="admin-image-preview-grid">
                  {images.map((image, index) => (
                    <div className="admin-image-preview" key={index}>
                      <img src={toAdminImageDataUrl(image)} alt={`객실 이미지 ${index + 1}`} />
                      {index === 0 && <span className="admin-image-preview-badge">대표</span>}
                      <button
                        type="button"
                        className="admin-image-preview-remove"
                        onClick={() => removeImage(index)}
                        aria-label="이미지 삭제"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {imageError && <p className="admin-form-error">{imageError}</p>}

              {formError && <p className="admin-form-error">{formError}</p>}

              <div className="admin-form-actions">
                <button type="submit" className="admin-btn is-primary" disabled={isSaving}>
                  {isSaving ? '등록 중...' : '등록'}
                </button>
                <button type="button" className="admin-btn" onClick={() => setIsAdding(false)} disabled={isSaving}>
                  취소
                </button>
              </div>
            </form>
          )}

          {rooms.length === 0 ? (
            <p className="admin-state">등록된 객실이 없습니다.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>이미지</th>
                    <th>이름</th>
                    <th>정원</th>
                    <th>설명</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr
                      key={room.roomId}
                      onClick={() => navigate(`/admin/hotels/${hotelId}/rooms/${room.roomId}`)}
                    >
                      <td>{room.roomId}</td>
                      <td>
                        {room.images && room.images.length > 0 ? (
                          <img
                            className="admin-table-thumb"
                            src={toAdminImageDataUrl(room.images[0])}
                            alt={room.name}
                          />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{room.name}</td>
                      <td>{room.capacity}</td>
                      <td>{room.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default AdminHotelDetailPage
