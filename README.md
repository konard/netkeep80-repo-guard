# repo-guard

Policy engine для репозитория: формализует правила репозитория в виде машиночитаемого JSON и проверяет реальные изменения на соответствие этим правилам.

## Какую проблему решает

При активной разработке — особенно с использованием AI-ассистентов — в репозиторий начинает попадать лишнее: временные документы, промежуточные файлы, process-noise. Pull request'ы разрастаются, намерение изменения и реальный diff расходятся, а ручной контроль не масштабируется.

`repo-guard` решает эту проблему: он позволяет описать допустимые правила репозитория в файле `repo-policy.json` и автоматически проверять каждый diff на соответствие этим правилам. Это исполняемая дисциплина, а не устная договорённость.

В контексте AI-assisted development это особенно важно: AI-агенты генерируют код быстро, но не всегда учитывают структурные ограничения проекта. `repo-guard` выступает автоматическим контролёром, который не пропустит изменения, нарушающие политику репозитория.

## Что это такое

`repo-guard` — это **policy-as-code** движок для Git-репозиториев:

- **Policy** (`repo-policy.json`) — декларативное описание правил: запрещённые пути, бюджеты на файлы и строки, правила совместных изменений, контентные ограничения.
- **Change contract** — нормализованный документ намерения изменения: что именно должно измениться, чего трогать нельзя, допустимые бюджеты. В PR/issue его удобнее писать как YAML, а внутри он валидируется той же JSON Schema.
- **Diff-based enforcement** — проверка реального diff против policy и contract.
- **PR gate** — интеграция в GitHub Actions: CI не даёт PR пройти, если изменения нарушают политику.

Логика работы:

1. Policy описывает, что вообще допустимо в репозитории.
2. Contract описывает намерение конкретного изменения.
3. `repo-guard` сравнивает реальный diff с policy и contract.
4. CI блокирует PR, если diff выходит за рамки.

## Когда repo-guard полезен

- Бот или разработчик тащит в PR лишние документы, промпты, временные файлы — **forbidden paths** и **бюджет на новые файлы** не дадут им пройти.
- Изменения в `src/**` должны сопровождаться изменениями в `tests/**` — **co-change rules** проверят это автоматически.
- В коде появляются незакреплённые комментарии-заметки без привязки к issue — **content rules** с regex-паттернами поймают это в добавленных строках.
- PR раздувается на тысячи строк без контроля — **бюджет net added lines** ограничит размер.
- Нужно явно зафиксировать intent изменения — **change contract** в теле PR или issue описывает, что должно и что не должно измениться.
- В репозитории есть bot-артефакты (`.claude/**`, `.gitkeep`), которые не нужно проверять — **operational paths** исключают их из всех проверок.

## Чем repo-guard не является

- **Не code review assistant** — не анализирует качество кода и не даёт советов.
- **Не security scanner** — не ищет уязвимости.
- **Не formatter/linter** — не проверяет стиль кода.
- **Не универсальный GitHub bot** — не пишет комментарии к PR (пока).
- **Не замена тестам** — проверяет структуру и дисциплину изменений, а не корректность кода.

## Как он работает

### Проверки при анализе diff (`check-diff`)

| Проверка | Что делает |
|---|---|
| Forbidden paths | Запрещает файлы по glob-паттернам |
| Canonical docs budget | Ограничивает количество новых `.md` файлов |
| Max new files | Ограничивает общее количество новых файлов |
| Max net added lines | Ограничивает `added − deleted` строк |
| Surface debt | Проверяет объявленный `surface_debt`, если contract явно описывает временный рост |
| New file rules | Проверяет классы новых файлов и per-class бюджеты для объявленного `change_class` |
| Co-change rules | Если изменён X, должен быть изменён и Y |
| Surface matrix | Проверяет, что объявленный `change_class` трогает только разрешённые surface-классы |
| Content rules | Запрещает regex-паттерны в добавленных строках |
| must_touch | Хотя бы один из указанных паттернов должен совпасть с изменённым файлом (из contract) |
| must_not_touch | Ни один из указанных паттернов не должен совпасть с изменённым файлом (из contract) |

Operational paths (bot-артефакты) исключаются из всех проверок.

### PR policy gate (`check-pr`)

1. Извлекает change contract из тела PR (предпочтительно блок ` ```repo-guard-yaml `; старый ` ```repo-guard-json ` тоже поддерживается).
2. Если в PR нет contract — ищет в теле привязанного issue (`Fixes #N` / `Closes #N` / `Resolves #N`, включая формат `owner/repo#N`).
3. Если привязано несколько issue без contract в PR — завершается с ошибкой `issue_link_ambiguous`.
4. Валидирует contract по JSON Schema.
5. Запускает полный набор diff-проверок между base и head PR.

