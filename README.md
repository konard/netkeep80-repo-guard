# repo-guard

`repo-guard` - это командная утилита и GitHub Action для исполняемой политики
репозитория. Он проверяет `repo-policy.json`, извлекает контракт изменения из PR
или issue и сверяет его с реальным `git diff`: какие файлы изменены, сколько
строк добавлено, какие области репозитория затронуты и есть ли нарушение правил
проекта.

Инструмент полезен, когда в репозиторий попадают лишние файлы, PR выходит за
рамки заявленного намерения, документация дублируется, изменения кода идут без
тестов или нужно зафиксировать правила для разработки с участием ИИ. Это не
линтер, не сканер безопасности и не замена тестам: `repo-guard` проверяет
структуру и дисциплину изменений, а не качество кода.

## Установка

Требования: Node.js 20 или новее. Для `check-pr` в GitHub Actions также нужны
`git`, `gh`, контекст события pull request и полная история репозитория.

```bash
npm install -g repo-guard

# или без глобальной установки
npx repo-guard
```

В репозитории с исходниками можно запускать напрямую:

```bash
npm ci
node src/repo-guard.mjs
```

## Быстрый старт

Создайте базовую конфигурацию:

```bash
repo-guard init --preset application --mode advisory
```

`init` не перезаписывает существующие файлы и создает:

| Файл | Назначение |
| --- | --- |
| `repo-policy.json` | Политика репозитория |
| `.github/workflows/repo-guard.yml` | Рабочий процесс GitHub Actions |
| `.github/PULL_REQUEST_TEMPLATE.md` | Шаблон PR с контрактом изменения |
| `.github/ISSUE_TEMPLATE/change-contract.yml` | Шаблон issue с контрактом изменения |

Сгенерированный workflow pin-ит Action на release tag установленной версии
`repo-guard` (`netkeep80/repo-guard@v<version>`), а не на ветку `main`.
При обновлении инструмента меняйте этот ref на новый release tag осознанно.
Для поддерживающих релизы это инвариант: `package.json.version` должен
соответствовать опубликованному GitHub tag/release `v<version>` до публикации
npm-пакета. Подробный чеклист и проверка описаны в `RELEASING.md`.

Пресеты:

| Пресет | Для чего | Базовые ограничения |
| --- | --- | --- |
| `application` | Прикладной проект | 20 новых файлов, 3 новых Markdown-файла, 1500 чистых строк |
| `library` | Библиотека | 15 новых файлов, 2 новых Markdown-файла, `src/**` требует `tests/**` |
| `tooling` | Инструменты и инфраструктура | 15 новых файлов, 2 новых Markdown-файла, `src/**` требует `tests/**` |
| `documentation` | Документационный репозиторий | 20 новых файлов, 10 новых Markdown-файлов |

Режим применения правил:

```bash
repo-guard init --mode enforce    # псевдоним для blocking
repo-guard init --mode advisory   # нарушения видны, но код выхода остается 0
```

Проверьте конфигурацию:

```bash
repo-guard
repo-guard doctor
```

## Основной процесс

1. В `repo-policy.json` описывается, что разрешено в репозитории.
2. В PR или issue добавляется контракт изменения: что именно должно измениться.
3. `repo-guard check-diff` или `repo-guard check-pr` строит diff и проверяет его
   против политики и контракта.
4. В режиме `blocking` CI падает при нарушениях; в режиме `advisory` нарушения
   показываются как предупреждения и не блокируют задание CI.

## Команды

| Команда | Что делает |
| --- | --- |
| `repo-guard` | Валидирует `repo-policy.json` по схеме и компилирует правила |
| `repo-guard path/to/contract.json` | Валидирует политику и JSON-контракт изменения |
| `repo-guard check-diff` | Проверяет staged-изменения, а если их нет, `git diff HEAD` |
| `repo-guard check-diff --base main --head feature` | Проверяет `git diff main...feature` |
| `repo-guard check-pr` | Проверяет PR внутри рабочего процесса GitHub Actions `pull_request` |
| `repo-guard init` | Создает стартовую политику, рабочий процесс и шаблоны |
| `repo-guard doctor` | Диагностирует окружение, рабочий процесс, политику и авторизацию |
| `repo-guard validate-integration` | Проверяет integration wiring через normalized facts |

