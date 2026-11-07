package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// newTestDB открывает реальную SQLite-базу во временном каталоге, накатывает
// миграции и (по желанию) заполняет демо-данными. Это интеграционный тест
// против настоящей БД — так, как этого требует вакансия.
func newTestDB(t *testing.T) *DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "test.db")
	db, err := Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("Open(sqlite): %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return db
}

// newSeededDB дополнительно заполняет базу демонстрационными данными.
func newSeededDB(t *testing.T) *DB {
	t.Helper()
	db := newTestDB(t)
	if err := Seed(context.Background(), db); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return db
}

// --- Миграции ---------------------------------------------------------------

func TestMigrate_CreatesSchemaAndIsIdempotent(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	// Повторный накат миграций не должен падать и не должен дублировать таблицы.
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("повторная миграция: %v", err)
	}

	for _, table := range []string{
		"users", "projects", "project_stages", "estimates", "estimate_items",
		"documents", "materials", "activity", "normative_docs",
		"ai_conversations", "ai_messages", "ai_usage",
	} {
		var name string
		err := db.QueryRowContext(ctx,
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name)
		if err != nil {
			t.Errorf("таблица %q не создана: %v", table, err)
		}
	}
}

// --- Демо-данные ------------------------------------------------------------

func TestSeed_PopulatesAndIsIdempotent(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()

	users := NewUserRepo(db)
	n, err := users.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if n != 5 {
		t.Errorf("пользователей = %d, ожидалось 5", n)
	}

	projects := NewProjectRepo(db)
	res, err := projects.List(ctx, service.ProjectFilter{}, domain.Page{Limit: 100})
	if err != nil {
		t.Fatalf("List projects: %v", err)
	}
	if res.Total != 5 {
		t.Errorf("объектов = %d, ожидалось 5", res.Total)
	}

	norms := NewNormativeRepo(db)
	docs, err := norms.List(ctx)
	if err != nil {
		t.Fatalf("List normative: %v", err)
	}
	if len(docs) != 8 {
		t.Errorf("нормативных документов = %d, ожидалось 8", len(docs))
	}

	var scope string
	if err := db.QueryRowContext(ctx, `SELECT scope FROM ai_usage`).Scan(&scope); err != nil {
		t.Fatalf("ai_usage не заполнен: %v", err)
	}

	// Повторный вызов Seed — не должен дублировать данные.
	if err := Seed(ctx, db); err != nil {
		t.Fatalf("повторный Seed: %v", err)
	}
	n2, _ := users.Count(ctx)
	if n2 != 5 {
		t.Errorf("после повторного Seed пользователей = %d, ожидалось 5", n2)
	}
}

// --- Пользователи -----------------------------------------------------------

func TestUserRepo_ConflictsAndLookups(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	repo := NewUserRepo(db)

	// GetByEmail нечувствителен к регистру.
	u, err := repo.GetByEmail(ctx, "ADMIN@Mindia.KZ")
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}
	if u.Role != domain.RoleAdmin {
		t.Errorf("role = %q, ожидалось admin", u.Role)
	}

	// Неизвестный id -> ErrNotFound.
	if _, err := repo.GetByID(ctx, "no-such-id"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("GetByID(unknown) = %v, ожидалось ErrNotFound", err)
	}

	// Дубликат email -> ErrConflict.
	dup := &domain.User{
		ID: "u-dup", Email: "admin@mindia.kz", PasswordHash: "x", FullName: "Дубль",
		Role: domain.RoleForeman, IsActive: true, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := repo.Create(ctx, dup); !errors.Is(err, domain.ErrConflict) {
		t.Errorf("Create(duplicate) = %v, ожидалось ErrConflict", err)
	}
}

// --- Объекты: оптимистическая блокировка, AddSpent, фильтры, сводка ---------

