# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# libs/common 과 auth-service 빌드
RUN npm run build common
RUN npm run build auth-service

# --- Production Stage ---
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# 🟢 [핵심] 공통 라이브러리(proto 포함)와 앱 빌드 결과물을 모두 복사
COPY --from=builder /usr/src/app/dist/libs ./dist/libs
COPY --from=builder /usr/src/app/dist/apps/auth-service ./dist/apps/auth-service

# 🟢 auth-service의 실제 gRPC 포트인 3006 지정
EXPOSE 3006

CMD ["node", "dist/apps/auth-service/main"]
