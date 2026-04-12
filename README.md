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
| Init scaffolding | `src/init.mjs` | Генерация начальной конфигурации |
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
repo-guard init --mode enforce    # по умолчанию — строгие бюджеты
repo-guard init --mode advisory   # ослабленные бюджеты (50 файлов, 10 docs, 5000 строк)
```

Режим `advisory` удобен для начала: бюджеты значительно расширены (50 файлов, 10 docs, 5000 строк), что снижает вероятность блокировки PR. Workflow по-прежнему запускается и сообщает о нарушениях, но широкие лимиты позволяют освоиться с repo-guard до перехода на строгий `enforce`.

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
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

3. Add a change contract to each PR description or its linked issue (see [templates/pr-contract-example.md](templates/pr-contract-example.md)).

A copy-pasteable version of this workflow is also available at [`templates/example-workflow.yml`](templates/example-workflow.yml).

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `mode` | no | `check-pr` | `check-pr` — validate a PR in GitHub Actions context. `check-diff` — validate a local diff between two refs. |
| `repo-root` | no | `$GITHUB_WORKSPACE` | Path to the directory containing `repo-policy.json`. |
| `base` | no | _(empty)_ | Base git ref for diff (`check-diff` only). |
| `head` | no | _(empty)_ | Head git ref for diff (`check-diff` only). |
| `contract` | no | _(empty)_ | Path to a contract JSON file, relative to `repo-root` (`check-diff` only). |
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
  continue-on-error: true
  with:
    mode: check-pr
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Show result
  run: echo "repo-guard result: ${{ steps.guard.outputs.result }}"
```

**Blocking** — the step fails the job if any check fails (default behaviour; no extra config needed).

### Pinning the version

Pin to a release tag to get reproducible runs. The Action always executes the CLI bundled with that tag, so pinning the Action ref is sufficient. Find available release tags on the [Releases page](https://github.com/netkeep80/repo-guard/releases).

```yaml
- uses: netkeep80/repo-guard@vX.Y.Z   # replace with a release tag, e.g. v1.2.3
  with:
    mode: check-pr
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Using check-diff in CI

```yaml
- uses: netkeep80/repo-guard@vX.Y.Z  # replace with latest release tag
  with:
    mode: check-diff
    base: main
    head: ${{ github.sha }}
    contract: path/to/contract.json
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
  run: npx repo-guard check-pr
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
- `repo-guard` пока не публикует комментарии к PR.
- Паттерны `forbid_regex` компилируются и проверяются до начала enforcement — ошибки в regex выявляются на этапе загрузки policy.

## Лицензия

[Unlicense](LICENSE)
