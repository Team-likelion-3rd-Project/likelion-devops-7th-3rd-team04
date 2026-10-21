import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 개발 서버 전용: 브라우저는 localhost:5173/api 로만 호출하고 Vite가 클러스터 API로 대신 전달한다.
  // 같은 출처 호출이라 refreshToken 쿠키(SameSite=Lax)가 정상 동작하고 CORS 설정도 필요 없다.
  // 예) VITE_DEV_API_PROXY=http://k8s-control-plane.<tailnet>.ts.net:30080 (Traefik → api-gateway)
  //     컨트롤 플레인 이름은 바뀔 수 있으니 `tailscale status`로 확인한다 (.env.example 참고).
  const apiProxyTarget = env.VITE_DEV_API_PROXY

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: apiProxyTarget
      ? {
          proxy: {
            '/api': { target: apiProxyTarget, changeOrigin: true },
            '/api-docs': { target: apiProxyTarget, changeOrigin: true },
          },
        }
      : undefined,
  }
})