func TestProjectRepo_OptimisticLockingAndAddSpent(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	repo := NewProjectRepo(db)

	// Находим любой объект.
	list, err := repo.List(ctx, service.ProjectFilter{}, domain.Page{Limit: 1})
	if err != nil || len(list.Items) == 0 {
		t.Fatalf("List: %v (items=%d)", err, len(list.Items))
	}
	orig := list.Items[0]
	id := orig.ID
	oldVersion := orig.Version

	upd := orig
	upd.Name = "Изменённое имя"
	if err := repo.Update(ctx, &upd); err != nil {
		t.Fatalf("Update(корректная версия): %v", err)
	}
	after, err := repo.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if after.Name != "Изменённое имя" {
		t.Errorf("имя не сохранилось: %q", after.Name)
	}
	if after.Version != oldVersion+1 {
		t.Errorf("версия = %d, ожидалось %d", after.Version, oldVersion+1)
	}

	// Повторное обновление со СТАРОЙ версией -> конфликт версий.
	stale := *after
	stale.Name = "Ещё раз"
	stale.Version = oldVersion // старая версия
	if err := repo.Update(ctx, &stale); !errors.Is(err, domain.ErrVersionMismatch) {
		t.Errorf("Update(stale) = %v, ожидалось ErrVersionMismatch", err)
	}

	// Обновление несуществующего объекта -> ErrNotFound.
	ghost := *after
	ghost.ID = "ghost"
	ghost.Version = after.Version
	if err := repo.Update(ctx, &ghost); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("Update(ghost) = %v, ожидалось ErrNotFound", err)
	}

	// AddSpent увеличивает факт.
	before, _ := repo.GetByID(ctx, id)
	if err := repo.AddSpent(ctx, id, 500); err != nil {
		t.Fatalf("AddSpent: %v", err)
	}
	afterSpent, _ := repo.GetByID(ctx, id)
	if afterSpent.SpentMinor != before.SpentMinor+500 {
		t.Errorf("spent = %d, ожидалось %d", afterSpent.SpentMinor, before.SpentMinor+500)
	}
}

func TestProjectRepo_ListFiltersAndSummary(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	repo := NewProjectRepo(db)

	active, err := repo.List(ctx, service.ProjectFilter{Status: string(domain.ProjectActive)}, domain.Page{Limit: 100})
	if err != nil {
		t.Fatalf("List(active): %v", err)
	}
	if active.Total != 2 {
		t.Errorf("активных объектов = %d, ожидалось 2", active.Total)
	}

	bySearch, err := repo.List(ctx, service.ProjectFilter{Search: "Алатау"}, domain.Page{Limit: 100})
	if err != nil {
		t.Fatalf("List(search): %v", err)
	}
	if bySearch.Total != 1 {
		t.Errorf("по поиску 'Алатау' найдено %d, ожидалось 1", bySearch.Total)
	}

	sum, err := repo.Summary(ctx)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if sum.ProjectsTotal != 5 {
		t.Errorf("ProjectsTotal = %d, ожидалось 5", sum.ProjectsTotal)
	}
	if sum.ProjectsActive != 2 {
		t.Errorf("ProjectsActive = %d, ожидалось 2", sum.ProjectsActive)
	}
	if sum.EstimatesTotal != 7 {
		t.Errorf("EstimatesTotal = %d, ожидалось 7", sum.EstimatesTotal)
	}
	if len(sum.BudgetsByProject) == 0 {
		t.Error("BudgetsByProject пуст")
	}
}

// --- Сметы: транзакция, позиции, пересчёт, версии, уникальность -------------

