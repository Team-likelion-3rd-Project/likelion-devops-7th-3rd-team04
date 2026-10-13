# --- Build Stage ---
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_API_URL 을 비워 두면 화면이 같은 출처의 /api/... 로 호출하고, Nginx가 api-gateway로 프록시한다.
# (환경마다 이미지를 다시 빌드하지 않기 위함. 특별히 다른 주소가 필요할 때만 --build-arg 로 지정)
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# --- Production Stage ---
FROM nginx:1.27-alpine AS production

# 실행 시 환경변수로 api-gateway 주소를 바꿀 수 있다. (예: docker run -e API_UPSTREAM=http://host.docker.internal:3000)
# nginx 공식 이미지가 /etc/nginx/templates/*.template 의 ${API_UPSTREAM} 을 치환해 default.conf 를 만든다.
ENV API_UPSTREAM=http://api-gateway:3000
ENV CLIENT_MAX_BODY_SIZE=20m

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /usr/src/app/dist /usr/share/nginx/html

EXPOSE 80
