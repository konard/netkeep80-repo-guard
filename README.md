# repo-guard

Policy engine для репозитория: формализует правила репозитория в виде машиночитаемого JSON и проверяет реальные изменения на соответствие этим правилам.

## Какую проблему решает

При активной разработке — особенно с использованием AI-ассистентов — в репозиторий начинает попадать лишнее: временные документы, промежуточные файлы, process-noise. Pull request'ы разрастаются, намерение изменения и реальный diff расходятся, а ручной контроль не масштабируется.

`repo-guard` решает эту проблему: он позволяет описать допустимые правила репозитория в файле `repo-policy.json` и автоматически проверять каждый diff на соответствие этим правилам. Это исполняемая дисциплина, а не устная договорённость.

В контексте AI-assisted development это особенно важно: AI-агенты генерируют код быстро, но не всегда учитывают структурные ограничения проекта. `repo-guard` выступает автоматическим контролёром, который не пропустит изменения, нарушающие политику репозитория.

## Что это такое

`repo-guard` — это **policy-as-code** движок для Git-репозиториев:

- **Policy** (`repo-policy.json`) — декларативное описание правил: запрещённые пути, бюджеты на файлы и строки, правила совместных изменений, контентные ограничения.
- **Change contract** — JSON-документ, описывающий намерение конкретного изменения: что именно должно измениться, чего трогать нельзя, допустимые бюджеты.
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
| Co-change rules | Если изменён X, должен быть изменён и Y |
| Content rules | Запрещает regex-паттерны в добавленных строках |
| must_touch | Хотя бы один из указанных паттернов должен совпасть с изменённым файлом (из contract) |
| must_not_touch | Ни один из указанных паттернов не должен совпасть с изменённым файлом (из contract) |

Operational paths (bot-артефакты) исключаются из всех проверок.

### PR policy gate (`check-pr`)

1. Извлекает change contract из тела PR (блок ` ```repo-guard-json `).
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
| Шаблоны | `templates/` | Примеры policy и contract |

## Быстрый старт

### Установка

```bash
git clone https://github.com/netkeep80/repo-guard.git
cd repo-guard
npm install
```

Требования: Node.js ≥ 20.

### Валидация policy

```bash
node src/repo-guard.mjs
```

Проверяет `repo-policy.json` в текущей директории по JSON Schema. Выводит `OK` или список ошибок.

### Валидация change contract

```bash
node src/repo-guard.mjs path/to/contract.json
```

Проверяет и policy, и contract по соответствующим схемам.

### Проверка diff

```bash
# Проверить staged изменения (или HEAD если staged пуст)
node src/repo-guard.mjs check-diff

# Проверить diff между ветками
node src/repo-guard.mjs check-diff --base main --head feature

# Проверить diff с change contract
node src/repo-guard.mjs check-diff --contract path/to/contract.json
```

### Проверка PR (в GitHub Actions)

```bash
node src/repo-guard.mjs check-pr
```

Требования для `check-pr`:
- переменная окружения `GITHUB_EVENT_PATH` (устанавливается GitHub Actions автоматически);
- `git` CLI с достаточной глубиной fetch для base...head diff;
- `gh` CLI с авторизацией (для fallback на linked issue);
- event payload типа `pull_request` с base/head SHA.

### Использование в другом репозитории

```bash
node src/repo-guard.mjs --repo-root /path/to/other/repo
node src/repo-guard.mjs check-diff --repo-root /path/to/other/repo --base main --head feature
```

Флаг `--repo-root` указывает, где искать `repo-policy.json` и выполнять git-операции. Схемы загружаются из пакета `repo-guard`.

### Запуск тестов

```bash
npm test
```

## Минимальный пример

### 1. Policy

Минимальный `repo-policy.json`:

```json
{
  "policy_format_version": "0.1.0",
  "repository_kind": "application",
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

Пример contract в теле PR (внутри блока ` ```repo-guard-json `):

````markdown
```repo-guard-json
{
  "change_type": "bugfix",
  "scope": ["src/pagination.mjs"],
  "budgets": {
    "max_new_files": 0,
    "max_new_docs": 0
  },
  "must_touch": ["src/pagination.mjs"],
  "must_not_touch": ["schemas/", "repo-policy.json"],
  "expected_effects": ["Pagination returns correct page count"]
}
```
````

Contract говорит: это bugfix, который должен затронуть `src/pagination.mjs`, не должен трогать схемы и policy, и не должен создавать новых файлов.

### 3. Что проверяет repo-guard

При запуске `check-diff` или `check-pr` repo-guard сравнивает реальный diff с policy и contract:

```
OK: repo-policy.json

Diff analysis: 3 file(s) changed
  PASS: forbidden-paths
  PASS: canonical-docs-budget
  PASS: max-new-files
  PASS: max-net-added-lines
  PASS: cochange-rules
  PASS: content-rules
  PASS: must-touch
  PASS: must-not-touch

Summary: 8 passed, 0 failed
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

## Использование в GitHub PR workflow

Типичный рабочий процесс:

1. Создаётся issue с описанием задачи (опционально с change contract).
2. Создаётся PR с ссылкой на issue (`Fixes #N`).
3. В теле PR или linked issue размещается change contract в блоке ` ```repo-guard-json `.
4. CI запускает `check-pr` — извлекает contract, валидирует его, проверяет diff.
5. PR проходит, если все проверки пройдены. Иначе — понятное сообщение об ошибке.

Пример конфигурации CI (`.github/workflows/ci.yml`):

```yaml
- name: Run PR policy check
  if: github.event_name == 'pull_request' && !github.event.pull_request.draft
  run: node src/repo-guard.mjs check-pr
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Важные детали:
- **Draft PR** пропускаются — `check-pr` не запускается для черновиков, чтобы не блокировать WIP.
- Для корректной работы diff нужен `fetch-depth: 0` в `actions/checkout`.
- `gh` CLI требует токен для доступа к linked issue (через `GH_TOKEN`).

## Ограничения и текущий статус

- `governance_paths` — информационное поле, не проверяется в runtime. Документирует, какие файлы управляют governance.
- `public_api` — зарезервировано для будущего использования. Принимается схемой, но не применяется; непустые значения выводят предупреждение.
- `overrides` (в change contract) — зарезервировано для будущего использования. Принимается схемой, но не применяется; непустые значения выводят предупреждение.
- `repo-guard` пока не публикует комментарии к PR и не оформлен как переиспользуемый GitHub Action. Это запланировано.
- Паттерны `forbid_regex` компилируются и проверяются до начала enforcement — ошибки в regex выявляются на этапе загрузки policy.

## Лицензия

[Unlicense](LICENSE)
