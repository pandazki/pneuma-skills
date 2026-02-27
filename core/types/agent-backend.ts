/**
 * AgentBackend — Agent 通信抽象
 *
 * 以 Claude Code 协议为事实标准。
 * 接口按 Claude Code 的实际能力画出，其他 Agent 通过适配层向此标准靠拢。
 *
 * 分为两个层面：
 * - AgentBackend: 生命周期管理 (launch/resume/kill)
 * - AgentProtocolAdapter: 消息协议适配 (parse/encode)
 *
 * 当前唯一实现: backends/claude-code/
 */

// ── Agent 生命周期 ───────────────────────────────────────────────────────────

/** Agent 会话信息 */
export interface AgentSessionInfo {
  /** Server 路由用 session ID (UUID) */
  sessionId: string;
  /** Agent 内部的 session ID (用于 resume，如 Claude Code 的 --resume) */
  agentSessionId?: string;
  /** 进程 PID (如果是子进程模式) */
  pid?: number;
  /** 会话状态 */
  state: "starting" | "connected" | "running" | "exited";
  /** 退出码 (state=exited 时有值) */
  exitCode?: number | null;
  /** 工作目录 */
  cwd: string;
  /** 创建时间 */
  createdAt: number;
}

/** Agent 启动选项 */
export interface AgentLaunchOptions {
  /** 工作目录 */
  cwd: string;
  /** 权限模式 */
  permissionMode?: string;
  /** 模型 */
  model?: string;
  /** 复用已有的 server session ID (而非生成新的) */
  sessionId?: string;
  /** Agent 内部 session ID (用于恢复之前的会话) */
  resumeSessionId?: string;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

/** Agent 后端 — 管理 Agent 进程的生命周期 */
export interface AgentBackend {
  /** 后端唯一标识 */
  readonly name: string;

  /** 能力声明 */
  readonly capabilities: AgentCapabilities;

  /** 启动一个新的 Agent 会话 */
  launch(options: AgentLaunchOptions): AgentSessionInfo;

  /** 获取会话信息 */
  getSession(sessionId: string): AgentSessionInfo | undefined;

  /** 会话是否存活 */
  isAlive(sessionId: string): boolean;

  /** 标记会话为已连接 (WS 建立时调用) */
  markConnected(sessionId: string): void;

  /** 存储 Agent 内部 session ID (从 Agent 初始化消息中获取) */
  setAgentSessionId(sessionId: string, agentSessionId: string): void;

  /** 终止一个会话 */
  kill(sessionId: string): Promise<boolean>;

  /** 终止所有会话 */
  killAll(): Promise<void>;

  /** 注册退出回调 */
  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void;
}

/** Agent 能力声明 — 描述此 Agent 支持哪些功能 */
export interface AgentCapabilities {
  /** 支持 token 级流式输出 */
  streaming: boolean;
  /** 支持会话恢复 (--resume) */
  resume: boolean;
  /** 支持权限审批流程 (control_request → permission_request) */
  permissions: boolean;
  /** 支持工具执行进度报告 (tool_progress) */
  toolProgress: boolean;
  /** 支持运行时切换模型 */
  modelSwitch: boolean;
}

// ── Agent 协议适配 ───────────────────────────────────────────────────────────

/**
 * 标准消息类型 — ws-bridge 和前端之间的标准格式。
 *
 * 以 Claude Code 的消息类型为事实标准，直接复用 session-types.ts 中的类型。
 * 其他 Agent 的适配层负责将自己的消息格式转为这些标准类型。
 *
 * 注意: v1.0 中不重新定义标准消息格式，直接复用现有的 CLIMessage / BrowserMessage 类型。
 * 理由: 只有一个 Agent 实现时，引入中间层是过度抽象。当第二个 Agent 出现时再提取公共子集。
 */

/**
 * AgentProtocolAdapter — 消息协议适配器
 *
 * 负责将 Agent 的原始消息格式与 ws-bridge 的标准格式互转。
 * v1.0 中 Claude Code 直接使用 NDJSON，adapter 几乎是直通。
 * 未来其他 Agent 需要实现自己的 adapter。
 */
export interface AgentProtocolAdapter {
  /** 将 Agent 发来的原始数据解析为结构化消息 (null = 跳过此消息) */
  parseIncoming(raw: string): unknown | null;

  /** 将标准消息编码为 Agent 可接收的格式 */
  encodeOutgoing(msg: unknown): string;
}
