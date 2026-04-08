# Plugin System Design

**Date:** 2026-04-07
**Status:** Draft

## Overview

Introduce a plugin system to Pneuma Skills, primarily around the deploy workflow but extensible to other domains (memory sync, internal tooling). The system enables internal/company-specific plugins without affecting external users, and migrates existing Vercel/CF Pages deployment into builtin plugins.

**Core formula:** `PluginManifest(hooks + slots + routes + settings) × PluginRegistry × SettingsManager`

## Goals

1. **Internal extensibility** — Company-specific deploy plugins can add identity info, tags, notes without modifying core
2. **Builtin dogfooding** — Vercel and CF Pages become builtin plugins, validating the plugin interface
3. **Soft error** — Plugin failures never break the main flow
4. **Zero-code simple plugins** — Declarative form fields + hooks, no React needed
5. **Escape hatch** — Custom React components and Hono routes when declarative isn't enough

## Non-Goals

- Plugin marketplace / discovery (future)
- Workspace-level settings UI (data structure supports it, UI deferred)
- Plugin-to-plugin dependencies
- Sandboxing / security isolation

## Architecture

### Layer Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Plugin Registry                           │
│  discover → filter(settings) → resolve(mode/scope) → load → activate │
├──────────────┬──────────────┬──────────────┬─────────────────────┤
│  Hook Bus    │  Slot Registry│  Route Registry│  Settings Manager │
│  (data layer)│  (UI layer)   │  (service layer)│  (config layer)  │
└──────────────┴──────────────┴──────────────┴─────────────────────┘
```

### Plugin Package Structure

```
plugins/
├── vercel/                        # builtin plugin
│   ├── manifest.ts                # capability declaration
│   ├── hooks/
│   │   ├── provider.ts            # deploy:providers — register as deploy target
│   │   └── deploy.ts              # deploy:before / deploy:after
│   ├── ui/
│   │   └── DeployPanel.tsx        # custom deploy UI (optional)
│   ├── routes/
│   │   └── index.ts               # Hono sub-app: status, binding, deploy endpoints
│   └── index.ts                   # activate/deactivate (optional)
├── cf-pages/                      # builtin plugin
│   └── (same structure)
~/.pneuma/plugins/                 # third-party plugins
├── internal-deploy/
│   ├── manifest.ts
│   └── hooks/
│       └── deploy.ts
```

## Plugin Manifest

```typescript
interface PluginManifest {
  name: string                         // unique id, e.g. "vercel-deploy"
  version: string
  displayName: string
  description: string
  builtin?: boolean                    // true for pre-installed plugins

  // Scope & compatibility
  scope: "global" | "mode"
  compatibleModes?: string[]           // omit = all modes

  // Data layer: Hooks
  hooks?: Record<HookName, string>     // hookName → relative path to handler

  // UI layer: Slots
  slots?: Record<SlotName, SlotDeclaration>

  // Service layer: Routes
  routes?: string                      // relative path to Hono sub-app
  routePrefix?: string                 // default: /api/plugins/{name}

  // Config layer: Settings
  settings?: Record<string, SettingField>

  // Lifecycle (optional)
  activate?: string                    // relative path to activate function
  deactivate?: string                  // relative path to deactivate function
}
```

### SlotDeclaration

```typescript
type SlotDeclaration = string | FormSlotDeclaration

// Custom React component — relative path
// e.g. "./ui/DeployPanel.tsx"

// Declarative form — auto-rendered by built-in FormSlotRenderer
interface FormSlotDeclaration {
  type: "form"
  fields: FormField[]
}

interface FormField {
  name: string
  label: string
  type: "text" | "password" | "select" | "checkbox" | "textarea"
  required?: boolean
  defaultValue?: any
  options?: { label: string; value: string }[]
  placeholder?: string
  description?: string
}
```

### SettingField

```typescript
interface SettingField {
  type: "string" | "password" | "number" | "boolean" | "select"
  label: string
  description?: string
  required?: boolean
  defaultValue?: any
  options?: { label: string; value: string }[]
}
```

## Hook System

### Built-in Hook Points

| Hook | Payload | Purpose |
|------|---------|---------|
| `deploy:providers` | `{ providers: DeployProvider[] }` | Register deploy targets |
| `deploy:before` | `{ files, projectName, metadata, ... }` | Modify deploy payload before execution |
| `deploy:after` | `{ result, provider, ... }` | Post-deploy actions (notify, log) |
| `session:start` | `{ sessionId, mode, workspace }` | Session initialization |
| `session:end` | `{ sessionId, mode, workspace }` | Session cleanup |
| `export:before` | `{ files, format, ... }` | Modify export payload |
| `export:after` | `{ result, format, ... }` | Post-export actions |

### Hook Handler Signature

```typescript
type HookHandler<T = any> = (context: HookContext<T>) => Promise<T | void> | T | void

