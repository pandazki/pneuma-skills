/**
 * ELI5 Mode Manifest — pure data, no React deps.
 * Safely imported by both backend (pneuma.ts) and frontend (pneuma-mode.ts).
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";
import { loadExplainer, saveExplainer } from "./domain.js";

const eli5Manifest: ModeManifest = {
  name: "eli5",
  version: "0.1.0",
  // A brand-name acronym — it reads the same in every locale, so only the
  // description below is localized.
  displayName: {
    en: "ELI5",
    "zh-CN": "ELI5",
    "zh-TW": "ELI5",
    ja: "ELI5",
    ko: "ELI5",
    es: "ELI5",
    de: "ELI5",
  },
  description: {
    en: "Explain anything to anyone — one topic, tailored explainer pages for every audience: kids, managers, engineers, parents",
    "zh-CN":
      "把任何东西讲给任何人听——同一个主题，为每类受众各写一页量身定制的讲解：孩子、经理、工程师、爸妈",
    "zh-TW":
      "把任何東西講給任何人聽——同一個主題，為每種受眾各寫一頁量身打造的講解：孩子、主管、工程師、爸媽",
    ja: "どんなことでも、相手に合わせて説明する——ひとつのトピックを、子ども・マネージャー・エンジニア・家族それぞれの言葉で書き分けた解説ページに",
    ko: "무엇이든 누구에게나 설명 — 하나의 주제를 아이, 관리자, 엔지니어, 부모님까지 대상마다 맞춰 쓴 설명 페이지로",
    es: "Explica cualquier cosa a cualquiera: un mismo tema con una página de explicación a medida para cada público — niños, jefes, ingenieros, familia",
    de: "Alles für jeden erklären — ein Thema, für jedes Publikum eine eigens geschriebene Erklärseite: Kinder, Führungskräfte, Entwickler, Eltern",
  },
  // A speech bubble with a lightbulb inside it — explaining, plus the
  // moment it lands. Two stroke paths, lucide register.
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H12l-4.5 3.75V15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5Z"/><path d="M12 4.5a2.75 2.75 0 0 0-1.65 4.95c.34.26.55.65.55 1.08v.22h2.2v-.22c0-.43.21-.82.55-1.08A2.75 2.75 0 0 0 12 4.5ZM10.9 12.8h2.2"/></svg>`,

  skill: {
    sourceDir: "skill",
    installName: "pneuma-eli5",
    mdScene: `You and the user are explaining one thing to several different people at once inside Pneuma. The user brings a topic — a concept, a piece of code, an error message, a document — and you write it out once per audience: a self-contained HTML page whose vocabulary, analogies, pacing, and visual register match whoever is reading it, from a five-year-old to the engineer on call. The panel plays those pages as an audience ladder the user can climb rung by rung or compare two rungs side by side; you shape it by writing \`<topic>/manifest.json\` and \`<topic>/pages/<audience>.html\`, and the ladder re-renders as those files change.`,
    envMapping: {
      OPENROUTER_API_KEY: "openrouterApiKey",
      FAL_KEY: "falApiKey",
    },
    sharedScripts: ["generate_image.mjs"],
  },

  viewer: {
    watchPatterns: [
      "**/pages/*.html",
      "**/manifest.json",
      "**/assets/**/*",
    ],
    ignorePatterns: [],
    serveDir: ".",
  },

  sources: {
    // The explainer as a domain object: every content set's manifest,
    // parsed into an audience ladder. Binaries stay out of the aggregate
    // (slide's precedent) — they arrive through `files` below.
    explainer: {
      kind: "aggregate-file",
      config: {
        patterns: ["**/pages/*.html", "**/manifest.json"],
        load: loadExplainer,
        save: saveExplainer,
      },
    },
    // Companion file-glob for raw content reads. `explainer` exposes the
    // structure (titles, ladder order, audience labels); this exposes the
    // page HTML the iframe renders and the assets those pages reference.
    files: {
      kind: "file-glob",
      config: {
        patterns: [
          "**/pages/*.html",
          "**/manifest.json",
          "**/assets/**/*",
        ],
      },
    },
  },

  agent: {
    permissionMode: "bypassPermissions",
    greeting: `<system-info pneuma-mode="Pneuma ELI5 Mode" skill="pneuma-eli5" session="new"></system-info>
The user just opened the workspace. You are ready to explain anything to anyone. Greet the user briefly (1-2 sentences) and invite them to name a topic and who it needs to land with.`,
  },

  viewerApi: {
    workspace: {
      type: "manifest",
      multiFile: true,
      ordered: true,
      hasActiveFile: true,
      manifestFile: "manifest.json",
      supportsContentSets: true,
    },
    actions: [
      {
        id: "navigate-to",
        label: "Go to Audience",
        category: "navigate",
        agentInvocable: true,
        params: {
          address: {
            type: "object",
            description:
              'ViewerAddress for the target rung, e.g. `{ audience: "manager" }`. Add `contentSet` to move to a different topic, and `anchor` (element id or CSS selector) to land on a specific spot inside the page.',
            required: true,
          },
        },
        description:
          "Move the audience ladder to one audience's page. Use it immediately after writing or editing that page, so the user is looking at the version you just changed instead of hunting for it.",
      },
    ],
  },

  init: {
    contentCheckPattern: "**/pages/*.html",
    // key = source path relative to the project root (builtin modes),
    // value = destination relative to the workspace.
    seedFiles: {
      "modes/eli5/seed/database-index/": "database-index/",
      "modes/eli5/seed/how-llms-work/": "how-llms-work/",
    },
    seeds: [
      {
        id: "database-index",
        sourceKey: "modes/eli5/seed/database-index/",
        displayName: {
          en: "What is a database index?",
          "zh-CN": "数据库索引是什么？",
          "zh-TW": "資料庫索引是什麼？",
          ja: "データベースのインデックスとは？",
          ko: "데이터베이스 인덱스란?",
          es: "¿Qué es un índice de base de datos?",
          de: "Was ist ein Datenbankindex?",
        },
        description: {
          en: "One familiar idea, three rungs: a five-year-old, a manager, an engineer. Watch the register shift while the facts stay the same.",
          "zh-CN":
            "同一个熟悉的概念，三级台阶：五岁孩子、经理、工程师。事实一个字没变，说法完全换了一副样子。",
          "zh-TW":
            "同一個熟悉的概念，三層階梯：五歲孩子、主管、工程師。事實一個字沒變，說法卻整個換了模樣。",
          ja: "身近な題材をひとつ、三段の階段で。5 歳・マネージャー・エンジニア——中身は同じまま、語り口だけが変わります。",
          ko: "익숙한 개념 하나를 세 단계로. 다섯 살, 관리자, 엔지니어 — 사실은 그대로인데 말투만 달라집니다.",
          es: "Una idea familiar en tres peldaños: un niño de cinco años, un jefe, un ingeniero. Los hechos no cambian; el registro sí.",
          de: "Eine vertraute Idee auf drei Stufen: fünfjähriges Kind, Führungskraft, Entwickler. Die Fakten bleiben, der Ton wechselt.",
        },
        tags: ["English", "3 audiences"],
      },
      {
        id: "how-llms-work",
        sourceKey: "modes/eli5/seed/how-llms-work/",
        displayName: {
          en: "How do large language models work?",
          "zh-CN": "大语言模型是怎么工作的？",
          "zh-TW": "大型語言模型是怎麼運作的？",
          ja: "大規模言語モデルはどう動いているのか？",
          ko: "거대 언어 모델은 어떻게 작동할까?",
          es: "¿Cómo funcionan los modelos de lenguaje?",
          de: "Wie funktionieren große Sprachmodelle?",
        },
        description: {
          en: "The same ladder in Chinese — an eight-year-old, a product manager, an engineer — for the question everyone gets asked at dinner.",
          "zh-CN":
            "同样的台阶，中文写就：8 岁孩子、产品经理、工程师——正好是饭桌上最常被问到的那个问题。",
          "zh-TW":
            "同樣的階梯，中文寫成：8 歲孩子、產品經理、工程師——剛好是飯桌上最常被問到的那個問題。",
          ja: "同じ階段を中国語で。8 歳の子ども・プロダクトマネージャー・エンジニア——食卓でいちばん聞かれる質問です。",
          ko: "같은 사다리를 중국어로. 여덟 살 아이, 프로덕트 매니저, 엔지니어 — 밥상에서 가장 자주 나오는 질문입니다.",
          es: "La misma escalera, en chino: un niño de ocho años, un product manager, un ingeniero — la pregunta que todos reciben en la cena.",
          de: "Dieselbe Leiter auf Chinesisch: achtjähriges Kind, Product Manager, Entwickler — die Frage, die am Esstisch immer kommt.",
        },
        tags: ["中文", "3 audiences"],
      },
    ],
    params: [
      {
        name: "openrouterApiKey",
        label: "OpenRouter API Key",
        description: "for AI image generation, leave blank to skip",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
      {
        name: "falApiKey",
        label: "fal.ai API Key",
        description: "for AI image generation, leave blank to skip",
        type: "string",
        defaultValue: "",
        sensitive: true,
      },
    ],
    deriveParams: (params) => ({
      ...params,
      imageGenEnabled: (params.openrouterApiKey || params.falApiKey) ? "true" : "",
    }),
  },

  evolution: {
    directive: `Learn who this user explains things to. From the session history, extract the audiences that recur
(the specific people and roles they keep writing for), the analogy domains they reach for and the ones they
avoid, the language they write in and when they switch, how long their pages run and what visual register each
audience gets, and the subject areas their topics cluster in. Augment the skill so future
explainers default to those audiences, those analogies, that language, and those page proportions — while
always following the user's explicit instructions for the explainer in front of them.`,
  },

  inspiredBy: {
    name: "DreambigOu/ELI5",
    url: "https://github.com/DreambigOu/ELI5",
  },
};

export default eli5Manifest;