`check-diff`, `check-pr` и `validate-integration` используют общий analysis
report: команды различаются источниками facts, но возвращают один envelope с
`command`, `mode`, `result`, `ok`, `exitCode`, `ruleResults`, `violations`,
`advisoryWarnings`, `hints` и `repositoryRoot`. Каждый check внутри
`ruleResults`/`violations` имеет компактную форму `rule`, `ok`, `severity`,
`details` и optional `data` для rule-specific payload.

Глобальные флаги можно ставить до или после команды:

```bash
repo-guard --repo-root /path/to/repo check-diff --base main --head feature
repo-guard check-diff --repo-root /path/to/repo --base main --head feature
repo-guard --enforcement advisory check-pr
repo-guard --enforcement blocking check-diff --base main --head feature
```

Флаги `--enforcement` и `--enforcement-mode` принимают:

| Значение | Нормализованный режим | Семантика кода выхода |
| --- | --- | --- |
| `blocking`, `enforce` | `blocking` | нарушение политики дает код выхода 1 |
| `advisory`, `warn` | `advisory` | нарушение печатается как предупреждение, код выхода 0 |

## `check-diff`

```bash
# Проверить локальные изменения
repo-guard check-diff

# Проверить две git ref
repo-guard check-diff --base main --head feature

# Подключить JSON-контракт из файла, путь считается от repo-root
repo-guard check-diff --contract contracts/change.json

# Машиночитаемый вывод
repo-guard check-diff --format json --base main --head feature

# Краткая Markdown-сводка для отчета задания GitHub Actions
repo-guard check-diff --format summary --base main --head feature
```

Форматы вывода:

| Формат | Назначение |
| --- | --- |
| `text` | Обычный человекочитаемый вывод CLI |
| `json` | Стабильный структурированный результат; стандартный вывод содержит только JSON |
| `summary` | Markdown в формате GitHub для `$GITHUB_STEP_SUMMARY` |

В JSON-результате есть `command`, `mode`, `result`, `ok`, `exitCode`,
`violations`, `advisoryWarnings`, `ruleResults`, `hints`, `repositoryRoot` и
краткая статистика diff. Если включены якоря трассировки, добавляются `anchors` и
`traceRuleResults`. Rule-specific поля не смешиваются с envelope: они лежат в
`ruleResults[].data`, `violations[].data` или `advisoryWarnings[].data`.

## `check-pr`

`check-pr` рассчитан на рабочий процесс pull request:

1. Читает `GITHUB_EVENT_PATH`.
2. Берет базовый и головной SHA из события pull request.
3. Валидирует `repo-policy.json` из рабочей копии PR как предлагаемую будущую
   политику.
4. Читает `repo-policy.json` из базового SHA PR и использует именно эту
   доверенную политику для проверки текущего diff.
5. Извлекает контракт из тела PR.
6. Если контракта в PR нет, ищет ровно одну связанную issue по `Fixes #N`,
   `Closes #N` или `Resolves owner/repo#N` и пробует взять контракт из issue.
7. Валидирует контракт по `schemas/change-contract.schema.json`.
8. Проверяет `git diff base...head` тем же конвейером политики, что и
   `check-diff`, но с политикой базовой ветки.

Если PR ссылается на несколько issues без контракта в PR, команда завершается
ошибкой `issue_link_ambiguous`. Для резервного чтения связанной issue нужен
`GH_TOKEN` или `GITHUB_TOKEN`, доступный `gh` CLI и `fetch-depth: 0`.

## GitHub Action

Минимальный рабочий процесс:

```yaml
name: Проверка политики repo-guard

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [main]

permissions:
  contents: read
  pull-requests: read
  issues: read

jobs:
  policy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: netkeep80/repo-guard@vX.Y.Z
        with:
          mode: check-pr
          enforcement: blocking
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Publish repo-guard summary
        if: always()
        run: echo "### repo-guard" >> "$GITHUB_STEP_SUMMARY"
```

Используйте тег релиза вместо `vX.Y.Z` для воспроизводимых запусков.
`repo-guard init` заполняет этот ref тегом версии установленного пакета. При
локальной самопроверке внутри этого репозитория рабочий процесс может
использовать `uses: ./`.

Параметры GitHub Action:

| Параметр | Значение по умолчанию | Когда нужен |
| --- | --- | --- |
| `mode` | `check-pr` | `check-pr` для рабочего процесса PR, `check-diff` для явно заданных git ref |
| `enforcement` | `blocking` | `advisory` для мягкого внедрения |
| `repo-root` | `$GITHUB_WORKSPACE` | Когда политика лежит не в текущей директории |
| `base` | пусто | Базовая git ref для `mode: check-diff` |
| `head` | пусто | Головная git ref для `mode: check-diff` |
| `contract` | пусто | Путь к JSON-контракту для `mode: check-diff` |
| `node-version` | `20` | Версия Node.js для запуска Action |

Выходные параметры GitHub Action:

| Параметр | Значение |
| --- | --- |
| `result` | `passed`, `failed` или `error` |
| `summary` | Однострочное описание результата |

## Политика

Минимальный `repo-policy.json`:

```json
{
  "policy_format_version": "0.3.0",
  "repository_kind": "tooling",
  "enforcement": {
    "mode": "blocking"
  },
  "paths": {
    "forbidden": ["*.bak", "*.log"],
    "canonical_docs": ["README.md"],
    "governance_paths": ["repo-policy.json"],
    "operational_paths": [".claude/**", ".gitkeep"]
  },
  "diff_rules": {
    "max_new_docs": 2,
    "max_new_files": 15,
    "max_net_added_lines": 2000
  },
  "content_rules": [],
  "cochange_rules": []
}
```

Основные поля политики:

| Поле | Поведение при проверке |
| --- | --- |
| `paths.forbidden` | Запрещает измененные или новые файлы по glob |
| `paths.canonical_docs` | Не считает перечисленные Markdown-файлы новыми документами |
| `paths.operational_paths` | Полностью исключает служебные артефакты из проверок diff |
| `diff_rules.max_new_docs` | Ограничивает новые `.md` вне `canonical_docs` |
| `diff_rules.max_new_files` | Ограничивает общее число новых файлов |
| `diff_rules.max_net_added_lines` | Ограничивает чистое число добавленных строк |
| `size_rules` | Ограничивает абсолютный размер файлов или subtree в строках/байтах |
| `content_rules` | Ищет запрещенные регулярные выражения только в добавленных строках |
| `cochange_rules` | Требует `must_change_any`, если сработал `if_changed` |
| `surfaces` | Описывает именованные области репозитория по glob |
| `new_file_classes` | Описывает именованные классы новых файлов |
| `change_profiles` | Единственная модель политики по `change_type`: разрешенные/запрещенные области, классы новых файлов и лимиты |
| `registry_rules` | Сверяет канонические списки из JSON или Markdown |
| `advisory_text_rules` | Предупреждает о похожей Markdown-документации, но не блокирует |
| `profile` | Подключает встроенный профиль политики перед runtime-проверками |
| `profile_overrides` | Уточняет поддерживаемые параметры встроенного профиля |
| `anchors` | Извлекает якоря трассировки из regex или источников JSON-полей |
| `trace_rules` | Проверяет разрешение якорей и наличие файлов-подтверждений |
| `integration` | Декларативно описывает downstream-интеграцию: workflows, templates, docs и profiles |

Зарезервированные или информационные поля:

| Поле | Поведение сейчас |
| --- | --- |
| `paths.governance_paths` | Блокирует правки перечисленных файлов управления, пока в теле связанного issue не появится блок `repo-guard-yaml` с `authorized_governance_paths`. В `check-pr` вся runtime-политика читается из `repo-policy.json` базовой ветки, а поле `authorized_governance_paths` в PR-body-контракте игнорируется (см. раздел «Санкционирование изменений политики») |
| `paths.public_api` | Зарезервировано; непустое значение дает предупреждение |
| `contract.overrides` | Зарезервировано; непустое значение дает предупреждение |

Если `change_profiles[change_type]` задает ограничения по областям, файл без
подходящей области по умолчанию считается нарушением. Разрешить частичное
покрытие можно через `change_profiles[change_type].allow_unclassified_surfaces: true`.

## Size Rules

`size_rules` задает first-class лимиты на абсолютный размер файлов и каталогов.
Правило может считать строки (`lines`) или байты (`bytes`), проверять каждый
файл (`scope: "file"`) или aggregate subtree (`scope: "directory"`).

```json
{
  "size_rules": [
    {
      "id": "max-source-file-lines",
      "scope": "file",
      "metric": "lines",
      "glob": "src/**/*.mjs",
      "max": 500
    },
    {
      "id": "max-source-subtree-bytes",
      "scope": "directory",
      "metric": "bytes",
      "glob": "src/**",
      "max": 262144,
      "count": "changed_only"
    }
  ]
}
```