## Основные сущности

| Сущность | Файл | Назначение |
|---|---|---|
| Политика репозитория | `repo-policy.json` | Декларация правил репозитория |
| Схема политики | `schemas/repo-policy.schema.json` | Валидация структуры политики |
| Схема contract | `schemas/change-contract.schema.json` | Валидация change contract |
| CLI | `src/repo-guard.mjs` | Точка входа: валидация и enforcement |
| Diff checker | `src/diff-checker.mjs` | Парсинг diff и проверка правил |
| Contract extractor | `src/markdown-contract.mjs` | Извлечение contract из markdown |
| PR интеграция | `src/github-pr.mjs` | PR gate для GitHub Actions |
| Init scaffolding | `src/init.mjs` | Генерация начальной конфигурации |
| Диагностика | `src/doctor.mjs` | `doctor` — проверка окружения и конфигурации |
| Шаблоны | `templates/` | Примеры policy и contract |

## Быстрый старт

### Инициализация нового репозитория

Команда `repo-guard init` создаёт минимальную рабочую конфигурацию для репозитория:

```bash
repo-guard init
```

По умолчанию создаются:
- `repo-policy.json` — политика репозитория
- `.github/workflows/repo-guard.yml` — GitHub Actions workflow
- `.github/PULL_REQUEST_TEMPLATE.md` — шаблон PR с блоком change contract
- `.github/ISSUE_TEMPLATE/change-contract.yml` — шаблон issue для change contract

Существующие файлы не перезаписываются — если файл уже есть, он будет пропущен.

#### Пресеты

Пресет определяет начальные значения policy в зависимости от типа репозитория:

```bash
repo-guard init --preset library
repo-guard init --preset application   # по умолчанию
repo-guard init --preset tooling
repo-guard init --preset documentation
```

| Пресет | `max_new_files` | `max_new_docs` | `max_net_added_lines` | Co-change rules |
|---|---|---|---|---|
| `application` | 20 | 3 | 1500 | нет |
| `library` | 15 | 2 | 1000 | `src/**` → `tests/**` |
| `tooling` | 15 | 2 | 2000 | `src/**` → `tests/**` |
| `documentation` | 20 | 10 | — | нет |

#### Режим enforcement

```bash
repo-guard init --mode enforce    # по умолчанию — blocking enforcement
repo-guard init --mode advisory   # non-blocking advisory enforcement
```

Режим `advisory` удобен для начала: `repo-guard` по-прежнему запускает все проверки и сообщает о нарушениях, но завершает policy run с exit code `0`, чтобы CI не блокировал PR из-за policy violations. Режим `enforce` является alias для `blocking`: нарушения policy приводят к exit code `1`.

Бюджеты policy одинаково применяются в обоих режимах. Разница только в exit semantics и summary messaging.

#### Использование с --repo-root

```bash
repo-guard --repo-root /path/to/other/repo init --preset library --mode advisory
```

### Установка

Рекомендуемый способ — установить как глобальный CLI через npm:

```bash
npm install -g repo-guard
```

Или запустить без предварительной установки через npx:

```bash
npx repo-guard
```

Требования: Node.js ≥ 20.

### Валидация policy

```bash
repo-guard
```

Проверяет `repo-policy.json` в текущей директории по JSON Schema. Выводит `OK` или список ошибок.

```bash
# Через npx (без глобальной установки)
npx repo-guard
```

### Валидация change contract

```bash
repo-guard path/to/contract.json
```

Проверяет и policy, и contract по соответствующим схемам.

### Проверка diff

```bash
# Проверить staged изменения (или HEAD если staged пуст)
repo-guard check-diff

# Проверить diff между ветками
repo-guard check-diff --base main --head feature

# Проверить diff с change contract
repo-guard check-diff --contract path/to/contract.json

# Проверить diff с явным change class для surface_matrix
repo-guard check-diff --change-class docs-cleanup

# Наблюдать нарушения без падения job
repo-guard --enforcement advisory check-diff --base main --head feature

# Явно включить blocking mode (default)
repo-guard --enforcement blocking check-diff --base main --head feature

# Машиночитаемый результат для CI tooling
repo-guard check-diff --format json --base main --head feature

# Краткий Markdown summary для GitHub job summary
repo-guard check-diff --format summary --base main --head feature
```

#### Structured output

`check-diff` supports three output formats:

| Format | Purpose |
|---|---|
| `text` | Default human-readable CLI logs. |
| `json` | Stable machine-readable result for CI pipelines and higher-level tooling. Stdout contains only JSON. |
| `summary` | Concise GitHub-flavored Markdown suitable for `$GITHUB_STEP_SUMMARY`. |

The JSON result is intended as an API surface. Field names are stable and intentionally boring:

```json
{
  "mode": "blocking",
  "ok": false,
  "result": "failed",
  "passed": 4,
  "violations": [
    {
      "rule": "max-new-files",
      "actual": 2,
      "limit": 0,
      "files": ["src/feature.mjs", "tests/feature.test.mjs"],
      "touched": [],
      "must_touch": [],
      "must_not_touch": [],
      "details": [],
      "errors": []
    }
  ],
  "violationCount": 1,
  "failed": 1,
  "exitCode": 1,
  "ruleResults": [
    {
      "rule": "max-new-files",
      "ok": false,
      "details": ["actual: 2, limit: 0", "file: src/feature.mjs", "file: tests/feature.test.mjs"]
    }
  ],
  "hints": [],
  "repositoryRoot": "/path/to/repo",
  "diff": {
    "changedFiles": 2,
    "checkedFiles": 2,
    "skippedOperationalFiles": 0
  }
}
```

Exit behavior is unchanged: in `blocking` mode violations exit `1`; in `advisory` mode violations are reported but the command exits `0`. Consumers should read both `ok` and `exitCode`: `ok` describes policy result, while `exitCode` describes command exit semantics for the active enforcement mode.

Example GitHub Actions usage:

```yaml
- name: repo-guard JSON
  run: repo-guard check-diff --format json --base "$BASE_SHA" --head "$HEAD_SHA" > repo-guard-result.json

- name: repo-guard summary
  run: repo-guard check-diff --format summary --base "$BASE_SHA" --head "$HEAD_SHA" >> "$GITHUB_STEP_SUMMARY"
```

### Проверка PR (в GitHub Actions)

```bash
repo-guard check-pr
```

Требования для `check-pr`:
- переменная окружения `GITHUB_EVENT_PATH` (устанавливается GitHub Actions автоматически);
- `git` CLI с достаточной глубиной fetch для base...head diff;
- `gh` CLI с авторизацией (для fallback на linked issue);
- event payload типа `pull_request` с base/head SHA.

### Normalized Facts Model

`check-diff` and `check-pr` both normalize their inputs before policy checks run. The command modes differ only in how they gather input: `check-diff` reads local CLI refs and an optional contract file, while `check-pr` reads the GitHub pull request event and optionally falls back to a linked issue. After that adapter step, checks consume the same facts object:

```js
{
  mode: "check-diff" | "check-pr",
  repositoryRoot: "/absolute/repo",
  policy: { /* validated repo-policy.json */ },
  contract: { /* validated change contract */ } | null,
  contractSource: "cli file" | "pr body" | "linked issue" | "none",
  enforcement: { mode: "blocking" | "advisory" },
  diff: {
    files: {
      all: [/* parsed git diff files */],
      checked: [/* all minus operational paths */],
      skippedOperational: [/* files ignored by policy.paths.operational_paths */]
    }
  },
  trackedFiles: ["README.md"],
  derived: {
    changedPaths: ["src/example.mjs"],
    touchedSurfaces: { /* surface detection result */ } | null,
    newFileClasses: { /* new file classification result */ } | null
  },
  diagnostics: {
    skippedOperationalFiles: 0
  }
}
```

Policy checks read from this normalized model instead of from raw command parameters. That keeps runtime checks source-agnostic and leaves PR markdown, linked issue lookup, and CLI file loading in adapter code that can be tested directly.

### Advisory vs blocking

`repo-guard` separates command mode (`check-pr`, `check-diff`) from enforcement behavior:

| Enforcement | Aliases | Exit behavior |
|---|---|---|
| `advisory` | `warn` | Policy violations are printed as `WARN` and the command exits `0`. |
| `blocking` | `enforce` | Policy violations are printed as `FAIL` and the command exits `1`. |

Set the behavior in invocation:

```bash
repo-guard --enforcement advisory check-pr
repo-guard --enforcement blocking check-diff --base main --head feature
```

Or set a default in `repo-policy.json`:

```json
{
  "enforcement": {
    "mode": "advisory"
  }
}
```

CLI invocation wins over policy config. Advisory mode only makes policy violations non-blocking; setup/configuration errors such as invalid policy JSON, missing `git`, or missing GitHub Actions event context still fail.

### Диагностика окружения

```bash
repo-guard doctor
```

Проверяет, что окружение корректно настроено для работы `repo-guard` (особенно для `check-pr`). Выводит отчёт с PASS / WARN / FAIL для каждой проверки и remediation hint при проблемах.