func TestEstimateRepo_CreateItemsAndTotals(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	users := NewUserRepo(db)
	projects := NewProjectRepo(db)
	repo := NewEstimateRepo(db)

	admin, err := users.GetByEmail(ctx, "admin@mindia.kz")
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}
	plist, _ := projects.List(ctx, service.ProjectFilter{}, domain.Page{Limit: 1})
	projectID := plist.Items[0].ID

	est := &domain.Estimate{
		ID: "est-1", ProjectID: projectID, Number: "ТЕСТ-001", Name: "Тестовая смета",
		Status: domain.EstimateDraft, Currency: "KZT", TotalMinor: 300,
		CreatedBy: admin.ID, Version: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	items := []domain.EstimateItem{
		{ID: "it-1", Position: 1, Name: "Позиция A", Unit: "м2", Quantity: 2, UnitPriceMinor: 100, TotalMinor: 200, Category: "Работы"},
		{ID: "it-2", Position: 2, Name: "Позиция B", Unit: "шт", Quantity: 1, UnitPriceMinor: 100, TotalMinor: 100, Category: "Материалы"},
	}
	if err := repo.Create(ctx, est, items); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByID(ctx, "est-1")
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ItemCount != 2 {
		t.Errorf("ItemCount = %d, ожидалось 2", got.ItemCount)
	}

	gotItems, err := repo.ListItems(ctx, "est-1")
	if err != nil {
		t.Fatalf("ListItems: %v", err)
	}
	if len(gotItems) != 2 || gotItems[0].Position != 1 || gotItems[1].Position != 2 {
		t.Errorf("позиции не по порядку: %+v", gotItems)
	}

	// RecomputeTotal равен сумме позиций.
	total, err := repo.RecomputeTotal(ctx, "est-1")
	if err != nil {
		t.Fatalf("RecomputeTotal: %v", err)
	}
	if total != 300 {
		t.Errorf("итог = %d, ожидалось 300", total)
	}

	// Дубликат номера сметы для того же объекта -> конфликт.
	dup := *est
	dup.ID = "est-dup"
	if err := repo.Create(ctx, &dup, nil); !errors.Is(err, domain.ErrConflict) {
		t.Errorf("Create(duplicate number) = %v, ожидалось ErrConflict", err)
	}

	// UpdateStatus со старой версией -> конфликт версий.
	if err := repo.UpdateStatus(ctx, "est-1", domain.EstimateOnReview, "", 999); !errors.Is(err, domain.ErrVersionMismatch) {
		t.Errorf("UpdateStatus(stale) = %v, ожидалось ErrVersionMismatch", err)
	}
}

// --- Нормативная база: поиск ------------------------------------------------