По умолчанию `count` равно `all_tracked`: правило проверяет все tracked files,
которые подходят под `glob`. Для `count: "changed_only"` file-правило проверяет
только измененные файлы, а directory-правило проверяет subtree только если в нем
есть измененный файл. Размер directory считается по всем tracked files внутри
subtree, чтобы лимит оставался ограничением абсолютной поверхности.

Дополнительные поля:

| Поле | Поведение |
| --- | --- |
| `ignore` | Исключает matching paths из конкретного size rule |
| `level` | `blocking` по умолчанию; `advisory` сообщает warning без fail |
| `applies_to_change_types` | Применяет правило только к указанным `change_type` |

Нарушения включают rule id, scope, path, metric, measured size и max. В JSON
результате они лежат в `violations[].data.size_violations`.

## Профили политики

`profile` включает встроенный набор `anchors` и `trace_rules`, который
`repo-guard` разворачивает после schema validation и до компиляции политики.
Сейчас поддерживается профиль `requirements-strict` для репозиториев, где JSON
requirements являются каноническими trace anchors.

Минимальная форма:

```json
{
  "policy_format_version": "0.3.0",
  "repository_kind": "library",
  "profile": "requirements-strict",
  "profile_overrides": {
    "strict_heading_docs": [
      "docs/architecture.md",
      "docs/pmm_requirements.md"
    ],
    "evidence_surfaces": [
      "include/**",
      "src/**",
      "tests/**",
      "examples/**",
      "docs/**",
      "README.md",
      "requirements/README.md",
      "scripts/**",
      ".github/workflows/**"
    ]
  },
  "paths": {
    "forbidden": ["*.bak"],
    "canonical_docs": ["README.md", "requirements/README.md"],
    "governance_paths": ["repo-policy.json"],
    "operational_paths": [".claude/**"]
  },
  "diff_rules": {
    "max_new_docs": 2,
    "max_new_files": 12,
    "max_net_added_lines": 1200
  },
  "content_rules": [],
  "cochange_rules": []
}
```

`requirements-strict` разворачивает canonical requirement IDs из
`requirements/{business,stakeholder,functional,nonfunctional,constraints,interface}/*.json`,
проверяет ссылки на requirement IDs в JSON, коде и Markdown, требует
bracketed requirement links в строгих heading docs и применяет evidence rules
для измененных requirements и `anchors.affects` / `anchors.implements` /
`anchors.verifies`.

Поддерживаемые `profile_overrides`:

| Поле | Что уточняет |
| --- | --- |
| `requirement_json_globs` | JSON-файлы требований для canonical IDs и JSON trace refs |
| `code_reference_globs` | Файлы кода, тестов, скриптов и examples для `@req` refs |
| `doc_reference_globs` | Markdown-файлы для обычных requirement refs |
| `strict_heading_docs` | Markdown-файлы, где headings обязаны иметь `[REQ-000]` |
| `evidence_surfaces` | Общие evidence paths для changed requirements и affected anchors |
| `changed_requirement_evidence_surfaces` | Evidence paths только для changed requirement JSON |
| `affected_evidence_surfaces` | Evidence paths только для `anchors.affects` |
| `implementation_evidence_surfaces` | Evidence paths только для `anchors.implements` |
| `verification_evidence_surfaces` | Evidence paths только для `anchors.verifies` |

Если политика уже содержит явные `anchors` или `trace_rules`, эти развернутые
поля остаются валидными и имеют приоритет над generated section профиля. Это
сохраняет backward compatibility для репозиториев, которые уже хранят expanded
policy вручную. Подробный контракт профиля описан в
[`docs/requirements-strict-profile.md`](docs/requirements-strict-profile.md).

## Интеграционный слой

`integration` описывает, как downstream-репозиторий должен подключать
`repo-guard`: какой workflow запускает проверку, какие шаблоны содержат
contract block, какие документы объясняют contract/profile/anchor-практики и
где описаны профили. Это декларативный слой политики: `repo-guard` читает
перечисленные YAML/Markdown-файлы, строит normalized facts и применяет
`validate-integration` diagnostics к объявленным ожиданиям.

