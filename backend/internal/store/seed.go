package store

import (
	"context"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// DemoPassword — единый пароль демо-аккаунтов.
const DemoPassword = "demo1234"

// Seed наполняет пустую базу демонстрационными данными строительной компании.
// Идемпотентна: если пользователи уже есть, ничего не делает.
func Seed(ctx context.Context, db *DB) error {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seeder := &seeder{db: db, ctx: ctx}
	return seeder.run()
}

type seeder struct {
	db  *DB
	ctx context.Context
}

// exec — обёртка над ExecContext с подстановкой плейсхолдеров под диалект.
func (s *seeder) exec(query string, args ...any) error {
	_, err := s.db.ExecContext(s.ctx, s.db.Rebind(query), args...)
	return err
}

// id возвращает новый UUID.
func newID() string { return uuid.NewString() }

func (s *seeder) run() error {
	users, err := s.seedUsers()
	if err != nil {
		return err
	}
	if err := s.seedNormative(); err != nil {
		return err
	}
	if err := s.seedProjects(users); err != nil {
		return err
	}
	// ai_usage — единственная строка глобального бюджета демо-режима.
	if err := s.exec(`INSERT INTO ai_usage (scope, tokens_in, tokens_out, requests)
		VALUES ('global', 0, 0, 0)`); err != nil && !isUniqueViolation(err) {
		return err
	}
	return nil
}

// demoAccounts — состав демо-пользователей (роли покрывают RBAC-модель).
var demoAccounts = []struct {
	Email    string
	FullName string
	Position string
	Role     domain.Role
}{
	{"admin@mindia.kz", "Айдос Смагулов", "Администратор платформы", domain.RoleAdmin},
	{"manager@mindia.kz", "Ержан Нурланов", "Руководитель проектов", domain.RoleManager},
	{"estimator@mindia.kz", "Мадина Ахметова", "Инженер-сметчик", domain.RoleEstimator},
	{"foreman@mindia.kz", "Дмитрий Ким", "Производитель работ", domain.RoleForeman},
	{"customer@mindia.kz", "Асель Жумабаева", "Представитель заказчика", domain.RoleCustomer},
}

// seedUsers создаёт пользователей и возвращает карту email→id.
func (s *seeder) seedUsers() (map[string]string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(DemoPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	now := fmtTime(nowUTC())
	ids := make(map[string]string, len(demoAccounts))
	for _, a := range demoAccounts {
		id := newID()
		ids[a.Email] = id
		if err := s.exec(`INSERT INTO users
			(id, email, password_hash, full_name, position, role, is_active, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			id, a.Email, string(hash), a.FullName, a.Position, string(a.Role), now, now); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// normativeSeed — фрагменты нормативной базы для RAG-поиска ассистента.
// Источники: действующие строительные нормы РК и межгосударственные стандарты.
var normativeSeed = []struct {
	Code     string
	Title    string
	Section  string
	Keywords string
	Content  string
}{
	{
		Code: "СН РК 1.02-01-2011", Title: "Инструкция по разработке проектов организации строительства",
		Section: "Раздел 4. Состав ПОС", Keywords: "пос строительство организация календарный план этапы",
		Content: "Проект организации строительства (ПОС) входит в состав проектной документации и включает календарный план строительства, ведомость объёмов работ, график потребности в материально-технических ресурсах. Стоимость строительства определяется сводным сметным расчётом. Для объектов производственного назначения дополнительно разрабатывается проект производства работ (ППР).",
	},
	{
		Code: "СП РК 3.02-101-2012", Title: "Жилые здания. Общие положения",
		Section: "Раздел 5. Конструктивные решения", Keywords: "жилые здания несущие конструкции монолит каркас",
		Content: "Несущие конструктивные элементы жилых зданий должны обеспечивать прочность, жёсткость и устойчивость при восприятии расчётных нагрузок. Монолитный железобетонный каркас допускается проектировать с классом бетона не ниже B25 по прочности. Армирование выполняется с учётом требований по минимальному проценту армирования.",
	},
	{
		Code: "ГОСТ 21.501-2018", Title: "Правила выполнения рабочей документации архитектурных и конструктивных решений",
		Section: "Раздел 6. Схемы", Keywords: "чертежи схемы рабочая документация армирование",
		Content: "На схемах расположения элементов конструкций указывают арматурные изделия, класс бетона, защитный слой бетона. Ведомости и спецификации элементов оформляются в соответствии с требованиями к оформлению рабочей документации. Характеристики материалов приводят в ведомости расхода материалов.",
	},
	{
		Code: "СП РК 4.01-102-2012", Title: "Водоснабжение. Наружные сети и сооружения",
		Section: "Раздел 8. Трубопроводы", Keywords: "водоснабжение трубопровод сети монтаж испытания",
		Content: "Трубопроводы систем водоснабжения перед вводом в эксплуатацию подвергаются гидравлическим испытаниям на прочность и герметичность. Испытательное давление принимается не менее 1,25 рабочего, но не менее 0,3 МПа для систем хозяйственно-питьевого водоснабжения.",
	},
	{
		Code: "СТ РК 1.02-2018", Title: "Порядок проведения приёмки выполненных строительно-монтажных работ",
		Section: "Раздел 3. Исполнительная документация", Keywords: "кс-2 кс-3 акт приёмка исполнительная документация формы",
		Content: "Приёмка выполненных работ оформляется актом по форме КС-2 (акт о приёмке выполненных работ) и справкой по форме КС-3 (справка о стоимости выполненных работ и затрат). Ведомость выполненных работ составляется по позициям сметы с указанием объёмов и стоимости. Заказчик проверяет соответствие объёмов проектной документации и при отсутствии замечаний подписывает документы.",
	},
	{
		Code: "СН РК 4.01-03-2011", Title: "Инженерные сети. Основания и фундаменты",
		Section: "Раздел 5. Земляные работы", Keywords: "фундамент земляные работы котлован основание",
		Content: "Перед устройством фундаментов выполняется геодезическая разбивка и подготовка основания. При разработке котлована в зимних условиях необходимо обеспечивать защиту основания от промерзания. Обратная засыпка выполняется послойным уплотнением до проектной плотности.",
	},
	{
		Code: "СП РК 2.03-101-2012", Title: "Крыши и кровли. Общие требования",
		Section: "Раздел 6. Устройство кровли", Keywords: "кровля гидроизоляция материалы покрытие",
		Content: "Кровельные покрытия должны обеспечивать отвод атмосферных осадков и защиту конструкций от увлажнения. Для гидроизоляции применяются рулонные битумно-полимерные материалы с защитным слоем. На эксплуатируемых кровлях устраивается разуклонка к водоприёмным воронкам.",
	},
	{
		Code: "СТ РК 1.02-2009", Title: "Инженерно-геодезические работы в строительстве",
		Section: "Раздел 2. Контроль точности", Keywords: "геодезия разбивка исполнительная съёмка допуски",
		Content: "Исполнительная геодезическая съёмка выполняется после завершения возведения конструкций и фиксирует фактические отклонения от проектных отметок. Допуски на монтаж конструкций устанавливаются проектом. Результаты съёмки прилагаются к актам освидетельствования скрытых работ.",
	},
}

// seedNormative загружает нормативную базу.
func (s *seeder) seedNormative() error {
	for _, n := range normativeSeed {
		if err := s.exec(`INSERT INTO normative_docs (id, code, title, section, content, keywords)
			VALUES (?, ?, ?, ?, ?, ?)`,
			newID(), n.Code, n.Title, n.Section, n.Content, n.Keywords); err != nil {
			return err
		}
	}
	return nil
}

// projectSeed — строительные объекты компании.
type projectSeed struct {
	Code       string
	Name       string
	Customer   string
	Address    string
	Status     domain.ProjectStatus
	Budget     int64 // тенге
	Spent      int64 // тенге
	Contract   int64 // тенге
	Start      string
	PlannedEnd string
	ActualEnd  string
	Manager    string // email
	Progress   int
}

var projectSeeds = []projectSeed{
	{
		Code: "ALR-2026-01", Name: "ЖК «Алатау Резиденс», корпус 1–3", Customer: "ТОО «Алатау Инвест»",
		Address: "г. Алматы, Бостандыкский район, ул. Розыбакиева 247", Status: domain.ProjectActive,
		Budget: 4_850_000_000, Spent: 2_910_000_000, Contract: 5_120_000_000,
		Start: "2025-03-01", PlannedEnd: "2027-06-30", Manager: "manager@mindia.kz", Progress: 62,
	},
	{
		Code: "AST-2026-02", Name: "БЦ «Astana Tower», блок B", Customer: "АО «Astana Development»",
		Address: "г. Астана, Есильский район, пр. Мангилик Ел 55", Status: domain.ProjectActive,
		Budget: 3_200_000_000, Spent: 1_040_000_000, Contract: 3_450_000_000,
		Start: "2025-09-15", PlannedEnd: "2027-03-31", Manager: "manager@mindia.kz", Progress: 34,
	},
	{
		Code: "SHY-2026-03", Name: "Школа на 1200 мест", Customer: "Управление образования г. Шымкент",
		Address: "г. Шымкент, Енбекшинский район, мкр. Нурсат", Status: domain.ProjectPlanning,
		Budget: 1_780_000_000, Spent: 0, Contract: 1_850_000_000,
		Start: "2026-02-01", PlannedEnd: "2027-08-31", Manager: "manager@mindia.kz", Progress: 0,
	},
	{
		Code: "KSP-2025-04", Name: "Логистический хаб «Каспий»", Customer: "ТОО «Caspian Logistics Group»",
		Address: "г. Актау, промышленная зона 4", Status: domain.ProjectSuspended,
		Budget: 2_400_000_000, Spent: 1_620_000_000, Contract: 2_550_000_000,
		Start: "2024-06-01", PlannedEnd: "2026-05-31", Manager: "manager@mindia.kz", Progress: 58,
	},
	{
		Code: "ESL-2024-05", Name: "Реконструкция моста через р. Есиль", Customer: "ГУ «Акимат г. Астана»",
		Address: "г. Астана, мост через р. Есиль (пр. Туран)", Status: domain.ProjectCompleted,
		Budget: 980_000_000, Spent: 946_000_000, Contract: 1_010_000_000,
		Start: "2023-04-01", PlannedEnd: "2024-10-31", ActualEnd: "2024-09-20",
		Manager: "manager@mindia.kz", Progress: 100,
	},
}

func (s *seeder) seedProjects(users map[string]string) error {
	for _, p := range projectSeeds {
		pid := newID()
		now := fmtTime(nowUTC())
		if err := s.exec(`INSERT INTO projects
			(id, code, name, customer, address, status, budget_minor, spent_minor, contract_amount_minor,
			 start_date, planned_end_date, actual_end_date, manager_id, progress_percent, version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			pid, p.Code, p.Name, p.Customer, p.Address, string(p.Status),
			p.Budget*100, p.Spent*100, p.Contract*100,
			p.Start, p.PlannedEnd, p.ActualEnd, users[p.Manager], p.Progress, now, now); err != nil {
			return err
		}
		if err := s.seedStages(pid, p); err != nil {
			return err
		}
		if err := s.seedProjectScoped(pid, p, users); err != nil {
			return err
		}
	}
	return nil
}

// stagesByCode — типовой набор этапов для активных объектов.
var stagesByCode = map[string][]struct {
	Name     string
	Status   domain.StageStatus
	Start    string
	End      string
	Progress int
	Planned  int64 // тенге
	Actual   int64 // тенге
}{
	"ALR-2026-01": {
		{"Подготовительные работы", domain.StageDone, "2025-03-01", "2025-05-31", 100, 210_000_000, 205_000_000},
		{"Земляные работы и фундамент", domain.StageDone, "2025-06-01", "2025-12-31", 100, 680_000_000, 702_000_000},
		{"Монолитный каркас", domain.StageActive, "2026-01-01", "2026-12-31", 68, 1_540_000_000, 1_020_000_000},
		{"Наружные стены и фасад", domain.StageActive, "2026-09-01", "2027-03-31", 22, 860_000_000, 190_000_000},
		{"Инженерные системы", domain.StagePending, "2026-11-01", "2027-05-31", 0, 980_000_000, 0},
		{"Благоустройство и сдача", domain.StagePending, "2027-04-01", "2027-06-30", 0, 580_000_000, 0},
	},
	"AST-2026-02": {
		{"Подготовительные работы", domain.StageDone, "2025-09-15", "2025-12-31", 100, 180_000_000, 176_000_000},
		{"Земляные работы и фундамент", domain.StageActive, "2026-01-01", "2026-08-31", 45, 720_000_000, 320_000_000},
		{"Монолитный каркас", domain.StagePending, "2026-06-01", "2027-01-31", 0, 1_350_000_000, 0},
		{"Фасад и остекление", domain.StagePending, "2026-12-01", "2027-03-31", 0, 620_000_000, 0},
		{"Инженерные системы", domain.StagePending, "2027-01-01", "2027-03-31", 0, 330_000_000, 0},
	},
	"SHY-2026-03": {
		{"Проектирование и согласование", domain.StageActive, "2026-02-01", "2026-05-31", 15, 90_000_000, 12_000_000},
		{"Земляные работы и фундамент", domain.StagePending, "2026-05-01", "2026-09-30", 0, 340_000_000, 0},
		{"Каркас и кровля", domain.StagePending, "2026-09-01", "2027-02-28", 0, 720_000_000, 0},
		{"Отделка и оснащение", domain.StagePending, "2027-02-01", "2027-07-31", 0, 520_000_000, 0},
		{"Сдача объекта", domain.StagePending, "2027-07-01", "2027-08-31", 0, 110_000_000, 0},
	},
	"KSP-2025-04": {
		{"Проектирование", domain.StageDone, "2024-06-01", "2024-10-31", 100, 120_000_000, 118_000_000},
		{"Земляные работы", domain.StageDone, "2024-09-01", "2025-03-31", 100, 380_000_000, 402_000_000},
		{"Несущие конструкции складов", domain.StageActive, "2025-02-01", "2025-12-31", 72, 1_120_000_000, 810_000_000},
		{"Полы и покрытия", domain.StagePending, "2025-10-01", "2026-03-31", 0, 480_000_000, 0},
		{"Инфраструктура и сдача", domain.StagePending, "2026-02-01", "2026-05-31", 0, 300_000_000, 0},
	},
	"ESL-2024-05": {
		{"Обследование и проект", domain.StageDone, "2023-04-01", "2023-08-31", 100, 85_000_000, 82_000_000},
		{"Демонтаж и подготовка", domain.StageDone, "2023-08-01", "2023-12-31", 100, 190_000_000, 188_000_000},
		{"Реконструкция пролётов", domain.StageDone, "2023-11-01", "2024-06-30", 100, 520_000_000, 538_000_000},
		{"Гидроизоляция и покрытие", domain.StageDone, "2024-05-01", "2024-08-31", 100, 150_000_000, 138_000_000},
		{"Сдача объекта", domain.StageDone, "2024-08-01", "2024-09-20", 100, 35_000_000, 32_000_000},
	},
}

// seedStages создаёт этапы работ для объекта.
func (s *seeder) seedStages(projectID string, p projectSeed) error {
	stages, ok := stagesByCode[p.Code]
	if !ok {
		return nil
	}
	for i, st := range stages {
		if err := s.exec(`INSERT INTO project_stages
			(id, project_id, name, sequence, status, planned_start, planned_end,
			 progress_percent, planned_minor, actual_minor)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			newID(), projectID, st.Name, i+1, string(st.Status), st.Start, st.End,
			st.Progress, st.Planned*100, st.Actual*100); err != nil {
			return err
		}
	}
	return nil
}

// estimateSeed — смета с позициями. Сумма позиций рассчитывается в seedProjectScoped.
type estimateSeed struct {
	Number  string
	Name    string
	Status  domain.EstimateStatus
	Creator string // email
	Approver string // email, для approved
	Items   []estimateItemSeed
}

// estimateItemSeed — позиция сметы. UnitPrice в тенге, AmountMinor = Quantity*UnitPrice.
type estimateItemSeed struct {
	Code     string
	Name     string
	Unit     string
	Quantity float64
	Price    int64 // тенге за единицу
	Category string
}

// estimatesByCode — сметы по объектам (разные статусы для демонстрации workflow).
var estimatesByCode = map[string][]estimateSeed{
	"ALR-2026-01": {
		{
			Number: "СМ-001", Name: "Смета на монолитные работы, корпус 1", Status: domain.EstimateApproved,
			Creator: "estimator@mindia.kz", Approver: "manager@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 06-01-001-01", "Устройство бетонной подготовки", "м³", 420, 28_500, "Бетонные работы"},
				{"ФЕР 06-01-041-01", "Бетонирование фундаментной плиты", "м³", 3180, 42_000, "Бетонные работы"},
				{"ФЕР 06-01-026-02", "Устройство монолитных колонн", "м³", 640, 58_000, "Монолитный каркас"},
				{"ФЕР 06-01-026-05", "Устройство монолитных стен", "м³", 1240, 54_000, "Монолитный каркас"},
				{"ФЕР 06-01-026-08", "Устройство перекрытий", "м²", 8600, 18_500, "Монолитный каркас"},
				{"ФЕР 08-02-001-01", "Армирование конструкций", "т", 386, 412_000, "Арматурные работы"},
			},
		},
		{
			Number: "СМ-002", Name: "Смета на фасадные работы", Status: domain.EstimateOnReview,
			Creator: "estimator@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 15-01-047-06", "Устройство навесного фасада", "м²", 3200, 62_000, "Фасад"},
				{"ФЕР 15-01-019-01", "Утепление наружных стен", "м²", 6400, 8_900, "Фасад"},
				{"ФЕР 15-01-049-01", "Облицовка плитными материалами", "м²", 6400, 11_200, "Фасад"},
				{"ФЕР 15-01-047-06", "Устройство навесного фасада", "м²", 3200, 62_000, "Фасад"},
				{"ФЕР 15-02-016-01", "Монтаж витражей и окон", "м²", 1450, 74_500, "Заполнение проёмов"},
			},
		},
		{
			Number: "СМ-003", Name: "Черновая смета на инженерные системы", Status: domain.EstimateDraft,
			Creator: "estimator@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 16-01-001-01", "Прокладка трубопроводов водоснабжения", "м", 5200, 3_400, "Водоснабжение"},
				{"ФЕР 16-02-004-01", "Монтаж системы отопления", "м", 7800, 4_150, "Отопление"},
				{"ФЕР 16-03-002-01", "Монтаж системы вентиляции", "м²", 4200, 6_800, "Вентиляция"},
				{"ФЕР 16-04-003-01", "Электромонтажные работы", "м", 12400, 0, "Электромонтаж"},
			},
		},
	},
	"AST-2026-02": {
		{
			Number: "СМ-001", Name: "Смета на земляные работы и фундамент", Status: domain.EstimateOnReview,
			Creator: "estimator@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 01-01-030-01", "Разработка грунта экскаватором", "м³", 4200, 1_850, "Земляные работы"},
				{"ФЕР 01-02-001-01", "Обратная засыпка с уплотнением", "м³", 1800, 1_250, "Земляные работы"},
				{"ФЕР 06-01-001-01", "Устройство бетонной подготовки", "м³", 260, 29_400, "Бетонные работы"},
				{"ФЕР 06-01-017-01", "Свайное основание", "м", 2400, 15_200, "Свайные работы"},
			},
		},
	},
	"SHY-2026-03": {
		{
			Number: "СМ-001", Name: "Смета на проектно-изыскательские работы", Status: domain.EstimateApproved,
			Creator: "estimator@mindia.kz", Approver: "manager@mindia.kz",
			Items: []estimateItemSeed{
				{"ПИР-01", "Проектная документация, стадия П", "компл.", 1, 42_000_000, "Проектирование"},
				{"ПИР-02", "Проектная документация, стадия Р", "компл.", 1, 38_000_000, "Проектирование"},
				{"ПИР-03", "Инженерно-геодезические изыскания", "компл.", 1, 8_500_000, "Изыскания"},
				{"ПИР-04", "Прохождение экспертизы проекта", "компл.", 1, 4_200_000, "Экспертиза"},
			},
		},
	},
	"KSP-2025-04": {
		{
			Number: "СМ-001", Name: "Смета на несущие конструкции складов", Status: domain.EstimateApproved,
			Creator: "estimator@mindia.kz", Approver: "manager@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 09-03-012-01", "Монтаж металлоконструкций каркаса", "т", 940, 128_000, "Металлоконструкции"},
				{"ФЕР 09-04-008-01", "Монтаж ограждающих конструкций", "м²", 12_400, 5_600, "Ограждающие конструкции"},
				{"ФЕР 07-05-011-01", "Устройство бетонных полов", "м²", 9_800, 4_200, "Полы"},
			},
		},
	},
	"ESL-2024-05": {
		{
			Number: "СМ-001", Name: "Смета на реконструкцию пролётных строений", Status: domain.EstimateArchived,
			Creator: "estimator@mindia.kz", Approver: "manager@mindia.kz",
			Items: []estimateItemSeed{
				{"ФЕР 30-06-001-01", "Реконструкция балок пролётных строений", "т", 620, 148_000, "Мостовые конструкции"},
				{"ФЕР 30-07-004-01", "Устройство гидроизоляции мостового полотна", "м²", 4_150, 6_900, "Гидроизоляция"},
				{"ФЕР 30-08-002-01", "Устройство деформационных швов", "м", 128, 92_000, "Мостовое полотно"},
			},
		},
	},
}

// seedProjectScoped создаёт сметы, документы, материалы и активность для объекта.
func (s *seeder) seedProjectScoped(projectID string, p projectSeed, users map[string]string) error {
	estimator := users["estimator@mindia.kz"]
	approver := users["manager@mindia.kz"]
	foreman := users["foreman@mindia.kz"]

	for _, es := range estimatesByCode[p.Code] {
		creator := users[es.Creator]
		if creator == "" {
			creator = estimator
		}
		estimateID := newID()
		var total int64
		for _, it := range es.Items {
			total += int64(float64(it.Price*100) * it.Quantity)
		}
		now := fmtTime(nowUTC())
		approvedBy := ""
		var approvedAt any
		if es.Status == domain.EstimateApproved || es.Status == domain.EstimateArchived {
			approvedBy = approver
			approvedAt = now
		}
		if err := s.exec(`INSERT INTO estimates
			(id, project_id, stage_id, number, name, status, currency, total_minor, created_by,
			 approved_by, approved_at, version, created_at, updated_at)
			VALUES (?, ?, NULL, ?, ?, ?, 'KZT', ?, ?, ?, ?, 1, ?, ?)`,
			estimateID, projectID, es.Number, es.Name, string(es.Status), total,
			creator, nullIfEmpty(approvedBy), approvedAt, now, now); err != nil {
			return err
		}
		for pos, it := range es.Items {
			if err := s.exec(`INSERT INTO estimate_items
				(id, estimate_id, position, code, name, unit, quantity, unit_price_minor, total_minor, category)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				newID(), estimateID, pos+1, it.Code, it.Name, it.Unit, it.Quantity,
				it.Price*100, int64(float64(it.Price*100)*it.Quantity), it.Category); err != nil {
				return err
			}
		}
	}

	if err := s.seedDocuments(projectID, p, users, foreman, approver); err != nil {
		return err
	}
	if err := s.seedMaterials(projectID, p); err != nil {
		return err
	}
	return nil
}

// documentSeed — исполнительная документация объекта.
type documentSeed struct {
	Type       domain.DocumentType
	Number     string
	Title      string
	Status     domain.DocumentStatus
	PeriodFrom string
	PeriodTo   string
	Amount     int64 // тенге
}

// documentsByCode — документы по объектам.
var documentsByCode = map[string][]documentSeed{
	"ALR-2026-01": {
		{domain.DocKS2, "КС-2/01", "Акт о приёмке выполненных работ за май 2025", domain.DocApproved, "2025-05-01", "2025-05-31", 205_000_000},
		{domain.DocKS3, "КС-3/01", "Справка о стоимости работ за май 2025", domain.DocApproved, "2025-05-01", "2025-05-31", 205_000_000},
		{domain.DocKS2, "КС-2/02", "Акт о приёмке работ по фундаменту", domain.DocApproved, "2025-12-01", "2025-12-31", 702_000_000},
		{domain.DocKS2, "КС-2/03", "Акт о приёмке монолитных работ, I квартал 2026", domain.DocSubmitted, "2026-01-01", "2026-03-31", 510_000_000},
		{domain.DocKS3, "КС-3/03", "Справка о стоимости работ, I квартал 2026", domain.DocSubmitted, "2026-01-01", "2026-03-31", 510_000_000},
		{domain.DocInvoice, "СЧ-114", "Счёт на поставку арматуры А500С", domain.DocRejected, "2026-02-01", "2026-02-28", 84_600_000},
	},
	"AST-2026-02": {
		{domain.DocKS2, "КС-2/01", "Акт о приёмке подготовительных работ", domain.DocApproved, "2025-12-01", "2025-12-31", 176_000_000},
		{domain.DocKS3, "КС-3/01", "Справка о стоимости работ за декабрь 2025", domain.DocApproved, "2025-12-01", "2025-12-31", 176_000_000},
		{domain.DocKS2, "КС-2/02", "Акт о приёмке земляных работ, I полугодие 2026", domain.DocDraft, "2026-01-01", "2026-06-30", 320_000_000},
		{domain.DocAct, "АОСР-07", "Акт освидетельствования скрытых работ (свайное поле)", domain.DocSubmitted, "2026-03-01", "2026-03-31", 0},
	},
	"KSP-2025-04": {
		{domain.DocKS2, "КС-2/04", "Акт о приёмке конструкций склада №1", domain.DocSubmitted, "2025-06-01", "2025-06-30", 410_000_000},
		{domain.DocKS3, "КС-3/04", "Справка о стоимости работ за июнь 2025", domain.DocSubmitted, "2025-06-01", "2025-06-30", 410_000_000},
		{domain.DocInvoice, "СЧ-208", "Счёт на металлоконструкции (поставка)", domain.DocApproved, "2025-05-01", "2025-05-31", 120_320_000},
	},
	"ESL-2024-05": {
		{domain.DocKS2, "КС-2/09", "Финальный акт о приёмке работ по объекту", domain.DocApproved, "2024-09-01", "2024-09-20", 946_000_000},
		{domain.DocKS3, "КС-3/09", "Итоговая справка о стоимости работ", domain.DocApproved, "2024-09-01", "2024-09-20", 946_000_000},
	},
}

// seedDocuments создаёт исполнительную документацию по объекту.
func (s *seeder) seedDocuments(projectID string, p projectSeed, users map[string]string, creator, approver string) error {
	for _, d := range documentsByCode[p.Code] {
		approvedBy := ""
		var approvedAt any
		if d.Status == domain.DocApproved {
			approvedBy = approver
			approvedAt = fmtTime(nowUTC())
		}
		now := fmtTime(nowUTC())
		if err := s.exec(`INSERT INTO documents
			(id, project_id, type, number, title, status, period_from, period_to, amount_minor,
			 created_by, approved_by, approved_at, version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			newID(), projectID, string(d.Type), d.Number, d.Title, string(d.Status),
			d.PeriodFrom, d.PeriodTo, d.Amount*100,
			creator, nullIfEmpty(approvedBy), approvedAt, now, now); err != nil {
			return err
		}
	}
	return nil
}

// materialSeed — материалы по объекту.
type materialSeed struct {
	Name     string
	Unit     string
	Planned  float64
	Used     float64
	Price    int64 // тенге за единицу
	Supplier string
}

var materialsByCode = map[string][]materialSeed{
	"ALR-2026-01": {
		{"Бетон товарный B25", "м³", 5400, 3820, 38_500, "ТОО «Бетон Алматы»"},
		{"Арматура А500С Ø12-32", "т", 420, 312, 428_000, "ТОО «МеталлТрейд»"},
		{"Опалубка щитовая", "м²", 1800, 1420, 24_000, "ТОО «СтройОпалубка»"},
	},
	"AST-2026-02": {
		{"Бетон товарный B25", "м³", 3200, 980, 39_200, "ТОО «AstanaBeton»"},
		{"Сваи буронабивные", "м", 2400, 860, 15_800, "ТОО «ГеоСвая»"},
	},
	"SHY-2026-03": {
		{"Бетон товарный B25", "м³", 2600, 0, 38_000, "ТОО «ShymkentBeton»"},
	},
	"KSP-2025-04": {
		{"Металлоконструкции ЛМК", "т", 940, 742, 132_000, "ТОО «КазМеталлКонструкция»"},
		{"Профнастил ограждающий", "м²", 12_400, 8600, 5_900, "ТОО «ПрофСталь»"},
		{"Бетон товарный B22.5", "м³", 2100, 1580, 34_800, "ТОО «АктауСтройБетон»"},
	},
	"ESL-2024-05": {
		{"Гидроизоляция мостовая", "м²", 4150, 4150, 7_200, "ТОО «МостИзол»"},
		{"Металлоконструкции пролётных", "т", 620, 620, 152_000, "ТОО «КазМеталлКонструкция»"},
	},
}

// seedMaterials создаёт материалы по объекту.
func (s *seeder) seedMaterials(projectID string, p projectSeed) error {
	for _, m := range materialsByCode[p.Code] {
		if err := s.exec(`INSERT INTO materials
			(id, project_id, name, unit, planned_qty, used_qty, unit_price_minor, supplier)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			newID(), projectID, m.Name, m.Unit, m.Planned, m.Used, m.Price*100, m.Supplier); err != nil {
			return err
		}
	}
	return nil
}
