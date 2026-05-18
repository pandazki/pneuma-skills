# Pneuma Translation Guide

Anchor document for every locale shipped in `src/i18n/locales/<locale>/*.json`
and every `LocalizedString` field in `modes/*/manifest.ts`. The English column
is the source of truth. When you translate, **read this whole document first**,
then translate file by file. The glossary trumps personal instinct: if a term
appears in the glossary, use the listed translation, even if a literal
rendering would feel slightly different.

Translation philosophy: **信达雅** — faithfulness, expressiveness, elegance.
Translate the meaning, not the words. UI labels should read like a native
designer wrote them, not like a literal back-translation of English.

---

## 1. Product context

Pneuma Skills is co-creation infrastructure for humans and code agents.

The underlying bet: coding agents already do the actual work against a
directory of files; the system's job is to make human observation and optional
participation intuitive. Agents edit files directly through their native tools
(Read / Edit / Write) — files remain the canonical collaboration surface and
are not abstracted away. Viewers are live **players** for agent output: they
render the work in domain terms (a deck, a board, a project) so humans can
watch what's happening, make direct decisions in the UI when needed, and reach
for structured command suggestions when deeper guidance helps.

Four pillars:

1. **Visual environment** — live players for agent work, with optional human participation.
2. **Skills** — domain knowledge + seed templates + session persistence.
3. **Continuous learning** — an evolution agent extracts cross-session preferences and augments skills.
4. **Distribution** — mode marketplace, publishing, sharing.

Formula: `ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`.

Anyone who reads a UI string should sense this product is for **builders
collaborating with AI** — competent, calm, slightly opinionated. Not corporate.
Not playful-tech. Closer to a precision instrument than a chat app.

---

## 2. Core glossary

These are top-level domain concepts. Use the anchored translation **everywhere
the concept appears**, even if a more natural-sounding phrase would fit a
particular sentence — consistency is what makes a product UI feel like one
voice.

Proper nouns (Pneuma, mode names like Kami / Remotion / Webcraft / GridBoard /
ClipCraft / Mode Maker) stay in their English form across all locales.