| Проверка | Что проверяет | Уровни |
|---|---|---|
| `repository-root` | Путь существует и является директорией | PASS / FAIL |
| `git-available` | git CLI установлен, директория — git-репозиторий | PASS / WARN / FAIL |
| `fetch-depth` | Обнаружение shallow clone | PASS / WARN |
| `repo-policy.json` | Поиск, парсинг, валидация схемы, компиляция regex | PASS / FAIL |
| `event-context` | `GITHUB_EVENT_PATH` и структура PR event | PASS / WARN / FAIL |
| `auth-token` | `GH_TOKEN`/`GITHUB_TOKEN` или `gh auth` | PASS / WARN |
| `gh-cli` | Доступность `gh` CLI | PASS / FAIL |
| `workflow-config` | Наличие workflow с `repo-guard`, `fetch-depth: 0`, токен | PASS / WARN |

Exit code: 0 если нет FAIL (WARN допустимы), 1 если есть хотя бы один FAIL.

Уровень серьёзности `gh-cli` соответствует поведению `check-pr`: если `gh` отсутствует, `check-pr` завершится с ошибкой, и `doctor` сообщает об этом как FAIL. `auth-token` сообщает WARN, так как аутентификация требуется только при использовании fallback на linked issue для получения change contract.

```bash
# Диагностика текущей директории
repo-guard doctor

# Диагностика конкретного репозитория
repo-guard --repo-root /path/to/repo doctor
```

### Использование в другом репозитории

`--repo-root` — глобальный флаг, который можно ставить как до, так и после команды:

```bash
# validate
repo-guard --repo-root /path/to/other/repo
repo-guard --repo-root /path/to/other/repo contract.json

# check-diff (--repo-root до или после команды)
repo-guard --repo-root /path/to/other/repo check-diff --base main --head feature
repo-guard check-diff --repo-root /path/to/other/repo --base main --head feature

# check-pr (--repo-root до или после команды)
repo-guard --repo-root /path/to/other/repo check-pr
repo-guard check-pr --repo-root /path/to/other/repo
```

Флаг `--repo-root` указывает, где искать `repo-policy.json` и выполнять git-операции. Схемы загружаются из пакета `repo-guard`.

### Запуск тестов

```bash
npm test
```

## Миграция с source-run на установленный CLI

До версии 1.0.0 рекомендованный способ запуска был через клонирование репозитория:

```bash
git clone https://github.com/netkeep80/repo-guard.git
cd repo-guard
npm install
node src/repo-guard.mjs
```

Начиная с версии 1.0.0 рекомендуется использовать установленный CLI.

**Шаги миграции:**

1. Удалите клонированный репозиторий из зависимостей вашего проекта (если он был добавлен как submodule или вручную).
2. Установите пакет глобально или через npx:
   ```bash
   npm install -g repo-guard
   # или используйте npx repo-guard без установки
   ```
3. Замените вызовы `node src/repo-guard.mjs` на `repo-guard` во всех скриптах и CI конфигурациях:
   ```yaml
   # Было:
   run: node src/repo-guard.mjs check-pr
   # Стало:
   run: npx repo-guard check-pr
   ```

Все флаги и команды (`check-diff`, `check-pr`, `--repo-root`, `--base`, `--head`, `--contract`) остаются без изменений — миграция сводится к замене команды запуска.

## Минимальный пример

### 1. Policy

Минимальный `repo-policy.json`:

```json
{
  "policy_format_version": "0.1.0",
  "repository_kind": "application",
  "enforcement": {
    "mode": "blocking"
  },
  "paths": {
    "forbidden": [],
    "canonical_docs": ["README.md"],
    "governance_paths": ["repo-policy.json"]
  },
  "diff_rules": {
    "max_new_docs": 5,
    "max_new_files": 30
  },
  "content_rules": [],
  "cochange_rules": []
}
```

Эта policy разрешает до 5 новых документов и до 30 новых файлов в одном diff. Нет запрещённых путей и контентных ограничений.

### 2. Change contract

