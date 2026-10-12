# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# libs/common 과 chat-bot-service 빌드
RUN npm run build common
RUN npm run build chat-bot-service

# --- Production Stage ---
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# 🟢 [핵심] 공통 라이브러리(proto 포함)와 앱 빌드 결과물을 모두 복사
COPY --from=builder /usr/src/app/dist/libs ./dist/libs
COPY --from=builder /usr/src/app/dist/apps/chat-bot-service ./dist/apps/chat-bot-service

# 🟢 chat-bot-service의 실제 gRPC 포트인 3001 지정
EXPOSE 3005

CMD ["node", "dist/apps/chat-bot-service/main"]