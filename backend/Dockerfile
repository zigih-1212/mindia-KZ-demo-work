# СтройКонтроль — образ Go-бэкенда.
# Сборка статического бинарника без CGO: драйвер SQLite (modernc.org/sqlite)
# реализован на чистом Go, поэтому внешние системные библиотеки не нужны.
FROM golang:1.24-alpine AS build

WORKDIR /src

# Сначала только манифесты зависимостей — слой кэшируется между сборками.
COPY go.mod go.sum ./
RUN go mod download

# Затем исходники и сборка.
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/mindia-server ./cmd/server

# Минимальный рантайм-образ.
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget

WORKDIR /app
COPY --from=build /out/mindia-server /app/mindia-server

# Значения по умолчанию; переопределяются переменными окружения / docker-compose.
ENV APP_ADDR=:8080 \
    APP_ENV=production \
    DB_DRIVER=sqlite \
    DATA_DIR=/data

# Каталог данных SQLite (для драйвера postgres не используется).
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/mindia-server"]