Пример contract в теле PR (предпочтительный YAML-блок ` ```repo-guard-yaml `):

````markdown
```repo-guard-yaml
change_type: bugfix
change_class: kernel-hardening
scope:
  - src/pagination.mjs
budgets:
  max_new_files: 0
  max_new_docs: 0
surface_debt:
  kind: temporary_growth
  reason: Introduce extraction path before removing duplicated code
  expected_delta:
    max_new_files: 1
    max_net_added_lines: 60
  repayment_issue: 123
must_touch:
  - src/pagination.mjs
must_not_touch:
  - schemas/
  - repo-policy.json
expected_effects:
  - Pagination returns correct page count
```
````

Contract говорит: это bugfix, который должен затронуть `src/pagination.mjs`, не должен трогать схемы и policy, и не должен создавать новых файлов. Если diff всё же временно увеличивает поверхность репозитория, `surface_debt` фиксирует причину, ожидаемый рост и issue, где долг будет погашен.

`surface_debt` проверяется только когда contract явно его объявляет. Проверка сравнивает declaration с фактическим ростом diff: количеством новых файлов и `added - deleted` строк. Если рост есть, но `surface_debt` не объявлен, repo-guard сообщает не блокирующий статус `undeclared`; если фактический рост больше `expected_delta`, статус будет `declared_debt_exceeded`; если нет `repayment_issue`, статус будет `missing_repayment_target`.

Для существующих PR сохраняется совместимость с JSON-блоком ` ```repo-guard-json `; оба формата дают одну и ту же нормализованную модель contract перед schema validation.

`change_class` опционален для обычных policy. Он становится обязательным для diff, который трогает объявленные surfaces, если в policy включён `surface_matrix`.

### 3. Что проверяет repo-guard

При запуске `check-diff` или `check-pr` repo-guard сравнивает реальный diff с policy и contract:

```
OK: repo-policy.json
Enforcement mode: blocking (policy violations are enforced; exit code is 1 when violations exist)
  PASS: change-contract

Diff analysis: 3 file(s) changed
  PASS: forbidden-paths
  PASS: canonical-docs-budget
  PASS: max-new-files
  PASS: max-net-added-lines
  PASS: registry-rules
  PASS: new-file-rules
  PASS: cochange-rules
  PASS: content-rules
  PASS: must-touch
  PASS: must-not-touch

Summary: 9 passed, 0 failed (mode: blocking; violations enforced)
Result: passed (mode: blocking; exit code 0)
```

### 4. Пример failure

Если в PR затронут файл `schemas/repo-policy.schema.json`, который указан в `must_not_touch`:

```
  FAIL: must-not-touch
    - schemas/repo-policy.schema.json
```

Если изменён `src/**`, но не изменён ни один файл в `tests/**` (при наличии co-change rule):

```
  FAIL: cochange: src/** -> tests/**
    must_touch: tests/**
```

## Typed New File Classes

Глобальный `diff_rules.max_new_files` остаётся полезным верхним лимитом, но он не различает смысл новых файлов. Для многих репозиториев новый test file, generated artifact, canonical doc и changelog fragment имеют разный риск. `new_file_classes` и `new_file_rules` позволяют описать это явно:

```json
{
  "new_file_classes": {
    "test": ["tests/**"],
    "canonical_doc": ["docs/**", "README.md"],
    "generated": ["single_include/**"],
    "changelog_fragment": ["changelog.d/*.md"],
    "script": ["scripts/**"]
  },
  "new_file_rules": {
    "docs-cleanup": {
      "allow_classes": [],
      "max_new_files": 0
    },
    "kernel-hardening": {
      "allow_classes": ["test", "changelog_fragment"],
      "max_per_class": {
        "test": 2,
        "changelog_fragment": 1
      }
    },
    "generated-refresh": {
      "allow_classes": ["generated", "changelog_fragment"],
      "max_per_class": {
        "generated": 20,
        "changelog_fragment": 1
      }
    }
  }
}
```

`new_file_rules` проверяет только файлы со статусом `added`; изменения существующих файлов остаются за `surface_matrix`, `cochange_rules` и другими проверками. Если policy включает `new_file_rules`, diff с новыми файлами должен иметь `change_class` в contract или через `--change-class`. Каждая запись `new_file_rules` должна явно задавать `allow_classes`; пустой список `[]` означает намеренный запрет всех классов новых файлов.

Пример: `kernel-hardening` может добавить до двух test files и один changelog fragment, но не может незаметно добавить generated artifact или новый design document. Это точнее, чем плоский `max_new_files: 3`: лимит допускает полезные тесты, но всё ещё блокирует неожиданные классы файлов.

При нарушении output называет offending file, detected class и нарушенное правило:

```text
  FAIL: new-file-rules
    change_class "kernel-hardening" cannot add new-file classes: generated
    change_class: kernel-hardening
    new_files: changelog.d/core.md, single_include/core.h, tests/core.test.mjs
    allowed_classes: changelog_fragment, test
    touched_classes: changelog_fragment, generated, test
    violating_classes: generated
    class generated is not allowed by new_file_rules["kernel-hardening"].allow_classes; files: single_include/core.h
```

Файлы, которые не совпали ни с одним glob из `new_file_classes`, считаются unclassified и тоже fail, когда `new_file_rules` активны. Старое поведение `max_new_files` не меняется: если `new_file_classes` и `new_file_rules` отсутствуют, repo-guard продолжает применять только плоские budgets.

## Registry Integrity Rules

`registry_rules` сравнивает две canonical list и помогает держать несколько registry в согласованном состоянии. Правило не зависит от diff contents: `check-diff` читает указанные файлы из рабочей директории и проверяет agreement перед остальными policy checks.

```json
{
  "registry_rules": [
    {
      "id": "canonical-docs-sync",
      "kind": "set_equality",
      "left": {
        "type": "json_array",
        "file": "repo-policy.json",
        "json_pointer": "/paths/canonical_docs"
      },
      "right": {
        "type": "markdown_section_links",
        "file": "docs/index.md",
        "section": "Canonical Documents",
        "prefix": "docs/"
      }
    }
  ]
}
```

Supported `kind` values:

- `set_equality`: both registries must contain the same entries.
- `left_subset_of_right`: every left entry must appear on the right.
- `right_subset_of_left`: every right entry must appear on the left.

Supported source types in v1:

- `json_array`: reads an array from `file` using `json_pointer`.
- `markdown_section_links`: reads markdown links from a named heading section. Relative links are normalized to repository paths. `prefix` can map links inside the markdown file directory to canonical registry paths, for example `policy.md` in `docs/index.md` becomes `docs/policy.md`.

When a rule fails, output identifies the rule, both registry contents, and the missing or extra entries:

```text
  FAIL: registry-rules
    failed_rules: canonical-docs-sync
    [canonical-docs-sync] registry rule "canonical-docs-sync" failed set_equality
    left entries: README.md, docs/policy.md
    right entries: README.md, docs/architecture.md
    missing from right: docs/policy.md
    extra in right: docs/architecture.md
```

Policies without `registry_rules` keep the previous behavior and report `PASS: registry-rules`.

## Advisory Text Duplication Rules

`advisory_text_rules` enables heuristic markdown duplication warnings. This check is advisory-only in v1: it can print `WARN` and appear in structured output, but it never changes the command exit code and never blocks a PR, even when enforcement mode is `blocking`.

```json
{
  "advisory_text_rules": {
    "canonical_files": ["docs/index.md", "docs/**/*.md"],
    "warn_on_similarity_above": 0.70,
    "max_reported_matches": 3
  }
}
```

The check compares changed markdown files with tracked markdown files that match `canonical_files`. It normalizes markdown prose into word tokens, reports a similarity score, and also flags duplicate section titles against canonical files. This is a practical early-warning heuristic for documentation sprawl, not proof of semantic equivalence, plagiarism, or copyright status.

Example output:

```text
  WARN: advisory-text-rules
    heuristic markdown duplication advisory
    match: docs/new-policy.md -> docs/canonical.md, score=0.82, threshold=0.7, duplicate_sections=Release Policy
    docs/new-policy.md overlaps docs/canonical.md (score 0.82, threshold 0.7; duplicate sections: Release Policy)
    hint: Review whether the changed markdown should update the canonical source instead of duplicating policy prose.
```

Policies without `advisory_text_rules` keep the previous behavior and report `PASS: advisory-text-rules`.

## Issue Type Rules

`change_type` в contract описывает тип работы: например `governance`, `kernel-hardening`, `docs-cleanup` или любой другой тип, принятый в репозитории. Policy может сделать этот тип first-class input через `change_type_rules`:

```json
{
  "surfaces": {
    "kernel": ["src/**"],
    "tests": ["tests/**"],
    "docs": ["docs/**", "README.md"],
    "generated": ["single_include/**"]
  },
  "new_file_classes": {
    "test": ["tests/**"],
    "changelog_fragment": ["changelog.d/*.md"],
    "generated": ["single_include/**"]
  },
  "change_type_rules": {
    "governance": {
      "max_new_docs": 0,
      "forbid_surfaces": ["kernel", "generated"],
      "new_file_rules": {
        "allow_classes": ["changelog_fragment"],
        "max_per_class": {
          "changelog_fragment": 1
        }
      }
    },
    "kernel-hardening": {
      "require_surfaces": ["tests"]
    }
  }
}
```

Type rules can constrain touched surfaces with `allow_surfaces`, `forbid_surfaces`, and `require_surfaces`; apply stricter budgets with `max_new_docs`, `max_new_files`, and `max_net_added_lines`; and embed a type-local `new_file_rules` block. When a type rule uses surface constraints, every changed file must match at least one declared surface. This matches the fail-closed `surface_matrix` model so unclassified files cannot bypass type-aware topology checks. Existing repositories that do not define `change_type_rules` keep the previous behavior.

При нарушении output показывает declared type и конкретное type-aware правило:

```text
  FAIL: change-type-rules
    change_type "governance" violated change_type_rules
    change_type: governance
    touched_surfaces: docs, generated, kernel
    forbidden_surfaces: generated, kernel
    violating_surfaces: generated, kernel
    new docs 1 exceeds change_type_rules["governance"].max_new_docs 0; files: docs/new.md
```

## Ownership-aware surfaces

Глобальный `paths.forbidden` хорошо работает для файлов, которые нельзя трогать никогда. Но generated, release или governance surfaces часто нельзя запрещать глобально: regeneration PR должен иметь право менять generated-файлы, а обычный docs PR — нет.

Для этого policy может объявить named surfaces, named change classes и матрицу допустимых сочетаний:

```json
{
  "surfaces": {
    "kernel": ["src/**", "include/**"],
    "tests": ["tests/**"],
    "docs": ["docs/**", "README.md"],
    "governance": ["repo-policy.json", ".github/**"],
    "release": ["CHANGELOG.md", "package.json"],
    "generated": ["single_include/**"]
  },
  "change_classes": [
    "kernel-hardening",
    "docs-cleanup",
    "generated-refresh"
  ],
  "allow_unclassified_files": false,
  "surface_matrix": {
    "kernel-hardening": {
      "allow": ["kernel", "tests"],
      "forbid": ["generated", "release"]
    },
    "docs-cleanup": {
      "allow": ["docs", "governance"],
      "forbid": ["kernel", "tests", "generated", "release"]
    },
    "generated-refresh": {
      "allow": ["generated", "release"],
      "forbid": ["kernel", "docs", "governance"]
    }
  }
}
```

Затем intent задаётся в contract:

```yaml
change_type: chore
change_class: generated-refresh
scope:
  - single_include/
budgets: {}
must_touch:
  - single_include/
must_not_touch: []
expected_effects:
  - Regenerated bundled artifact
```

Для local/CI `check-diff` без contract можно передать тот же intent флагом:

```bash
repo-guard check-diff --base main --head feature --change-class generated-refresh
```

Если `docs-cleanup` PR затронет `src/core.mjs`, output явно покажет объявленный class, detected surfaces и нарушившую комбинацию:

```text
  FAIL: surface-matrix
    change_class "docs-cleanup" cannot touch surfaces: kernel
    change_class: docs-cleanup
    touched_surfaces: docs, kernel
    allowed_surfaces: docs, governance
    forbidden_surfaces: generated, kernel, release, tests
    violating_surfaces: kernel
    surface kernel matched: src/core.mjs
```

Файл может совпасть с несколькими surfaces; repo-guard считает все совпадения. Когда `surface_matrix` включён, changed file, который не совпал ни с одной surface, по умолчанию считается нарушением:

```text
  FAIL: surface-matrix
    surface_matrix found changed files that match no declared surface: scripts/tool.mjs
    change_class: docs-cleanup
    touched_surfaces: (none)
    unclassified_files: scripts/tool.mjs
    changed files matched no declared surface: scripts/tool.mjs
    hint: Add matching surface globs or set allow_unclassified_files: true if unclassified files are intentional.
```

Если policy намеренно описывает только часть репозитория, можно явно включить `"allow_unclassified_files": true`. По умолчанию это `false`, чтобы matrix-проверку нельзя было обойти файлами вне объявленных surfaces.

## GitHub Action (reusable)

`repo-guard` is packaged as a reusable GitHub Action so any repository can adopt it without installing Node.js manually or hand-assembling a custom workflow.

### Quick start

1. Add `repo-policy.json` to your repository root (see [minimum example](#1-policy) or copy `templates/repo-policy.min.json`).
2. Create `.github/workflows/repo-guard.yml` (replace `vX.Y.Z` with the [latest release tag](https://github.com/netkeep80/repo-guard/releases)):

```yaml
name: repo-guard policy check

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [main]

jobs:
  policy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # required for base...head diff

      - name: Enforce repository policy
        uses: netkeep80/repo-guard@vX.Y.Z  # replace with latest release tag
        with:
          mode: check-pr
          enforcement: blocking
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

3. Add a change contract to each PR description or its linked issue (see [templates/pr-contract-example.md](templates/pr-contract-example.md)).

A copy-pasteable version of this workflow is also available at [`templates/example-workflow.yml`](templates/example-workflow.yml).

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `mode` | no | `check-pr` | `check-pr` — validate a PR in GitHub Actions context. `check-diff` — validate a local diff between two refs. |
| `enforcement` | no | `blocking` | `blocking`/`enforce` fails the job on policy violations. `advisory`/`warn` reports violations but exits successfully. |
| `repo-root` | no | `$GITHUB_WORKSPACE` | Path to the directory containing `repo-policy.json`. |
| `base` | no | _(empty)_ | Base git ref for diff (`check-diff` only). |
| `head` | no | _(empty)_ | Head git ref for diff (`check-diff` only). |
| `contract` | no | _(empty)_ | Path to a contract JSON file, relative to `repo-root` (`check-diff` only). |
| `change-class` | no | _(empty)_ | Named change class for `surface_matrix` enforcement (`check-diff` only). Overrides contract `change_class` when set. |
| `node-version` | no | `20` | Node.js version used to run repo-guard. |

### Outputs

| Output | Description |
|---|---|
| `result` | `passed`, `failed`, or `error` |
| `summary` | Human-readable one-line summary (mirrors the `Summary:` line from CLI output). |

### Enforcement modes

**Advisory** — record the result but do not block the PR:

```yaml
- name: repo-guard (advisory)
  id: guard
  uses: netkeep80/repo-guard@vX.Y.Z  # replace with latest release tag
  with:
    mode: check-pr
    enforcement: advisory
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Show result
  run: echo "repo-guard result: ${{ steps.guard.outputs.result }}"
```

In advisory mode, the Action step exits successfully for policy violations, but `steps.guard.outputs.result` is still `failed` when checks found violations. Configuration/runtime errors still fail the step.

**Blocking** — the step fails the job if any policy check fails (default behaviour):

```yaml
- name: repo-guard (blocking)
  uses: netkeep80/repo-guard@vX.Y.Z
  with:
    mode: check-pr
    enforcement: blocking
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Pinning the version

Pin to a release tag to get reproducible runs. The Action always executes the CLI bundled with that tag, so pinning the Action ref is sufficient. Find available release tags on the [Releases page](https://github.com/netkeep80/repo-guard/releases).

```yaml
- uses: netkeep80/repo-guard@vX.Y.Z   # replace with a release tag, e.g. v1.2.3
  with:
    mode: check-pr
    enforcement: blocking
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Using check-diff in CI

```yaml
- uses: netkeep80/repo-guard@vX.Y.Z  # replace with latest release tag
  with:
    mode: check-diff
    enforcement: advisory
    base: main
    head: ${{ github.sha }}
    contract: path/to/contract.json
    change-class: docs-cleanup
```

## Использование в GitHub PR workflow

Типичный рабочий процесс:

1. Создаётся issue с описанием задачи (опционально с change contract).
2. Создаётся PR с ссылкой на issue (`Fixes #N`).
3. В теле PR или linked issue размещается change contract в блоке ` ```repo-guard-yaml ` или совместимом ` ```repo-guard-json `.
4. CI запускает `check-pr` — извлекает contract, валидирует его, проверяет diff.
5. PR проходит, если все проверки пройдены. Иначе — понятное сообщение об ошибке.

Пример конфигурации CI (`.github/workflows/ci.yml`):

```yaml
- name: Run PR policy check
  if: github.event_name == 'pull_request' && !github.event.pull_request.draft
  run: npx repo-guard --enforcement blocking check-pr
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Важные детали:
- **Draft PR** пропускаются — `check-pr` не запускается для черновиков, чтобы не блокировать WIP.
- Для корректной работы diff нужен `fetch-depth: 0` в `actions/checkout`.
- `gh` CLI требует токен для доступа к linked issue (через `GH_TOKEN`).

## Self-hosting

This repository is governed by `repo-guard` itself. The CI workflow runs the checked-out local Action (`uses: ./`) on ready pull requests in `blocking` mode, so changes to the package, schemas, templates, workflow, and docs are checked through the same `check-pr` integration path that downstream repositories use. Draft pull requests are excluded only to keep work-in-progress branches unblocked before review.

The same workflow also runs an advisory-mode fixture with `check-diff`. That fixture intentionally creates a policy violation and verifies that advisory mode reports `Result: failed` while keeping the job step successful. This keeps both rollout modes covered by the repo's normal CI.

The self-hosted governance surface is declared in `repo-policy.json` under `paths.governance_paths`:

| Path | Why it is governed |
|---|---|
| `repo-policy.json` | Defines the policy used by this repository and the default blocking mode. |
| `schemas/` | Defines the accepted policy and change contract formats. |
| `.github/workflows/` | Runs the self-hosted checks that protect pull requests. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Captures the change contract expected by `check-pr`. |
| `.github/ISSUE_TEMPLATE/` | Captures linked issue contracts used by PR fallback. |
| `templates/` | Ships the example policy, workflow, and contract templates used by adopters. |
| `action.yml` | Defines the reusable GitHub Action interface and execution path. |

`governance_paths` is informational today, but changes in these paths are treated as product changes: failures in self-hosting are bugs in the repository workflow, not downstream-only setup problems. GitHub workflow and template files are deliberately not listed as `operational_paths`, so they cannot bypass normal policy checks.

## Ограничения и текущий статус

- `governance_paths` — информационное поле, не проверяется в runtime. Документирует, какие файлы управляют governance.
- `public_api` — зарезервировано для будущего использования. Принимается схемой, но не применяется; непустые значения выводят предупреждение.
- `overrides` (в change contract) — зарезервировано для будущего использования. Принимается схемой, но не применяется; непустые значения выводят предупреждение.
- `repo-guard` пока не публикует комментарии к PR.
- Паттерны `forbid_regex` компилируются и проверяются до начала enforcement — ошибки в regex выявляются на этапе загрузки policy.

## Лицензия

[Unlicense](LICENSE)