| English | zh-CN | zh-TW | ja | ko | es | de |
| --- | --- | --- | --- | --- | --- | --- |
| **Pneuma** | Pneuma | Pneuma | Pneuma | Pneuma | Pneuma | Pneuma |
| **Mode** | 模式 | 模式 | モード | 모드 | Modo | Modus |
| **Viewer** | 视图 | 視圖 | ビューア | 뷰어 | Visor | Ansicht |
| **Agent** | 智能体 | 智慧體 | エージェント | 에이전트 | Agente | Agent |
| **Backend** | 后端 | 後端 | バックエンド | 백엔드 | Motor | Backend |
| **Skill** | 技能 | 技能 | スキル | 스킬 | Habilidad | Skill |
| **Manifest** | 清单 | 清單 | マニフェスト | 매니페스트 | Manifiesto | Manifest |
| **Workspace** | 工作区 | 工作區 | ワークスペース | 워크스페이스 | Espacio de trabajo | Arbeitsbereich |
| **Project** | 项目 | 專案 | プロジェクト | 프로젝트 | Proyecto | Projekt |
| **Session** | 会话 | 工作階段 | セッション | 세션 | Sesión | Sitzung |
| **Launcher** | 启动器 | 啟動器 | ランチャー | 런처 | Lanzador | Launcher |
| **Co-creation** | 共创 | 共創 | 共創 | 공동 창작 | Co-creación | Ko-Kreation |
| **Skill** (verb: install) | 安装技能 | 安裝技能 | スキルをインストール | 스킬 설치 | Instalar habilidad | Skill installieren |
| **Handoff** | 接力 | 接力 | ハンドオフ | 핸드오프 | Transferencia | Übergabe |
| **Evolution / Evolve** | 演化 | 演化 | 進化 | 진화 | Evolución / Evolucionar | Weiterentwicklung / Weiterentwickeln |
| **Replay** | 回放 | 重播 | リプレイ | 리플레이 | Reproducción | Wiedergabe |
| **Checkpoint** | 检查点 | 檢查點 | チェックポイント | 체크포인트 | Punto de control | Checkpoint |
| **Greeting** | 问候语 | 問候語 | 挨拶 | 인사말 | Saludo | Begrüßung |
| **Content set** | 内容集 | 內容集 | コンテンツセット | 콘텐츠 세트 | Conjunto de contenido | Inhaltsset |
| **Init params** | 初始化参数 | 初始化參數 | 初期化パラメータ | 초기화 매개변수 | Parámetros iniciales | Init-Parameter |
| **Permission** | 权限 | 權限 | 権限 | 권한 | Permiso | Berechtigung |
| **Diff** | 差异 | 差異 | 差分 | 차이 | Diferencia | Unterschied |
| **Library** (multi-mode bundle) | 模式合集 | 模式合集 | ライブラリ | 라이브러리 | Biblioteca | Bibliothek |
| **Plugin** | 插件 | 外掛 | プラグイン | 플러그인 | Plugin | Plugin |
| **Snapshot** | 快照 | 快照 | スナップショット | 스냅샷 | Instantánea | Snapshot |
| **Showcase** | 展示 | 展示 | ショーケース | 쇼케이스 | Vitrina | Schaufenster |
| **Published** (mode) | 已发布 | 已發布 | 公開済み | 게시됨 | Publicado | Veröffentlicht |
| **Built-in** | 内置 | 內建 | 組み込み | 내장 | Integrado | Integriert |
| **Local** (mode source) | 本地 | 本地 | ローカル | 로컬 | Local | Lokal |
| **Settings** | 设置 | 設定 | 設定 | 설정 | Ajustes | Einstellungen |
| **Marketplace / Gallery** | 模式画廊 | 模式畫廊 | モードギャラリー | 모드 갤러리 | Galería de modos | Modus-Galerie |
| **Quick Start** | 快速开始 | 快速開始 | クイックスタート | 빠른 시작 | Inicio rápido | Schnellstart |
| **Recent** | 最近 | 最近 | 最近 | 최근 | Recientes | Zuletzt |
| **Running** | 运行中 | 執行中 | 実行中 | 실행 중 | En ejecución | Läuft |
| **Idle** | 空闲 | 閒置 | 待機中 | 대기 중 | Inactivo | Inaktiv |
| **Editing / View** (states) | 编辑 / 查看 | 編輯 / 檢視 | 編集 / 表示 | 편집 / 보기 | Editar / Ver | Bearbeiten / Anzeigen |
| **Editor** (panel) | 编辑器 | 編輯器 | エディタ | 에디터 | Editor | Editor |
| **Chat** | 对话 | 對話 | チャット | 대화 | Chat | Chat |
| **Terminal** | 终端 | 終端 | ターミナル | 터미널 | Terminal | Terminal |
| **Processes** | 进程 | 處理程序 | プロセス | 프로세스 | Procesos | Prozesse |
| **Schedules** | 定时任务 | 排程 | スケジュール | 스케줄 | Programaciones | Zeitpläne |
| **Context** | 上下文 | 上下文 | コンテキスト | 컨텍스트 | Contexto | Kontext |
| **Atlas** (project briefing) | 项目纵览 | 專案總覽 | プロジェクト概観 | 프로젝트 아틀라스 | Atlas del proyecto | Projekt-Atlas |
| **Discovery** (project onboarding) | 项目探索 | 專案探索 | プロジェクト発見 | 프로젝트 디스커버리 | Descubrimiento | Erkundung |
| **Onboard** | 初识 | 初識 | オンボーディング | 온보딩 | Iniciación | Einrichtung |
| **Apply** (proposal / diff) | 应用 | 套用 | 適用 | 적용 | Aplicar | Anwenden |
| **Pin / Unpin** | 收藏 / 取消收藏 | 收藏 / 取消收藏 | お気に入り / 解除 | 즐겨찾기 / 해제 | Fijar / Desfijar | Anheften / Lösen |
| **Favorites** | 收藏 | 收藏 | お気に入り | 즐겨찾기 | Favoritos | Favoriten |
| **Sync** | 同步 | 同步 | 同期 | 동기화 | Sincronizar | Synchronisieren |
| **Push** (to git) | 推送 | 推送 | プッシュ | 푸시 | Subir | Push |
| **Activate / Deactivate** | 启用 / 停用 | 啟用 / 停用 | 有効化 / 無効化 | 활성화 / 비활성화 | Activar / Desactivar | Aktivieren / Deaktivieren |
| **Refine** (session meta) | 精修 | 精修 | リファイン | 다듬기 | Refinar | Verfeinern |
| **Confirm switch** (handoff) | 确认切换 | 確認切換 | 切り替えを確定 | 전환 확인 | Confirmar cambio | Wechsel bestätigen |
| **Permission mode** | 权限模式 | 權限模式 | 権限モード | 권한 모드 | Modo de permiso | Berechtigungsmodus |
| **Tool use** (agent block) | 工具调用 | 工具呼叫 | ツール使用 | 도구 사용 | Uso de herramienta | Tool-Nutzung |

### Mode display names

