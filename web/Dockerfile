# СтройКонтроль — образ фронтенда (сборка Vite + раздача через nginx).

FROM node:22-alpine AS build
WORKDIR /app

# Зависимости — отдельным слоем для кэширования.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .

# Базовый URL API прокидывается на этапе сборки (Vite вшивает его в бандл).
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
