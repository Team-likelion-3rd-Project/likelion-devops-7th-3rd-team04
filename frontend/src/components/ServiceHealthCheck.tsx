import { useState } from 'react'
import { SERVICES, fetchHello } from '../api/gateway'
import './ServiceHealthCheck.css'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface ResultState {
  status: Status
  message: string
}

const initialResults: Record<string, ResultState> = Object.fromEntries(
  SERVICES.map((service) => [service.key, { status: 'idle', message: '' }]),
)

function ServiceHealthCheck() {
  const [results, setResults] = useState<Record<string, ResultState>>(initialResults)

  const handleCheck = async (key: string, path: string) => {
    setResults((prev) => ({ ...prev, [key]: { status: 'loading', message: '' } }))

    try {
      const { message } = await fetchHello(path)
      setResults((prev) => ({ ...prev, [key]: { status: 'success', message } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류'
      setResults((prev) => ({ ...prev, [key]: { status: 'error', message } }))
    }
  }

  return (
    <section id="health-check">
      <h2>서비스 통신 테스트</h2>
      <p>api-gateway를 통해 각 마이크로서비스의 hello API를 호출합니다.</p>
      <ul className="service-list">
        {SERVICES.map(({ key, label, path }) => {
          const result = results[key]
          return (
            <li key={key} className="service-item">
              <button
                type="button"
                className="service-button"
                onClick={() => handleCheck(key, path)}
                disabled={result.status === 'loading'}
              >
                {label} {result.status === 'loading' ? '호출 중...' : '호출'}
              </button>
              {result.status === 'success' && (
                <p className="service-result success">{result.message}</p>
              )}
              {result.status === 'error' && (
                <p className="service-result error">에러: {result.message}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ServiceHealthCheck
