import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  // 이 값이 바뀌면(다른 주소로 이동하면) 오류 상태를 풀고 다시 그린다 — 보통 location.pathname
  resetKey?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  resetKey?: string
}

/** 화면을 그리다 오류가 나면 앱 전체가 하얀 화면이 되는 대신 fallback을 보여준다 (LDP-158).
 * React는 렌더링 오류를 잡는 기능을 클래스 컴포넌트로만 제공한다. 이벤트 핸들러·API 호출 오류는 각 화면이 처리한다. */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    resetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { hasError: false, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면 오류', error, info.componentStack)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

export default ErrorBoundary
