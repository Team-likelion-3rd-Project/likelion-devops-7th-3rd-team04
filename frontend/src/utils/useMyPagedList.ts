import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isUnauthorized, refreshAccessToken } from '../api/gateway'
import { currentLoginState } from './loginRedirect'

// 서버가 돌려주는 한 페이지 (items = 이 페이지 항목, total = 조건에 맞는 전체 개수)
export interface MyPage<T> {
  items: T[]
  total: number
}

// 마이페이지 목록(예약 내역·결제 내역)을 한 페이지씩 불러온다 — 목록 전체를 한 번에 받지 않는다 (부하 테스트 3일차 11-06).
// 첫 페이지를 불러오고, loadMore()로 다음 페이지를 이어 붙인다 ("더 보기").
// fetchPage·keyOf는 렌더마다 바뀌지 않는 함수(모듈 함수)를 넘긴다.
export function useMyPagedList<T>(
  fetchPage: (page: number) => Promise<MyPage<T>>,
  keyOf: (item: T) => number,
  errorMessage: string,
) {
  const navigate = useNavigate()

  const [items, setItems] = useState<T[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')

  useEffect(() => {
    let cancelled = false

    const apply = (data: MyPage<T>) => {
      if (cancelled) return
      setItems(data.items)
      setTotal(data.total)
      setPage(1)
    }

    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      setLoadMoreError('')
      try {
        apply(await fetchPage(1))
      } catch (err) {
        if (cancelled) return
        // fetch는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이 필요한 상태(401)가
        // 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError(errorMessage)
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          apply(await fetchPage(1))
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError(errorMessage)
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
  }, [fetchPage, errorMessage, navigate, retryTick])

  // 다음 페이지를 이어 붙인다. 그 사이 새 항목이 생기면 앞 페이지 끝 항목이 밀려 다시 올 수 있어 이미 있는 항목은 뺀다.
  const loadMore = useCallback(async () => {
    setIsLoadingMore(true)
    setLoadMoreError('')
    try {
      const data = await fetchPage(page + 1)
      setItems((prev) => {
        const seen = new Set((prev ?? []).map(keyOf))
        return [...(prev ?? []), ...data.items.filter((item) => !seen.has(keyOf(item)))]
      })
      setTotal(data.total)
      setPage((p) => p + 1)
    } catch {
      setLoadMoreError(errorMessage)
    } finally {
      setIsLoadingMore(false)
    }
  }, [fetchPage, keyOf, errorMessage, page])

  const retry = useCallback(() => setRetryTick((t) => t + 1), [])

  return {
    items,
    total,
    hasMore: items !== null && items.length < total,
    isLoading,
    loadError,
    retry,
    loadMore,
    isLoadingMore,
    loadMoreError,
  }
}