Mode internal names (`webcraft`, `slide`, `doc`, …) stay as English keys.
Display names follow the table below. Proper-noun modes (Kami, Remotion,
ClipCraft, GridBoard, Mode Maker, Webcraft) stay English in every locale.

| Mode | zh-CN | zh-TW | ja | ko | es | de |
| --- | --- | --- | --- | --- | --- | --- |
| **slide** | 幻灯片 | 投影片 | スライド | 슬라이드 | Diapositivas | Folien |
| **doc** | 文档 | 文件 | ドキュメント | 문서 | Documento | Dokument |
| **draw** | 绘画 | 繪畫 | お絵かき | 그리기 | Dibujar | Zeichnen |
| **diagram** | 图表 | 圖表 | ダイアグラム | 다이어그램 | Diagrama | Diagramm |
| **illustrate** | 插画 | 插畫 | イラスト | 일러스트 | Ilustración | Illustration |
| **webcraft** | Webcraft | Webcraft | Webcraft | Webcraft | Webcraft | Webcraft |
| **remotion** | Remotion | Remotion | Remotion | Remotion | Remotion | Remotion |
| **kami** | Kami | Kami | Kami | Kami | Kami | Kami |
| **gridboard** | GridBoard | GridBoard | GridBoard | GridBoard | GridBoard | GridBoard |
| **clipcraft** | ClipCraft | ClipCraft | ClipCraft | ClipCraft | ClipCraft | ClipCraft |
| **mode-maker** | Mode Maker | Mode Maker | Mode Maker | Mode Maker | Mode Maker | Mode Maker |
| **evolve** | 演化 | 演化 | エボルブ | 진화 | Evolución | Weiterentwicklung |

---

## 3. Per-locale style notes

### 3.1 zh-CN (简体中文)

- **Punctuation**: full-width inside CJK runs — `，。？！：；（）「」` — and
  ASCII inside code spans, `{{placeholder}}`, file paths, URLs. Do not put a
  space between CJK characters and a `{{var}}` placeholder.
- **No space** between CJK and Latin letters/numbers — only insert a space if
  Latin text reads adjacent to other Latin text. (E.g. `已保存 v3.8.0` — space
  before the version because `v3.8.0` is Latin; `共 24 个会话` — spaces because
  `24` is Latin.)
- **Avoid 的 stacking**: drop the second 的 if the sentence is still
  unambiguous. `用户的项目的会话` → `用户项目的会话`.
- **Buttons**: 2 characters where natural — 保存 / 取消 / 删除 / 关闭 / 启动 /
  停止 / 重命名 / 刷新. Verb-first.
- **Loading / progress**: `加载中…` `保存中…` `同步中…` — use the Unicode
  ellipsis `…` (single character), never three dots.
- **Status messages**: terse declarative — `已保存。` `分享失败。` not `分享
  操作已失败。`
- **Pneuma-internal anchors**: 模式 / 视图 / 智能体 / 后端 / 技能. Pick these
  even when 模型 / 渲染器 / 助手 / 引擎 / 能力 would also fit — consistency
  matters more than micro-fit.
- **Evolution → 演化**, not 进化. Pneuma uses "evolution" to mean *augmenting
  a skill from session history* — closer to the biological sense of adaptive
  refinement than 进化's progress-implication.
- **Handoff → 接力**, not 交接. "Handoff" in Pneuma is one agent passing the
  baton to another mode; 接力 (relay) captures the motion + collaborative
  continuation. 交接 reads more like a one-time job handover.
- **Library → 模式合集** (not 模式库): 模式库 collides with "model library"
  and reads warehouse-flavored; 合集 (collection) signals a curated bundle.

### 3.2 zh-TW (繁體中文)

Base everything on the zh-CN translations after applying these adjustments —
**do not OpenCC the zh-CN file**, do this by reading meaning.

- Traditional Chinese characters throughout: 啟動 (not 启动), 軟體 (not 软件),
  設定 (not 设置), 載入 (not 加载), 檔案 (not 文件 — but only for "file";
  "document" → 文件 as in zh-CN), 連結 (not 链接), 視訊 (not 视频), 滑鼠 (not
  鼠标).
- **Taiwan vocabulary** where it differs from mainland: 程式 not 程序, 應用
  程式 not 应用, 專案 not 项目, 影片 not 视频, 路徑 not 路径 (same chars),
  排程 not 定时任务, 顯示 not 显示 (same).
- **Punctuation**: same full-width rules as zh-CN.
- **Don't import zh-CN's loanword choices wholesale** — Taiwan typically keeps
  more English loanwords in tech writing. E.g. "plugin" → 外掛 (not 插件) in
  zh-TW.

