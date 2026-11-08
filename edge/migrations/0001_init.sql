-- Схема edge-двойника (D1). Копия схемы SQLite из
-- backend/internal/store/migrations/sqlite/0001_init.sql — контракты идентичны.
-- Деньги — в минорных единицах (тиыны) как INTEGER.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    position      TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL CHECK (role IN ('admin','manager','estimator','foreman','customer')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);

CREATE TABLE IF NOT EXISTS projects (
    id                   TEXT PRIMARY KEY,
    code                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    customer             TEXT NOT NULL DEFAULT '',
    address              TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL CHECK (status IN ('planning','active','suspended','completed')),
    budget_minor         INTEGER NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
    spent_minor          INTEGER NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    contract_amount_minor INTEGER NOT NULL DEFAULT 0,
    start_date           TEXT NOT NULL DEFAULT '',
    planned_end_date     TEXT NOT NULL DEFAULT '',
    actual_end_date      TEXT NOT NULL DEFAULT '',
    manager_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
    progress_percent     INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    version              INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS ix_projects_manager ON projects(manager_id);
CREATE INDEX IF NOT EXISTS ix_projects_created ON projects(created_at);

CREATE TABLE IF NOT EXISTS project_stages (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    sequence         INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL CHECK (status IN ('pending','active','done','cancelled')),
    planned_start    TEXT NOT NULL DEFAULT '',
    planned_end      TEXT NOT NULL DEFAULT '',
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    planned_minor    INTEGER NOT NULL DEFAULT 0,
    actual_minor     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_stages_project ON project_stages(project_id, sequence);

CREATE TABLE IF NOT EXISTS estimates (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_id      TEXT REFERENCES project_stages(id) ON DELETE SET NULL,
    number        TEXT NOT NULL,
    name          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('draft','on_review','approved','rejected','archived')),
    currency      TEXT NOT NULL DEFAULT 'KZT',
    total_minor   INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    created_by    TEXT NOT NULL REFERENCES users(id),
    approved_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at   TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (project_id, number)
);
CREATE INDEX IF NOT EXISTS ix_estimates_project ON estimates(project_id);
CREATE INDEX IF NOT EXISTS ix_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS ix_estimates_created ON estimates(created_at);

CREATE TABLE IF NOT EXISTS estimate_items (
    id               TEXT PRIMARY KEY,
    estimate_id      TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL DEFAULT 0,
    code             TEXT NOT NULL DEFAULT '',
    name             TEXT NOT NULL,
    unit             TEXT NOT NULL DEFAULT '',
    quantity         REAL NOT NULL DEFAULT 0,
    unit_price_minor INTEGER NOT NULL DEFAULT 0,
    total_minor      INTEGER NOT NULL DEFAULT 0,
    category         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_items_estimate ON estimate_items(estimate_id, position);

CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK (type IN ('ks2','ks3','invoice','act','other')),
    number        TEXT NOT NULL,
    title         TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected')),
    period_from   TEXT NOT NULL DEFAULT '',
    period_to     TEXT NOT NULL DEFAULT '',
    amount_minor  INTEGER NOT NULL DEFAULT 0,
    created_by    TEXT NOT NULL REFERENCES users(id),
    approved_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at   TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (project_id, number)
);
CREATE INDEX IF NOT EXISTS ix_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS ix_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS ix_documents_type ON documents(type);

CREATE TABLE IF NOT EXISTS materials (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    unit             TEXT NOT NULL DEFAULT '',
    planned_qty      REAL NOT NULL DEFAULT 0,
    used_qty         REAL NOT NULL DEFAULT 0,
    unit_price_minor INTEGER NOT NULL DEFAULT 0,
    supplier         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_materials_project ON materials(project_id);

CREATE TABLE IF NOT EXISTS activity (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT NOT NULL REFERENCES users(id),
    actor_name  TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_activity_created ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_activity_entity ON activity(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS normative_docs (
    id       TEXT PRIMARY KEY,
    code     TEXT NOT NULL,
    title    TEXT NOT NULL,
    section  TEXT NOT NULL DEFAULT '',
    content  TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_normative_code ON normative_docs(code);

CREATE TABLE IF NOT EXISTS ai_conversations (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_conv_user ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    tool_name       TEXT NOT NULL DEFAULT '',
    tokens_in       INTEGER NOT NULL DEFAULT 0,
    tokens_out      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_msg_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage (
    scope      TEXT PRIMARY KEY,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    requests   INTEGER NOT NULL DEFAULT 0
);
