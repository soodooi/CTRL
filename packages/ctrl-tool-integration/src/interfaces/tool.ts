import { 
  ToolManifest, 
  ToolResult, 
  ToolRunOptions,
  ResourceLimits,
  StartupPolicy,
  ResourceUsage as SchemaResourceUsage
} from '../schemas/tool-manifest';

/**
 * 工具接口定义
 */
export interface ITool {
  // 基本信息
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: ToolManifest;
  
  // 状态管理
  isInstalled(): Promise<boolean>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  
  // 生命周期管理
  getStatus(): Promise<ToolStatus>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  
  // 运行工具
  run(options: ToolRunOptions): Promise<ToolResult>;
  
  // 配置管理
  getConfig(): Promise<Record<string, any>>;
  updateConfig(config: Record<string, any>): Promise<void>;
  validateConfig(config: Record<string, any>): Promise<boolean>;
  
  // 资源管理
  getResourceUsage(): Promise<ResourceUsage>;
  setResourceLimits(limits: ResourceLimits): Promise<void>;
}

/**
 * 工具状态
 */
export interface ToolStatus {
  installed: boolean;
  running: boolean;
  lastRunTime?: Date;
  lastError?: string;
  startupPolicy: StartupPolicy;
  resourceLimits: ResourceLimits;
}

/**
 * 资源使用情况
 */
export interface ResourceUsage extends SchemaResourceUsage {}

/**
 * 工具事件
 */
export interface ToolEvent {
  type: ToolEventType;
  toolId: string;
  timestamp: Date;
  data?: any;
}

export type ToolEventType = 
  | 'installed'
  | 'uninstalled'
  | 'started'
  | 'stopped'
  | 'running'
  | 'error'
  | 'config_updated'
  | 'resource_limit_exceeded';

/**
 * 工具工厂接口
 */
export interface IToolFactory {
  createTool(manifest: ToolManifest): Promise<ITool>;
  supportsType(toolType: string): boolean;
}

/**
 * 工具注册表接口
 */
export interface IToolRegistry {
  // 工具管理
  registerTool(tool: ITool): Promise<void>;
  unregisterTool(toolId: string): Promise<void>;
  getTool(toolId: string): Promise<ITool | null>;
  listTools(): Promise<ITool[]>;
  
  // 工具发现
  discoverTools(directory: string): Promise<ITool[]>;
  loadToolFromManifest(manifestPath: string): Promise<ITool>;
  
  // 事件管理
  on(event: ToolEventType, listener: (event: ToolEvent) => void): void;
  off(event: ToolEventType, listener: (event: ToolEvent) => void): void;
  emit(event: ToolEvent): void;
  
  // 批量操作
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  installAll(): Promise<void>;
  uninstallAll(): Promise<void>;
}

/**
 * 工具运行器接口
 */
export interface IToolRunner {
  // 运行管理
  runTool(toolId: string, options: ToolRunOptions): Promise<ToolResult>;
  cancelRun(toolId: string): Promise<void>;
  
  // 运行状态
  getRunningTools(): Promise<RunningTool[]>;
  getToolRunHistory(toolId: string, limit?: number): Promise<ToolRunHistory[]>;
  
  // 资源管理
  getTotalResourceUsage(): Promise<ResourceUsage>;
  setGlobalResourceLimits(limits: ResourceLimits): Promise<void>;
}

/**
 * 运行中的工具信息
 */
export interface RunningTool {
  toolId: string;
  startTime: Date;
  options: ToolRunOptions;
  resourceUsage: ResourceUsage;
}

/**
 * 工具运行历史
 */
export interface ToolRunHistory {
  toolId: string;
  startTime: Date;
  endTime: Date;
  success: boolean;
  result?: any;
  error?: string;
  resourceUsage: ResourceUsage;
}

/**
 * 工具沙箱接口
 */
export interface IToolSandbox {
  // 沙箱管理
  createSandbox(toolId: string, config: SandboxConfig): Promise<SandboxHandle>;
  destroySandbox(handle: SandboxHandle): Promise<void>;
  
  // 资源限制
  setResourceLimits(handle: SandboxHandle, limits: ResourceLimits): Promise<void>;
  getResourceUsage(handle: SandboxHandle): Promise<ResourceUsage>;
  
  // 执行代码
  execute(handle: SandboxHandle, code: string, language: SandboxLanguage): Promise<ExecutionResult>;
  
  // 文件系统访问
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  writeFile(handle: SandboxHandle, path: string, content: string): Promise<void>;
  listFiles(handle: SandboxHandle, directory: string): Promise<string[]>;
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  toolId: string;
  resourceLimits: ResourceLimits;
  allowedApis: string[];
  filesystemAccess: FilesystemAccess;
  networkAccess: NetworkAccess;
}

/**
 * 文件系统访问权限
 */
export interface FilesystemAccess {
  read: string[];  // 允许读取的路径
  write: string[]; // 允许写入的路径
}

/**
 * 网络访问权限
 */
export interface NetworkAccess {
  allowedDomains: string[];
  allowedPorts: number[];
}

/**
 * 沙箱句柄
 */
export type SandboxHandle = string;

/**
 * 沙箱支持的语言
 */
export type SandboxLanguage = 
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'bash'
  | 'powershell';

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  resourceUsage: ResourceUsage;
}

/**
 * 工具市场接口
 */
export interface IToolMarket {
  // 工具发现
  searchTools(query: string, filters?: MarketFilters): Promise<MarketTool[]>;
  getFeaturedTools(): Promise<MarketTool[]>;
  getToolDetails(toolId: string): Promise<MarketToolDetails>;
  
  // 工具安装
  installTool(toolId: string): Promise<ITool>;
  uninstallTool(toolId: string): Promise<void>;
  
  // 用户管理
  getUserTools(): Promise<MarketTool[]>;
  rateTool(toolId: string, rating: number, review?: string): Promise<void>;
  
  // 开发者功能
  publishTool(manifest: ToolManifest): Promise<void>;
  updateTool(toolId: string, manifest: ToolManifest): Promise<void>;
  deleteTool(toolId: string): Promise<void>;
}

/**
 * 市场工具信息
 */
export interface MarketTool {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads: number;
  rating: number;
  tags: string[];
  price?: number;
  license: string;
}

/**
 * 市场工具详情
 */
export interface MarketToolDetails extends MarketTool {
  manifest: ToolManifest;
  changelog: string[];
  dependencies: string[];
  screenshots: string[];
  reviews: ToolReview[];
  installationInstructions: string;
}

/**
 * 工具评价
 */
export interface ToolReview {
  userId: string;
  rating: number;
  review: string;
  date: Date;
}

/**
 * 市场过滤器
 */
export interface MarketFilters {
  category?: string;
  minRating?: number;
  freeOnly?: boolean;
  sortBy?: 'downloads' | 'rating' | 'date' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}