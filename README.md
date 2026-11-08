# СтройКонтроль — платформа управления строительными проектами

Демонстрационный проект под вакансию **Full-stack разработчик для строительных
организаций** (компания **Mindia KZ**, грейд — senior, AI-native продукт).

**Что это:** B2B-платформа для строительных и проектных организаций — учёт
объектов и этапов, смет (бюджет против факта), исполнительной документации
(КС-2, КС-3, акты, счета), нормативной базы и **встроенного AI-ассистента**,
который работает только с данными платформы.

**Живое демо:** https://mindia-kz-edge.dvybornyh332.workers.dev
(SPA и API на одном Worker'е; ассистент — в офлайн-режиме).

**Демо-аккаунты** (пароль у всех — `demo1234`):

| Email | Роль | Кто это |
|---|---|---|
| `admin@mindia.kz` | admin | Айдос Смагулов — администратор |
| `manager@mindia.kz` | manager | Ержан Нурланов — руководитель проектов |
| `estimator@mindia.kz` | estimator | Мадина Ахметова — сметчик |
| `foreman@mindia.kz` | foreman | Дмитрий Ким — прораб |
| `customer@mindia.kz` | customer | Асель Жумабаева — заказчик |

> Демонстрационные учётные данные — публичные и намеренно простые. В реальном
> деплое они не используются (см. «Секреты и конфигурация»).

---

## Что можно попробовать прямо сейчас

| Сценарий | Где смотреть |
|---|---|
| Дашборд: сводка по портфелю объектов, бюджеты/факт, ожидающие согласования | Главная страница |
| CRUD объектов, этапов, прогресс, бюджет против факта | «Объекты» → карточка объекта |
| Сметы: позиции, итоги, категории | «Сметы» → карточка сметы |
| **Детерминированная AI-проверка смет**: дубли позиций, нулевые/завышенные цены, арифметические расхождения, аномальная доля одной позиции → риск-скор и список замечаний | Карточка сметы → «AI-проверка сметы» |
| Жизненный цикл сметы и документа: черновик → на проверке → утверждено/отклонено, с контролем прав и защитой от устаревших изменений (optimistic locking) | Те же карточки |
| Документы КС-2/КС-3/акты/счета; утверждение КС-2/КС-3 увеличивает фактические затраты объекта | «Документы» |
| Нормативная база (СН РК, СП РК, ГОСТ, СТ РК) с поиском | «Нормативы» |
| **AI-ассистент**: вопросы по данным платформы (объекты, бюджеты, сметы, документы, нормативы) через tool-calling; ответы только в границах продукта | «AI-ассистент» |
| Роли и права: прораб не может создавать/менять объекты (403), утверждать сметы/документы — только admin/manager | Войти разными аккаунтами |

---

## Соответствие требованиям вакансии

| Требование вакансии | Где реализовано |
|---|---|
| **Go в production**: API, бизнес-логика, БД, внешние сервисы | `backend/` — Go 1.24, `net/http` + chi, слои `internal/{api,service,store,domain,ai,auth,config}` |
| Обработка ошибок, **context**, **конкурентное выполнение** | `context.Context` протянут через все слои; `*server` с таймаутом запроса, graceful shutdown; конкурентные изменения защищены optimistic locking (`version`) |
| **React + TypeScript**, HTML/CSS, состояние, асинхронность, серверные данные, диагностика UI-ошибок | `web/` — React 18 + TS + Vite; контексты Auth/Toast, хук `useAsync` (loading/error/empty), строгая типизация ответов API |
| **PostgreSQL и SQL**: моделирование, транзакции, ограничения, индексы, миграции | Двойной драйвер (SQLite/PostgreSQL) над одним SQL; CHECK/UNIQUE/FK, индексы; миграции с версионированием; создание сметы с позициями — в одной транзакции |
| **HTTP/REST**, аутентификация и авторизация, конкурентные изменения, повторные запросы, совместимость API | REST `/api/v1/*`; JWT (HS256) + RBAC; оптимистичные версии → 409 `version_mismatch`; идемпотентные ошибки; стабильные контракты |
| Формы, таблицы, воркфлоу; loading, empty states, ошибки, повторы | Все страницы: состояния загрузки/пусто/ошибка+повтор; формы объектов/документов; пошаговые статусы смет и документов |
| Проверка сценариев, бизнес-логики, прав, статусов; исключения, повторные/конкурентные действия | Матрицы переходов статусов, проверки прав на утверждение, optimistic locking, валидация входных данных |
| **AI-агенты**: подготовка контекста, постановка задач, ревью; **AI-функции**: модели к данным, знаниям и инструментам, права доступа, контроль пользователя, проверка качества | `internal/ai/` — LLM-клиент (OpenAI-совместимый), tool-calling, RAG по нормативам, системный промпт, ограниченный продуктом, лимит токенов, офлайн-fallback |
| Unit, интеграционные и E2E-тесты; проверка ключевых сценариев на реальном бэкенде и БД | `backend/**/*_test.go` (интеграционные на реальной SQLite, unit на сервисах), `web/src/**/*.test.ts` (vitest) |
| Git и Docker | `Dockerfile` (multi-stage, healthcheck), `docker-compose.yml` (+ Postgres-профиль); репозиторий в Git |
| Логи, метрики, разбор сбоев, производительность, документация | Структурные логи старта; `GET /healthz`; graceful shutdown; `README.md` + `ARCHITECTURE.md` (ADR) |

**Будет плюсом** (реализовано частично, см. ARCHITECTURE.md): B2B/корпоративные
системы (да, B2B), документооборот (КС-2/КС-3/акты), строительная предметная
область, работа AI-функций и контроль качества/стоимости (лимит токенов).
Python/CAD/BIM — осознанно вне объёма (см. ARCHITECTURE.md).

---

## Структура

```
mindia-KZ-demo-work/
├── backend/                     # Go 1.24 — API платформы
│   ├── cmd/server/main.go        # точка входа: конфиг → БД → миграции → seed → сервер
│   └── internal/
│       ├── config/               # конфигурация из переменных окружения
│       ├── domain/               # модели и типизированные ошибки
│       ├── store/                # репозитории, миграции (sqlite/ + postgres/), seed
│       ├── service/              # бизнес-логика, порты (интерфейсы), матрицы статусов
│       ├── auth/                 # JWT (HS256) + bcrypt
│       ├── ai/                   # LLM-клиент, tool-calling, RAG, ассистент
│       └── api/                  # chi-роутер, middleware, хендлеры, маппинг ошибок
├── web/                         # React 18 + TypeScript (Vite)
│   └── src/
│       ├── pages/                # Дашборд, Объекты, Сметы, Документы, Нормативы, AI
│       ├── components/           # layout, guard, модалка, UI-примитивы
│       ├── context/              # AuthContext, ToastContext
│       ├── services/api.ts       # типизированный клиент API
│       ├── lib/                  # форматирование денег/дат, useAsync
│       └── types.ts              # типы ответов API
├── edge/                         # Cloudflare Worker + D1 — edge-двойник API
│   ├── migrations/               # та же схема (0001_init.sql) для D1
│   ├── src/
│   │   ├── index.ts              # Hono-роутер, тот же HTTP-контракт, что у Go
│   │   ├── repositories/         # D1-запросы (те же правила блокировок/конфликтов)
│   │   ├── services/             # матрицы переходов, анализ смет
│   │   ├── ai/offline.ts         # детерминированный офлайн-ассистент + бюджет 500k
│   │   ├── lib/                  # PBKDF2 + JWT (Web Crypto), ошибки, утилиты
│   │   └── db/seed.sql           # те же демо-данные
│   └── wrangler.toml             # [assets]: SPA и API на одном домене Worker'а
├── docs/                        # скриншоты (опционально)
├── docker-compose.yml           # api (SQLite) + web
├── docker-compose.postgres.yml  # override: PostgreSQL
└── .gitignore
```

---

## Локальный запуск

### Вариант 1. Без Docker (SQLite, ничего ставить не нужно кроме Go и Node)

```bash
# --- Бэкенд ---
cd backend
go run ./cmd/server
# API на http://localhost:8080  (health: http://localhost:8080/healthz)

# --- Фронтенд (в другом терминале) ---
cd web
npm install
npm run dev
# интерфейс на http://localhost:5173
```

Данные по умолчанию — SQLite-файл `backend/data/mindia.db`, создаётся и
наполняется автоматически при первом запуске.

### Вариант 2. Docker (полный стек одним махом)

```bash
# Лёгкий вариант — SQLite
docker compose up --build
# → интерфейс http://localhost:8088, API http://localhost:8080

# Вариант «как в production» — PostgreSQL
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
```

### Вариант 3. Локально, но с PostgreSQL

```bash
cd backend
DB_DRIVER=postgres \
DATABASE_URL="postgres://mindia:mindia@localhost:5432/mindia?sslmode=disable" \
go run ./cmd/server
```

Схема и SQL едины для обоих драйверов; различает их только `DB_DRIVER`.

---

## Тесты и статический анализ

```bash
# --- Бэкенд ---
cd backend
go vet ./...
go test ./...                # интеграционные (реальная SQLite) + unit
go test ./internal/store/ -race -count=1
# Против реального PostgreSQL:
TEST_DATABASE_URL="postgres://.../mindia_test?sslmode=disable" go test ./...

# --- Фронтенд ---
cd web
npm run typecheck            # tsc --noEmit
npm test                     # vitest
npm run build                # прод-сборка

# --- Edge-двойник (Cloudflare Worker) ---
cd edge
npm run typecheck            # tsc --noEmit
npm test                     # vitest: PBKDF2/JWT, матрицы переходов, анализ, AI-роутинг
```

---

## Деплой

**Живое демо (Cloudflare, один домен):** https://mindia-kz-edge.dvybornyh332.workers.dev

Вариант 1 — edge-двойник на Cloudflare Workers (SPA и API на одном домене,
без контейнеров и без отдельного хостинга):

```bash
cd edge
npx --yes wrangler@4 d1 migrations apply mindia-kz --remote
npx --yes wrangler@4 d1 execute mindia-kz --remote --file=src/db/seed.sql
cd ../web && npm run build && cd ../edge
cp -r ../web/dist ./dist       # Windows: Copy-Item -Recurse web/dist edge/dist
npx --yes wrangler@4 secret put JWT_SECRET
npx --yes wrangler@4 deploy
```

Раздача статики настроена в `edge/wrangler.toml` через `[assets]`
(`not_found_handling = "single-page-application"`, `run_worker_first` для
`/api/*` и `/healthz`) — Worker обслуживает и SPA, и API на одном origin,
CORS не нужен. Ассистент в edge-варианте работает в детерминированном
офлайн-режиме (тот же контракт ответов, без внешнего LLM).

Вариант 2 — эталонный Go-бэкенд на контейнерном хостинге:

- **Фронтенд** — Cloudflare Pages: `cd web && npm run build`, каталог `dist/`,
  переменная сборки `VITE_API_BASE_URL` указывает на адрес API.
- **Бэкенд** — любой контейнерный хостинг (Railway / Fly.io / VPS):
  `backend/Dockerfile`, персистентный том под `/data` (SQLite) или внешний
  PostgreSQL через `DATABASE_URL`.
- В production обязательны `JWT_SECRET` (≥ 16 символов), точный список
  `FRONTEND_ORIGINS` и включённый HTTPS.

---

## Секреты и конфигурация

- Все параметры читаются из переменных окружения; пример — `backend/.env.example`.
- `JWT_SECRET` обязателен в production (валидация при старте); в development
  генерируется небезопасный дефолт с предупреждением.
- Ключ LLM (`AI_API_KEY`) и адрес (`AI_BASE_URL`) — только через окружение, в
  код не попадают. Без ключа ассистент переходит в детерминированный
  офлайн-режим, поэтому демо работает и без внешнего провайдера.
- Демо-аккаунты создаются сидером только для пустой базы и намеренно публичны.

---

## Архитектурные решения

Обоснование ключевых решений (двойной драйвер БД, слои, optimistic locking,
ограниченный AI-ассистент, бюджет токенов, RBAC) — в
[ARCHITECTURE.md](ARCHITECTURE.md).