### 3.3 ja (日本語)

ja is the **existing baseline** in this codebase. **Do not refresh** ja in
this round — leave the current translations untouched. The glossary above
documents the anchor terms so future ja edits stay aligned.

### 3.4 ko (한국어)

- **Hangul only** — no hanja (한자) for tech terms in UI strings.
- **Tech loanwords are standard**: 모드 / 뷰어 / 에이전트 / 백엔드 /
  워크스페이스 / 프로젝트 / 세션 / 런처 / 스킬 — use these rather than native
  Korean coinages.
- **Buttons**: drop the `-기` nominalizer — 저장 (not 저장하기), 취소 (not
  취소하기), 삭제 (not 삭제하기), 닫기 (close — the `-기` is fine here because
  there's no clean 2-char form).
- **Sentence endings**: declarative `-습니다 / -ㅂ니다` for status messages
  ("저장되었습니다.", "공유에 실패했습니다."), `-세요` for instructions and
  empty-state prompts ("프로젝트를 만들어 보세요.").
- **Spacing**: insert a space between native Korean nouns and loanwords:
  `프로젝트 세션`, `최근 프로젝트`. Don't insert a space inside a single
  loanword compound: `워크스페이스` (one word).
- **"…" ellipsis**: use `...` (three ASCII dots) — Korean UI conventionally
  uses ASCII dots, not the Unicode `…`. Exception: in copy that already uses
  `…`, keep it; don't fight existing aesthetics.

### 3.5 es (Español)

Use **neutral Latin-American Spanish** — readable across Spain and the
Americas. Avoid regionalisms (Mexican coloquialismos, Argentine voseo, Iberian
vosotros).

- **Buttons**: imperative-style infinitive — Guardar, Cancelar, Eliminar,
  Cerrar, Abrir, Crear, Añadir, Buscar, Compartir, Exportar, Importar.
- **Tooltips**: short noun phrase or imperative — "Buscar sesiones",
  "Configuración de la app".
- **Status messages**: present-perfect / past — "Copiado", "Guardando…",
  "Falló la sincronización".
- **No formal usted**: use the implicit subject ("Guardar") or imperative
  ("Selecciona un modo"). Don't use "Usted seleccione…" — too stiff.
- **Diacritics**: never drop ñ, á, é, í, ó, ú, ¿, ¡. UI looks unprofessional
  without them.
- **Anglicisms**: only where Spanish has no widely-adopted alternative —
  `plugin`, `backend`, `Pneuma`. Use Spanish where one exists: `vista` for
  view, `permiso` for permission, `ajustes` for settings.
- **Sentence-initial inverted marks**: `¿Confirmar?`, `¡Listo!`.

### 3.6 de (Deutsch)

- **Capitalize all nouns**: Sitzung, Arbeitsbereich, Projekt, Modus, Modi.
- **Buttons**: infinitive — Speichern, Abbrechen, Löschen, Schließen, Öffnen,
  Erstellen, Hinzufügen, Suchen, Teilen, Exportieren, Importieren.
- **Status messages**: passive or impersonal — "Gespeichert.", "Wird
  geladen…", "Synchronisierung fehlgeschlagen."
- **Compound nouns preferred over phrases**: `Arbeitsbereich` (not "Arbeits
  Bereich"), `Sitzungstitel` (not "Sitzung Titel"), `Modusgalerie` (not "Modus
  Galerie"), `Modusmanifest`. German strongly prefers compounds.
- **Umlauts and ß**: never drop them. `Größe`, `Schließen`, `für`,
  `überprüfen`.
- **Avoid translating proper nouns**: Backends keep their names — Claude
  Code, Codex, Kimi. Mode names stay English (Webcraft, Kami, …).
- **No "Sie/du" addressing in buttons or tooltips**: just use infinitive or
  noun. Status messages can be impersonal ("Verbindung getrennt"), no need to
  pick a politeness register.

---

## 4. Format conventions

Apply to every locale.

- **`{{var}}` placeholders**: preserve verbatim. The variable name is a
  developer artifact — never translate it. Treat as a noun-shaped slot. The
  surrounding sentence must read naturally with whatever value lands there;
  if it can't, restructure the sentence (don't translate the placeholder).
- **`{{var, count}}` and `{{count}}` with plurals**: each locale's JSON may
  include `_one` / `_other` siblings (e.g. `inactive_one`, `inactive_other` in
  `launcher.json`). Keep the same key names — i18next routes plurals by key
  suffix. Provide locale-appropriate plural rules:
  - zh-CN / zh-TW / ja / ko: only `_other`-style is needed since CJK doesn't
    inflect for number, but keep both keys with the **same** translation so
    parity tests pass.
  - es: `_one` for 1 (singular), `_other` for 0 and 2+.
  - de: `_one` for 1 (`1 inaktiver Modus`), `_other` for 0 and 2+
    (`{{count}} inaktive Modi` — note adjective ending changes).
- **HTML tags inside strings** (`<bold>{{username}}</bold>`,
  `<code>github:user/repo</code>`): translate the inner text, keep the tags
  byte-identical.
- **Ellipsis**: use `…` (U+2026) in en/zh-CN/zh-TW/ja/es/de — matches the
  existing English source. In ko, follow §3.4 (ASCII `...`).
- **Punctuation after placeholders**: in CJK runs, no space between `}}` and
  the next CJK char. In Latin runs, follow normal spacing rules.
- **Path strings, version numbers, env-var names**: never translate
  (`~/.pneuma/sessions.json`, `v3.8.0`, `PNEUMA_SERVER_URL`).
- **Quoted English flag names**: leave English (`--workspace`, `--debug`)
  and quote with the locale's natural quotes (`「」` for CJK, `« »` for
  French, `„ "` for German — though for German UI we typically use straight
  quotes `"…"` since it's a software UI, not literary text).
- **File-list placeholders** like `<workspace>`, `<id>`, `<mode>`: leave as
  English angle-bracketed placeholders. They're CLI argument syntax, not prose.

---

## 5. Tone matrix

| Surface | Tone | Examples (en → suggested feel) |
| --- | --- | --- |
| Buttons | Imperative, terse, 1–3 words | "Save" → terse verb |
| Tooltips | Short declarative, ≤8 words | "Refresh from source" → short hint |
| Errors | Direct, no apologizing, no "Oops" | "Sync failed" → "同步失败" not "啊呀，同步好像出错了" |
| Empty states | Inviting, instructional, one sentence | "No projects yet." → "暂无项目，点击 + 创建一个。" |
| Status (success) | Celebratory but terse | "Shared successfully!" → "分享成功！" |
| Onboarding copy | Warm, conversational | A bit longer; product voice |
| Description fields (mode manifest) | Calm, technical, no marketing-speak | "HTML presentations with content sets" |

**Avoid**:
- Marketing buzzwords (powerful, beautiful, seamless, intuitive). Pneuma is a
  tool — describe what it does, not how amazing it is.
- Emoji in any UI string. Existing English source has none; do not introduce.
- "Please" / "你好" softeners on buttons. `Save`, not `Please save`.
- Trailing exclamation marks on neutral status. `Loaded.` not `Loaded!`.
  Reserve `!` for explicit success states ("Shared successfully!").

---

## 6. Workflow for subagents

You are translating **one locale**. Your inputs:

1. This document (read fully first).
2. `src/i18n/locales/en/*.json` — 36 namespace files, source of truth.
3. A pre-scaffolded `src/i18n/locales/<your-locale>/` directory containing
   English placeholders for every file. (For `zh-CN`, the existing translations
   are already there — overwrite them.)

Your task:

1. For each namespace JSON, rewrite the values for your locale.
2. Keys (left of `:`) **never change**. Nesting structure **never changes**.
   Locale parity tests assert identical key trees. If en has a `_one`/`_other`
   plural pair, keep both keys in your locale.
3. Keep `{{var}}` placeholders, HTML tags, and structural punctuation
   verbatim.
4. Reach for the glossary every time a core concept appears. Don't invent a
   second translation for an already-anchored term.
5. When in doubt between two phrasings, pick the **shorter** one for buttons
   and the **clearer** one for tooltips/errors.

After finishing all 36 files, list any English source strings you found
ambiguous — that's signal for the next iteration of this guide.

---

## 7. What's deliberately *not* covered

- CLI help text formatting (`cli.json`'s `pneuma.help`): translate the prose
  paragraphs, but keep the column-aligned flag table in its English structure
  (just translate the descriptions). Don't try to realign columns by hand;
  the user reads this through a terminal and asymmetry is fine.
- Backend descriptions (`launcher.json`'s `backends.*.description`): these
  are short technical phrases ("Anthropic Claude Code CLI via stdio
  stream-json transport"). Translate carefully but keep technical terms
  (`stdio`, `stream-json`, `app-server`) untranslated — they're protocol
  names.
- Code identifiers in error messages (`PNEUMA_SERVER_URL`,
  `.pneuma/session.json`): always keep English.
- `pneuma:env` / `pneuma:request-handoff` and other XML-style tags that
  appear in some skill descriptions: untouched, they're agent protocol.
