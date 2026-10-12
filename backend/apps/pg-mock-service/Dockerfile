# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# libs/common 과 pg-mock-service 빌드
RUN npm run build common
RUN npm run build pg-mock-service

# --- Production Stage ---
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# 🟢 [핵심] 공통 라이브러리와 앱 빌드 결과물을 모두 복사
COPY --from=builder /usr/src/app/dist/libs ./dist/libs
COPY --from=builder /usr/src/app/dist/apps/pg-mock-service ./dist/apps/pg-mock-service

EXPOSE 3007

CMD ["node", "dist/apps/pg-mock-service/main"]