interface HookContext<T> {
  payload: T
  plugin: { name: string }
  session: SessionInfo
  settings: Record<string, any>   // this plugin's config values
}

interface SessionInfo {
  sessionId: string
  mode: string
  workspace: string
  backendType: string
}
```

### HookBus

```typescript
class HookBus {
  on(hook: HookName, pluginName: string, handler: HookHandler): void
  off(hook: HookName, pluginName: string): void

  // Waterfall execution: payload flows through each handler sequentially
  async emit<T>(hook: HookName, payload: T, session: SessionInfo): Promise<T> {
    let result = payload
    for (const { pluginName, handler } of this.handlers.get(hook) ?? []) {
      try {
        const pluginSettings = this.settingsManager.getPluginConfig(pluginName)
        const returned = await handler({
          payload: result,
          plugin: { name: pluginName },
          session,
          settings: pluginSettings
        })
        if (returned !== undefined) result = returned
      } catch (err) {
        console.warn(`[plugin:${pluginName}] hook ${hook} failed:`, err.message)
        // soft error — continue to next handler
      }
    }
    return result
  }
}
```

## Slot System (UI Injection)

### Built-in Slot Points

| Slot | Location | Purpose |
|------|----------|---------|
| `deploy:provider` | Deploy panel | Register deploy target UI (replaces hardcoded Vercel/CF tabs) |
| `deploy:pre-publish` | Deploy dialog, above publish button | Extra form fields (tags, notes, identity) |
| `deploy:post-result` | Deploy dialog, below result | Post-deploy actions UI |
| `settings:section` | Launcher Settings page | Plugin-specific config section |

### Frontend Integration

```typescript
// New Zustand slice: src/store/plugin-slice.ts
interface PluginSlice {
  activePlugins: LoadedPlugin[]
  slotRegistry: Map<SlotName, SlotEntry[]>
  hookResults: Map<string, any>   // for UI-visible hook results

  loadPlugins(mode: string): Promise<void>
  getSlotComponents(slot: SlotName): SlotEntry[]
}

interface SlotEntry {
  pluginName: string
  component?: React.ComponentType<SlotProps>   // custom component
  form?: FormSlotDeclaration                    // declarative form
  order?: number                                // rendering order
}

