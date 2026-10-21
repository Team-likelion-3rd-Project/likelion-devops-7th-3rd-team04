import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  createAdminRoom,
  fetchAdminHotelById,
  fetchAdminHotelRooms,
  fetchAdminHotelStats,
  readImageFileForPreview,
  ROOM_IMAGE_TYPES,
  updateAdminRoom,
  uploadAdminRoomImage,
} from '../../api/adminApi'
import type { AdminHotel, AdminHotelStats, AdminRoom, PendingRoomImage } from '../../api/adminApi'
import './AdminPages.css'

// 이미지 하나당 허용하는 최대 용량. 서버(업로드 URL 발급)도 5MB를 넘으면 거절하지만, 올리기 전에 화면에서 먼저 막는다.
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
  const [images, setImages] = useState<PendingRoomImage[]>([])
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

  // 선택한 이미지 파일들을 미리보기 목록에 추가한다. 배열 순서 = 노출 순서(첫 번째가 대표 이미지).
  // 저장소에는 객실 등록 뒤에 올린다 (사진 경로에 객실 id가 들어가기 때문).
  const handleImageFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 다시 선택해도 onChange가 발생하도록 초기화
    if (files.length === 0) return

    const unsupported = files.find((file) => !ROOM_IMAGE_TYPES.includes(file.type))
    if (unsupported) {
      setImageError(`${unsupported.name}은(는) 올릴 수 없는 형식입니다. (JPG·PNG·WEBP만 가능)`)
      return
    }
    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024)
    if (oversized) {
      setImageError(`${oversized.name}의 용량이 너무 큽니다. (최대 ${MAX_IMAGE_SIZE_MB}MB)`)
      return
    }

    try {
      const converted = await Promise.all(files.map(readImageFileForPreview))
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
    const input = {
      name: name.trim(),
      capacity: capacityNum,
      description: description.trim() || undefined,
    }
    let created: AdminRoom
    try {
      created = await createAdminRoom(hotelId, input)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '객실을 등록하지 못했습니다.')
      setIsSaving(false)
      return
    }

    // 객실을 먼저 등록하고, 받은 객실 id 경로로 사진을 올린 뒤 객실 수정으로 사진을 붙인다.
    try {
      if (images.length > 0) {
        const objectKeys = await Promise.all(
          images.map(({ file }) => uploadAdminRoomImage(hotelId, created.roomId, file)),
        )
        created = await updateAdminRoom(hotelId, created.roomId, {
          ...input,
          images: objectKeys.map((objectKey) => ({ objectKey })),
        })
      }
      setIsAdding(false)
    } catch (err) {
      const reason = err instanceof Error ? err.message : ''
      setFormError(`객실은 등록됐지만 사진을 올리지 못했습니다. 객실 상세에서 다시 올려 주세요. ${reason}`.trim())
    } finally {
      setRooms((prev) => [...(prev ?? []), created])
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
                <input type="file" accept={ROOM_IMAGE_TYPES.join(',')} multiple onChange={handleImageFilesSelected} />
              </label>

              {images.length > 0 && (
                <div className="admin-image-preview-grid">
                  {images.map((image, index) => (
                    <div className="admin-image-preview" key={index}>
                      <img src={image.previewUrl} alt={`객실 이미지 ${index + 1}`} />
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
                            src={room.images[0].imageUrl}
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
