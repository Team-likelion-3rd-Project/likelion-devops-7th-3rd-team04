# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# libs/common 과 api-gateway 빌드
RUN npm run build common
RUN npm run build api-gateway

# --- Production Stage ---
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# 🟢 [핵심] 공통 라이브러리(proto 포함)와 앱 빌드 결과물을 모두 복사
COPY --from=builder /usr/src/app/dist/libs ./dist/libs
COPY --from=builder /usr/src/app/dist/apps/api-gateway ./dist/apps/api-gateway

EXPOSE 3000

CMD ["node", "dist/apps/api-gateway/main"]