Во время компиляции политики `repo-guard` проверяет, что ids уникальны во всей
`integration` секции, обязательные поля заполнены, workflow/template/doc kinds
и workflow roles известны, а поля `profiles` ссылаются на объявленные
`integration.profiles[].id`. Сейчас поддерживаются:

| Поле | Допустимые значения |
| --- | --- |
| `workflows[].kind` | `github_actions` |
| `workflows[].role` | `repo_guard_pr_gate`, `repo_guard_advisory`, `repo_guard_policy_validation` |
| `templates[].kind` | `markdown`, `github_issue_form` |
| `docs[].kind` | `markdown` |

Для `workflows[].role: "repo_guard_pr_gate"` можно объявить `expect`:

| Поле | Что проверяет |
| --- | --- |
| `events` | Обязательные GitHub Actions events, например `pull_request` |
| `event_types` | Обязательные `pull_request.types` / `pull_request_target.types` |
| `action.uses` | Ожидаемый Action target, например `netkeep80/repo-guard` или `./` |
| `action.ref_pinning` | Стратегия pinning: `local`, `ref`, `tag`, `semver`, `sha` или `any` |
| `action.ref` | Конкретный ожидаемый ref Action |
| `mode` | Ожидаемый input `mode`, обычно `check-pr` |
| `enforcement` | Ожидаемый input `enforcement`: `blocking` или `advisory` |
| `permissions` | Минимальные workflow/job permissions, например `contents: read` |
| `token_env` | Альтернативные env-переменные токена, из которых нужна хотя бы одна |
| `required_env` | Env-переменные, которые должны присутствовать все |
| `summary` | Требовать запись в `$GITHUB_STEP_SUMMARY` |
| `disallow` | Запрещенные patterns: `continue_on_error`, `manual_clone`, `direct_temp_cli_execution` |

`buildPolicyFacts(...).integration` содержит:

| Факт | Что извлекается |
| --- | --- |
| `workflows` | GitHub Actions events, permissions, `uses`, `with`, `env`, `if` и публикация в `$GITHUB_STEP_SUMMARY` |
| `templates` | Наличие fenced `repo-guard-yaml` / `repo-guard-json` blocks и поля контракта |
| `docs` | Markdown headings, code blocks и упоминания из `must_mention` |
| `profiles` | Идентификаторы профилей, migration target mentions и ссылки на имя профиля |
| `errors` | Явные ошибки чтения, malformed YAML, malformed contract blocks и незакрытые Markdown fences |

Template rules могут дополнительно требовать конкретный fenced block kind
через `required_block_kind`, поля внутри примера контракта через
`required_contract_fields`, а fallback issue template можно объявить
`optional: true`. Optional template не считается ошибкой, если файл отсутствует,
но проверяется обычными template rules, когда файл есть.

Doc rules поддерживают несколько типов обязательных ссылок:
`must_mention` для общих терминов, `must_reference_files` для путей файлов,
`must_mention_profiles` для integration profile ids и
`must_mention_contract_fields` для contract field anchors вроде
`change_type`, `scope` или `anchors.affects`. Ошибки template rules и doc
rules остаются в разных diagnostics: `integration-templates` и
`integration-docs`.

Проверить integration layer как отдельный продуктовый diagnostic:

```bash
repo-guard validate-integration
repo-guard validate-integration --format json
repo-guard validate-integration --format summary
repo-guard --enforcement advisory validate-integration --format summary
repo-guard doctor --integration --format json
```

`validate-integration` читает только файлы репозитория, объявленные в
`repo-policy.json`, и не требует `GITHUB_EVENT_PATH`. В blocking-режиме
диагностические нарушения дают код выхода 1; в advisory-режиме они остаются в
JSON/summary как violations, но код выхода остается 0. JSON-вывод использует тот
же analysis envelope и добавляет normalized `integration` facts, `diagnostics` и
итоговый `exitCode`.

Для downstream-репозиториев, которые хотят удалить собственные validators,
есть пошаговый migration guide:
[`docs/removing-bespoke-validators.md`](docs/removing-bespoke-validators.md).
Он показывает, как перенести проверки workflow, PR template, issue template,
docs и `requirements-strict` traceability в `integration` policy. Готовые
snippets лежат в
[`examples/downstream-integration-policy.json`](examples/downstream-integration-policy.json)
и
[`examples/replace-custom-validator-workflow.yml`](examples/replace-custom-validator-workflow.yml).

Пример:

```json
{
  "integration": {
    "workflows": [
      {
        "id": "pr-gate",
        "kind": "github_actions",
        "path": ".github/workflows/repo-guard.yml",
        "role": "repo_guard_pr_gate",
        "profiles": ["requirements-strict"],
        "expect": {
          "events": ["pull_request"],
          "event_types": ["opened", "synchronize", "reopened", "ready_for_review"],
          "action": {
            "uses": "netkeep80/repo-guard",
            "ref_pinning": "semver"
          },
          "mode": "check-pr",
          "enforcement": "blocking",
          "permissions": {
            "contents": "read",
            "pull-requests": "read",
            "issues": "read"
          },
          "token_env": ["GH_TOKEN"],
          "summary": true,
          "disallow": ["continue_on_error", "manual_clone", "direct_temp_cli_execution"]
        }
      }
    ],
    "templates": [
      {
        "id": "pull-request-template",
        "kind": "markdown",
        "path": ".github/PULL_REQUEST_TEMPLATE.md",
        "requires_contract_block": true,
        "required_block_kind": "repo-guard-yaml",
        "required_contract_fields": ["change_type", "scope", "anchors.affects"],
        "profiles": ["requirements-strict"]
      },
      {
        "id": "change-contract-issue-form",
        "kind": "github_issue_form",
        "path": ".github/ISSUE_TEMPLATE/change-contract.yml",
        "requires_contract_block": true,
        "optional": true,
        "required_block_kind": "repo-guard-yaml",
        "required_contract_fields": ["change_type", "scope"]
      }
    ],
    "docs": [
      {
        "id": "readme",
        "kind": "markdown",
        "path": "README.md",
        "must_mention": ["repo-guard", "anchors.affects"],
        "must_reference_files": ["repo-policy.json", ".github/PULL_REQUEST_TEMPLATE.md"],
        "must_mention_profiles": ["requirements-strict"],
        "must_mention_contract_fields": ["change_type", "scope", "anchors.affects"],
        "profiles": ["requirements-strict"]
      }
    ],
    "profiles": [
      {
        "id": "requirements-strict",
        "doc_path": "docs/requirements-strict-profile.md"
      }
    ]
  }
}
```

## Контракт изменения

В PR и issue предпочтителен YAML-блок:

````markdown
```repo-guard-yaml
change_type: docs
scope:
  - README.md
budgets:
  max_new_files: 0
  max_new_docs: 0
  max_net_added_lines: 500
must_touch:
  - README.md
must_not_touch:
  - src/**
  - schemas/**
expected_effects:
  - README описывает текущее поведение CLI и GitHub Action
```
````

Старый JSON-блок тоже поддерживается:

````markdown
```repo-guard-json
{
  "change_type": "docs",
  "scope": ["README.md"],
  "budgets": {},
  "must_touch": ["README.md"],
  "must_not_touch": ["src/**"],
  "expected_effects": ["README актуален и короче прежней версии"]
}
```
````

Обязательные поля контракта:

| Поле | Значение |
| --- | --- |
| `change_type` | Тип изменения; ключ в `change_profiles` |
| `scope` | Область заявленного изменения |
| `budgets` | Перекрывает глобальные лимиты diff для PR |
| `must_touch` | Список glob: хотя бы один шаблон должен совпасть |
| `must_not_touch` | Ни один шаблон не должен совпасть |
| `expected_effects` | Ожидаемый эффект изменения |

Опциональные поля:

| Поле | Когда нужно |
| --- | --- |
| `surface_debt` | Для явного временного роста области: новые файлы или чистые строки |
| `anchors.affects` | Какие якоря затрагивает изменение |
| `anchors.implements` | Какие якоря реализуются |
| `anchors.verifies` | Какие якоря проверяются |
| `overrides` | Зарезервировано, принимается схемой, но не применяется |

`surface_debt` без `repayment_issue` или с фактическим ростом выше
`expected_delta` считается нарушением. Если рост есть, а `surface_debt` не
заявлен, проверка сообщает статус `undeclared`, но сама по себе не блокирует PR.

## Проверки diff

`check-diff` и `check-pr` используют общий конвейер. Служебные пути сначала
исключаются, затем выполняются проверки:

| Проверка | Что проверяет |
| --- | --- |
| `forbidden-paths` | Запрещенные пути |
| `canonical-docs-budget` | Лимит новых Markdown-документов |
| `max-new-files` | Лимит новых файлов |
| `max-net-added-lines` | Лимит чистого числа добавленных строк |
| `surface-debt` | Заявленный временный рост области |
| `size-rules` | Лимиты абсолютного размера файлов и subtree |
| `registry-rules` | Согласованность канонических реестров |
| `advisory-text-rules` | Эвристические предупреждения о дублировании Markdown |
| `anchor-extraction` | Ошибки regex/json-извлекателей якорей |
| `trace-rule: <id>` | Разрешение трассировки и требования к файлам-подтверждениям |
| `change-profiles` | Единая модель по `change_type`: области, классы новых файлов, лимиты |
| `cochange-rules` | Сопутствующие изменения |
| `content-rules` | Запрещенные регулярные выражения в добавленных строках |
| `must-touch` | Требование контракта к обязательному пути |
| `must-not-touch` | Запрет контракта на изменение пути |

## Правила реестров

`registry_rules` сравнивает два источника:

| Тип источника | Что читает |
| --- | --- |
| `json_array` | Массив строк из JSON по `json_pointer` |
| `markdown_section_links` | Ссылки из указанного Markdown-раздела |

Поддерживаются `set_equality`, `left_subset_of_right` и
`right_subset_of_left`. Ошибки показывают недостающие и лишние записи.

## Якоря и правила трассировки

`anchors` задает типы фактов трассировки и источники:

| Вид источника | Поведение |
| --- | --- |
| `regex` | Ищет `pattern` по glob, берет группу захвата или совпадение целиком |
| `json_field` | Читает скалярное поле из JSON-файла |

`trace_rules` бывают трех видов:

| Вид | Смысл |
| --- | --- |
| `must_resolve` | Каждый исходный якорь должен иметь подходящий целевой якорь |
| `changed_files_require_evidence` | Изменения по `if_changed` требуют файл-подтверждение |
| `declared_anchors_require_evidence` | Якоря из контракта требуют файл-подтверждение |

Структурированный вывод включает найденные, измененные и заявленные якоря,
диагностику неразрешенных связей и результаты каждого правила трассировки.

## Doctor

```bash
repo-guard doctor
repo-guard --repo-root /path/to/repo doctor
repo-guard doctor --integration --format summary
```

`doctor` проверяет:

| Проверка | Что означает |
| --- | --- |
| `repository-root` | Путь существует и является директорией |
| `git-available` | Git установлен, root похож на git-репозиторий |
| `fetch-depth` | История не shallow |
| `repo-policy.json` | Политика читается, валидируется и компилируется |
| `event-context` | Есть контекст события pull request для `check-pr` |
| `auth-token` | Есть токен или авторизованный `gh` |
| `gh-cli` | `gh` установлен |
| `workflow-config` | Рабочий процесс содержит repo-guard, `fetch-depth: 0` и токен |

Локально отсутствие `GITHUB_EVENT_PATH` обычно дает предупреждение, потому что
`check-pr` нужен только внутри GitHub Actions.

`doctor --integration` запускает тот же встроенный diagnostic engine, что и
`validate-integration`, но оставляет привычный doctor UX для пользователей,
которые хотят проверить только integration wiring.

## Самопроверка репозитория

Этот репозиторий проверяет сам себя через локальный переиспользуемый Action `uses: ./` в
режиме `blocking` для готовых PR. В `repo-policy.json` как управляющие пути
перечислены файлы, которые определяют поведение самого инструмента:
`repo-policy.json`,
`schemas/`, `.github/workflows/`, `.github/PULL_REQUEST_TEMPLATE.md`,
`.github/ISSUE_TEMPLATE/`, `templates/` и `action.yml`. Они не являются
служебными исключениями и должны проходить обычную проверку политики PR.

### Санкционирование изменений политики

Семейство правил `governance-paths` разводит намерение (change intent) и
привилегированную авторизацию по двум независимым каналам:

- **тело PR** описывает *намерение* изменения (`change_type`, `scope`,
  `budgets`, `must_touch`, `must_not_touch`, `expected_effects`, `anchors.*`);
  его пишет автор PR, и ИИ-агент в том числе;
- **тело связанного issue** несёт *привилегированную авторизацию* на правку
  governance-файлов в поле `authorized_governance_paths`; только этот канал
  доверенный, потому что редактирование issue обычно требует прав, которых у
  ИИ-агента нет.