func TestNormativeRepo_Search(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	repo := NewNormativeRepo(db)

	found, err := repo.Search(ctx, "фундамент", 5)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(found) == 0 {
		t.Error("поиск по 'фундамент' не вернул результатов")
	}

	none, err := repo.Search(ctx, "zzzqqqxyz", 5)
	if err != nil {
		t.Fatalf("Search(nonsense): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("поиск по бессмысленному запросу вернул %d документов, ожидалось 0", len(none))
	}
}

// --- ИИ: диалоги, порядок сообщений, расход токенов, изоляция по владельцу --

func TestAIRepo_ConversationsMessagesAndUsage(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	users := NewUserRepo(db)
	repo := NewAIRepo(db)

	admin, _ := users.GetByEmail(ctx, "admin@mindia.kz")
	foreman, _ := users.GetByEmail(ctx, "foreman@mindia.kz")

	base := time.Now().UTC()
	convA := &domain.AIConversation{ID: "c-admin", UserID: admin.ID, Title: "A", CreatedAt: base, UpdatedAt: base}
	convB := &domain.AIConversation{ID: "c-foreman", UserID: foreman.ID, Title: "B", CreatedAt: base, UpdatedAt: base}
	if err := repo.CreateConversation(ctx, convA); err != nil {
		t.Fatalf("CreateConversation A: %v", err)
	}
	if err := repo.CreateConversation(ctx, convB); err != nil {
		t.Fatalf("CreateConversation B: %v", err)
	}

	// GetConversation несуществующего -> ErrNotFound.
	if _, err := repo.GetConversation(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("GetConversation(unknown) = %v, ожидалось ErrNotFound", err)
	}

	// Сообщения с разным временем -> хронологический порядок.
	for i, role := range []string{"user", "assistant", "user"} {
		m := &domain.AIMessage{
			ID:             "m-" + role + "-" + string(rune('0'+i)),
			ConversationID: convA.ID, Role: role, Content: role + " msg",
			CreatedAt: base.Add(time.Duration(i) * time.Second),
		}
		if err := repo.AppendMessage(ctx, m); err != nil {
			t.Fatalf("AppendMessage: %v", err)
		}
	}
	msgs, err := repo.ListMessages(ctx, convA.ID, 100)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("сообщений = %d, ожидалось 3", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[2].Role != "user" {
		t.Errorf("нарушен хронологический порядок: %+v", msgs)
	}

	// Изоляция диалогов по владельцу.
	adminConvs, err := repo.ListConversations(ctx, admin.ID, 10)
	if err != nil {
		t.Fatalf("ListConversations: %v", err)
	}
	if len(adminConvs) != 1 || adminConvs[0].ID != convA.ID {
		t.Errorf("админ видит %d диалогов, ожидался только свой", len(adminConvs))
	}

	// Накопление расхода токенов.
	if err := repo.AddUsage(ctx, 100, 50); err != nil {
		t.Fatalf("AddUsage 1: %v", err)
	}
	if err := repo.AddUsage(ctx, 200, 80); err != nil {
		t.Fatalf("AddUsage 2: %v", err)
	}
	usage, err := repo.Usage(ctx)
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if usage.TokensIn != 300 || usage.TokensOut != 130 {
		t.Errorf("usage in/out = %d/%d, ожидалось 300/130", usage.TokensIn, usage.TokensOut)
	}
	if usage.Requests != 2 {
		t.Errorf("requests = %d, ожидалось 2", usage.Requests)
	}
}

// --- Журнал действий --------------------------------------------------------

func TestActivityRepo_AddListAndByEntity(t *testing.T) {
	db := newSeededDB(t)
	ctx := context.Background()
	repo := NewActivityRepo(db)

	// actor_id ссылается на users(id), поэтому берём реальных пользователей из сида.
	users := NewUserRepo(db)
	admin, err := users.GetByEmail(ctx, "admin@mindia.kz")
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}
	manager, err := users.GetByEmail(ctx, "manager@mindia.kz")
	if err != nil {
		t.Fatalf("GetByEmail: %v", err)
	}

	base := time.Now().UTC()
	entries := []*domain.Activity{
		{ID: "a1", ActorID: admin.ID, ActorName: admin.FullName, Action: "create", EntityType: "project", EntityID: "p1", Summary: "первый", CreatedAt: base},
		{ID: "a2", ActorID: admin.ID, ActorName: admin.FullName, Action: "update", EntityType: "project", EntityID: "p1", Summary: "второй", CreatedAt: base.Add(time.Second)},
		{ID: "a3", ActorID: manager.ID, ActorName: manager.FullName, Action: "create", EntityType: "estimate", EntityID: "e1", Summary: "третий", CreatedAt: base.Add(2 * time.Second)},
	}
	for _, e := range entries {
		if err := repo.Add(ctx, e); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	list, err := repo.List(ctx, 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 || list[0].ID != "a3" {
		t.Errorf("List не свежие-первыми: %+v", list)
	}

	byEntity, err := repo.ListByEntity(ctx, "project", "p1", 10)
	if err != nil {
		t.Fatalf("ListByEntity: %v", err)
	}
	if len(byEntity) != 2 {
		t.Errorf("по сущности project/p1 найдено %d, ожидалось 2", len(byEntity))
	}
}

// TestPostgres_Integration прогоняет ключевые проверки на реальном PostgreSQL,
// если задан TEST_DATABASE_URL. Без переменной тест пропускается, а не падает.
func TestPostgres_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL не задан — тест PostgreSQL пропущен")
	}
	db, err := Open("postgres", dsn)
	if err != nil {
		t.Fatalf("Open(postgres): %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("Migrate(postgres): %v", err)
	}
	// Проверяем, что Rebind переводит '?' в $n и SQL исполняется.
	var n int
	if err := db.QueryRowContext(ctx, db.Rebind(`SELECT COUNT(*) FROM users WHERE role = ?`), "admin").Scan(&n); err != nil {
		t.Fatalf("query after Rebind: %v", err)
	}
}