// Usage in deploy panel:
function DeployPanel() {
  const providers = usePluginSlots("deploy:provider")
  const prePublish = usePluginSlots("deploy:pre-publish")

  return (
    <>
      <ProviderTabs providers={providers} />
      {prePublish.map(slot => (
        <SlotRenderer key={slot.pluginName} slot={slot} />
      ))}
      <DeployButton />
    </>
  )
}
```

### FormSlotRenderer

Built-in component that auto-renders declarative forms:

```typescript
function FormSlotRenderer({ declaration, onChange }: {
  declaration: FormSlotDeclaration
  onChange: (values: Record<string, any>) => void
}) {
  // Renders form fields based on declaration.fields
  // Uses existing cc-* design tokens for consistent styling
  // Collects values and passes up via onChange
}
```

## Route Extension

Plugin routes are Hono sub-apps, auto-mounted at `/api/plugins/{name}/*`:

```typescript
// plugins/vercel/routes/index.ts
import { Hono } from "hono"
import type { PluginRouteContext } from "@pneuma/plugin"

export default function(ctx: PluginRouteContext) {
  const app = new Hono()

  app.get("/status", async (c) => {
    const config = ctx.settings
    // ... check Vercel CLI / token availability
    return c.json({ available, method, user })
  })

  app.get("/binding", async (c) => {
    const contentSet = c.req.query("contentSet") || "_default"
    const binding = ctx.getDeployBinding()
    return c.json(binding?.vercel?.[contentSet] ?? null)
  })

  app.post("/deploy", async (c) => {
    const body = await c.req.json()
    // ... deploy logic (moved from server/vercel.ts)
    return c.json(result)
  })

  return app
}
```

```typescript
interface PluginRouteContext {
  workspace: string
  session: SessionInfo
  settings: Record<string, any>      // this plugin's config
  getDeployBinding(): DeployBinding   // workspace deploy state
  saveDeployBinding(b: DeployBinding): void
}
```

## Settings System

### Storage

```
~/.pneuma/settings.json
{
  "plugins": {
    "vercel-deploy": {
      "enabled": true,
      "config": {
        "token": "xxx",
        "teamId": "team_abc"
      }
    },
    "cf-pages-deploy": {
      "enabled": true,
      "config": {
        "accountId": "abc123",
        "token": "yyy"
      }
    },
    "internal-deploy": {
      "enabled": true,
      "config": {
        "employeeId": "EMP001",
        "department": "Engineering"
      }
    }
  }
}
```

### Settings Manager

```typescript
class SettingsManager {
  private settingsPath = join(homedir(), ".pneuma", "settings.json")

  getAll(): PluginSettings
  getPluginConfig(name: string): Record<string, any>
  isEnabled(name: string): boolean
  setEnabled(name: string, enabled: boolean): void
  updateConfig(name: string, config: Record<string, any>): void

  // Migration: move existing vercel.json / cloudflare-pages.json into settings.json
  migrateIfNeeded(): void
}
```

### Launcher Settings UI

New "Settings" tab in Launcher (alongside Modes, Sessions):

- List all discovered plugins with enable/disable toggle
- Each plugin expands to show settings form (auto-rendered from manifest.settings)
- Builtin plugins show "(Built-in)" badge
- Plugin source path shown for transparency

## Plugin Registry

### Core Implementation

```typescript
class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map()
  private hookBus: HookBus
  private settingsManager: SettingsManager

  // Phase 1: Discover — scan builtin + ~/.pneuma/plugins/
  async discover(): Promise<PluginManifest[]>

  // Phase 2: Filter — check settings enabled/disabled
  filterEnabled(manifests: PluginManifest[]): PluginManifest[]

  // Phase 3: Resolve — match against current session's mode + scope
  resolveForSession(manifests: PluginManifest[], mode: string): PluginManifest[]

  // Phase 4: Load — dynamic import hooks/slots/routes
  async loadPlugin(manifest: PluginManifest): Promise<LoadedPlugin | null>

  // Phase 5: Activate — call plugin's activate() if present
  async activatePlugin(plugin: LoadedPlugin, session: SessionInfo): Promise<void>

  // Phase 6: Deactivate — cleanup on session end
  async deactivatePlugin(plugin: LoadedPlugin): Promise<void>

  // Mount all plugin routes onto Hono app
  mountRoutes(app: Hono): void

  // Get active slot entries for a given slot name
  getSlotEntries(slot: SlotName): SlotEntry[]
}
```

### Soft Error Strategy

Every boundary is wrapped in try/catch:

1. **Discovery** — unreadable plugin directory → warn, skip
2. **Manifest parse** — invalid manifest → warn, skip plugin
3. **Module import** — missing/broken module → warn, skip that capability
4. **Hook execution** — handler throws → warn, continue waterfall
5. **Slot rendering** — component throws → React error boundary, show empty
6. **Route handling** — handler throws → 500 with plugin name in error, main routes unaffected

## Deploy Flow With Plugins

End-to-end flow showing how hooks, slots, and routes work together:

```
1. User opens deploy panel
   → Frontend calls usePluginSlots("deploy:provider")
   → Each deploy plugin's provider slot renders a tab (Vercel, CF, internal targets)

2. User selects a provider tab, fills in project name
   → deploy:pre-publish slots render below (e.g. internal-deploy's tag/note form)
   → FormSlotRenderer collects values into formValues: { [pluginName]: { field: value } }

3. User clicks Deploy
   → Frontend collects: { files, projectName, provider, formValues }
   → POST /api/deploy (main route, not plugin route)

4. Server receives deploy request
   → hookBus.emit("deploy:before", payload)
     → internal-deploy hook injects metadata from formValues + settings
     → other plugins can modify payload too
   → Server calls the selected provider's deploy route: POST /api/plugins/vercel-deploy/deploy
   → Provider executes deploy, returns result
   → hookBus.emit("deploy:after", { result, provider })
     → plugins can log, notify, etc.

5. Result returned to frontend
   → deploy:post-result slots render (e.g. "View on dashboard" links)
```

The main `/api/deploy` route is a thin orchestrator — it runs hooks and delegates to the provider's plugin route. This keeps the deploy flow unified while each provider is fully encapsulated.

## Builtin Plugin Migration

### Files to Move

| From | To |
|------|-----|
| `server/vercel.ts` | `plugins/vercel/routes/index.ts` + `plugins/vercel/hooks/` |
| `server/cloudflare-pages.ts` | `plugins/cf-pages/routes/index.ts` + `plugins/cf-pages/hooks/` |
| `server/routes/deploy-ui.ts` (provider-specific parts) | Each plugin's `ui/` |
| `server/routes/deploy-ui.ts` (shared deploy shell) | Stays in main, becomes plugin-aware |
| `~/.pneuma/vercel.json` | `~/.pneuma/settings.json` → `plugins.vercel-deploy.config` |
| `~/.pneuma/cloudflare-pages.json` | `~/.pneuma/settings.json` → `plugins.cf-pages-deploy.config` |

### Routes Migration

| Current | After Migration |
|---------|----------------|
| `GET /api/vercel/status` | `GET /api/plugins/vercel-deploy/status` |
| `POST /api/vercel/deploy` | `POST /api/plugins/vercel-deploy/deploy` |
| `GET /api/vercel/binding` | `GET /api/plugins/vercel-deploy/binding` |
| `GET /api/cf-pages/status` | `GET /api/plugins/cf-pages-deploy/status` |
| `POST /api/cf-pages/deploy` | `POST /api/plugins/cf-pages-deploy/deploy` |

### Backward Compatibility

Settings migration runs automatically on first startup after upgrade:
1. Check if `~/.pneuma/vercel.json` exists
2. If yes, read and merge into `~/.pneuma/settings.json` under plugin config
3. Rename old file to `.vercel.json.bak`
4. Same for `cloudflare-pages.json`

## New Files

| Path | Purpose |
|------|---------|
| `core/types/plugin.ts` | PluginManifest, HookName, SlotName, SettingField types |
| `core/plugin-registry.ts` | PluginRegistry class |
| `core/hook-bus.ts` | HookBus class |
| `core/slot-registry.ts` | SlotRegistry class |
| `core/settings-manager.ts` | SettingsManager class |
| `plugins/vercel/manifest.ts` | Vercel plugin manifest |
| `plugins/vercel/routes/index.ts` | Vercel API routes |
| `plugins/vercel/hooks/provider.ts` | deploy:providers hook |
| `plugins/vercel/ui/DeployPanel.tsx` | Vercel deploy UI |
| `plugins/cf-pages/manifest.ts` | CF Pages plugin manifest |
| `plugins/cf-pages/routes/index.ts` | CF Pages API routes |
| `plugins/cf-pages/hooks/provider.ts` | deploy:providers hook |
| `plugins/cf-pages/ui/DeployPanel.tsx` | CF Pages deploy UI |
| `src/store/plugin-slice.ts` | Zustand plugin state slice |
| `src/components/SlotRenderer.tsx` | Slot rendering (form + custom component) |
| `src/components/PluginSettings.tsx` | Launcher Settings plugin management |
| `src/hooks/usePluginSlots.ts` | Slot query hook |

## Example: Internal Deploy Plugin

A minimal company-internal plugin that adds employee info to every deploy:

```
~/.pneuma/plugins/internal-deploy/
├── manifest.ts
└── hooks/
    └── deploy.ts
```

**manifest.ts:**
```typescript
export default {
  name: "internal-deploy",
  version: "1.0.0",
  displayName: "Internal Deploy Metadata",
  description: "Adds employee identity and tags to deployments",
  scope: "global",

  hooks: {
    "deploy:before": "./hooks/deploy.ts"
  },

  slots: {
    "deploy:pre-publish": {
      type: "form",
      fields: [
        { name: "tag", label: "Deploy Tag", type: "select", options: [
          { label: "Production", value: "prod" },
          { label: "Staging", value: "staging" },
          { label: "Preview", value: "preview" }
        ]},
        { name: "note", label: "Deploy Note", type: "textarea", placeholder: "Optional notes..." }
      ]
    }
  },

  settings: {
    employeeId: { type: "string", label: "Employee ID", required: true },
    department: { type: "select", label: "Department", options: [
      { label: "Engineering", value: "eng" },
      { label: "Design", value: "design" },
      { label: "Product", value: "product" }
    ]}
  }
}
```

**hooks/deploy.ts:**
```typescript
export default async function(ctx) {
  const { employeeId, department } = ctx.settings
  const formValues = ctx.payload.formValues?.["internal-deploy"] ?? {}

  return {
    ...ctx.payload,
    metadata: {
      ...ctx.payload.metadata,
      employeeId,
      department,
      tag: formValues.tag,
      note: formValues.note,
      deployedBy: `${employeeId}@${department}`,
      deployedAt: new Date().toISOString()
    }
  }
}
```