В режиме `check-pr` весь runtime policy читается из `repo-policy.json`
**базовой ветки** (trusted base policy), а не из версии в текущем PR. Поэтому PR
не может ослабить `diff_rules`, `size_rules`, `content_rules` или другие
ограничения, которые применяются к его собственному diff. Версия политики из PR
head всё равно валидируется как предлагаемое будущее состояние, но вступает в
силу только после merge.

Семейство `governance-paths` сравнивает список тронутых файлов с
`paths.governance_paths` из trusted base policy. Это закрывает обходной путь,
при котором PR сначала сужает `governance_paths`, а потом правит файл, уже
выпавший из нового периметра.

`authorized_governance_paths`, указанный в контракте тела PR, намеренно
игнорируется как источник авторизации (диагностика отметит его как
`untrusted_authorization_ignored`). Чтобы правка governance-файла прошла, в
теле issue нужен блок `repo-guard-yaml` с тем же (или покрывающим)
`authorized_governance_paths`, например:

```repo-guard-yaml
change_type: feature
scope:
  - repo-policy.json
budgets: {}
authorized_governance_paths:
  - repo-policy.json
must_touch: []
must_not_touch: []
expected_effects:
  - Relax max-source-file-lines limit to 1200
```

Обычный change contract для PR можно по-прежнему держать в теле PR; issue
нужен только ради privileged authorization, и именно оттуда runtime его
извлекает.

Если `repo-policy.json` базовой ветки не удаётся прочитать или распарсить
(`git show <base>:repo-policy.json` падает, JSON невалиден и т. п.),
`check-pr` **намеренно завершается ошибкой** (`governance-trusted-boundary`)
вместо отката на head policy текущего PR. Без доверенной base policy runtime
не принимает решение по PR: лучше hard fail, чем доверять mutable PR state.

CI также запускает:

- `npx repo-guard` — валидацию политики;
- `npx repo-guard doctor` — диагностику самого репозитория;
- `npx repo-guard validate-integration` — проверку integration-слоя;
- `check-diff --enforcement advisory` на искусственном нарушении, чтобы
  убедиться, что advisory-предупреждения видны, но не ломают задание.

Собственный integration profile этого репозитория называется `self-hosting`;
он документирует профиль, при котором `repo-guard` проверяет собственную
политику, workflow, шаблоны и README как downstream-интеграцию. Матрица
покрытия всех surviving capabilities хранится в
[`docs/self-hosting-coverage.md`](docs/self-hosting-coverage.md) и
[`docs/self-hosting-coverage.json`](docs/self-hosting-coverage.json), а
`tests/test-self-hosting.mjs` проверяет её автоматически: каждая surviving
возможность должна быть использована на этом репо или явно помечена
`not_self_hosted` с письменным объяснением.

## Разработка

```bash
npm ci
npm test
node src/repo-guard.mjs
node src/repo-guard.mjs check-diff --format summary
```

Структура проекта:

| Путь | Назначение |
| --- | --- |
| `src/repo-guard.mjs` | Точка входа CLI |
| `src/diff/` | Разбор diff и вычисление classification facts |
| `src/checks/rule-registry.mjs` | Единый контракт регистрации и исполнения rule families |
| `src/checks/rules/` | Отдельные rule families для diff, surface, registry и content checks |
| `src/github-pr.mjs` | Адаптер GitHub PR |
| `src/markdown-contract.mjs` | Извлечение контракта из Markdown |
| `src/runtime/` | Валидация и общий конвейер политики |
| `src/checks/` | Оркестрация проверок политики |
| `src/extractors/` | Извлекатели якорей и integration facts |
| `schemas/` | JSON Schemas для политики и контракта |
| `templates/` | Примеры политики, рабочего процесса и контрактов |
| `examples/` | Downstream snippets для migration с custom validators |
| `tests/` | Модульные и интеграционные тесты |

## Ограничения

- `repo-guard` не оставляет комментарии в PR.
- `check-diff --contract` читает JSON-файл; YAML-контракт поддерживается в
  Markdown-блоках PR или issue.
- `paths.public_api` и `contract.overrides` не изменяют поведение применения
  правил.
- `integration` извлекает факты из workflow, template, docs и profile files,
  но не применяет их как blocking enforcement.
- Проверки работают по git diff и метаданным политики; корректность продукта
  остается задачей тестов, review и специализированных анализаторов.
