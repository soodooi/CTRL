import { z } from 'zod';

// 工具类型定义
export const ToolType = z.enum([
  'http',
  'cli',
  'mcp',
  'webview',
  'declarative',
]);

// 输入输出类型
export const InputOutputType = z.enum([
  'text',
  'json',
  'file',
  'image',
  'audio',
  'video',
]);

// 配置参数定义
export const ConfigParamSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'password']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.any().optional(),
});

// 权限定义
export const PermissionSchema = z.enum([
  'network',
  'filesystem',
  'clipboard',
  'keychain',
  'notifications',
  'camera',
  'microphone',
  'location',
]);

// 资源限制
export const ResourceLimitsSchema = z.object({
  memory_mb: z.number().min(1).max(4096).optional(),
  cpu_percent: z.number().min(1).max(100).optional(),
  network_mbps: z.number().min(0.1).max(100).optional(),
  timeout_seconds: z.number().min(1).max(3600).optional(),
});

// 启动策略
export const StartupPolicySchema = z.enum([
  'on_demand',    // 按需启动
  'lazy',         // 延迟启动
  'preload',      // 预加载
  'resident',     // 常驻运行
]);

// 工具manifest主schema
export const ToolManifestSchema = z.object({
  // 基本信息
  id: z.string().regex(/^[a-z0-9.-]+$/, 'ID必须符合域名格式，如com.example.tool-name'),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号必须符合semver格式'),
  description: z.string().optional(),
  
  // 工具类型和配置
  type: ToolType,
  config: z.record(z.string(), ConfigParamSchema).optional(),
  
  // 输入输出定义
  input: z.object({
    type: InputOutputType,
    description: z.string().optional(),
    schema: z.any().optional(), // JSON Schema for validation
  }).optional(),
  
  output: z.object({
    type: InputOutputType,
    description: z.string().optional(),
    schema: z.any().optional(), // JSON Schema for validation
  }).optional(),
  
  // 运行时配置
  startup_policy: StartupPolicySchema.default('on_demand'),
  resource_limits: ResourceLimitsSchema.optional(),
  
  // 权限声明
  permissions: z.array(PermissionSchema).default([]),
  
  // 依赖声明
  dependencies: z.array(z.string()).default([]),
  
  // 元数据
  author: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }).optional(),
  
  repository: z.string().url().optional(),
  license: z.string().optional(),
  
  // 扩展配置（根据工具类型）
  extensions: z.record(z.string(), z.any()).optional(),
});

// 类型导出
export type ToolType = z.infer<typeof ToolType>;
export type InputOutputType = z.infer<typeof InputOutputType>;
export type ConfigParam = z.infer<typeof ConfigParamSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export type StartupPolicy = z.infer<typeof StartupPolicySchema>;
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

// HTTP工具扩展配置
export const HttpToolExtensionSchema = z.object({
  endpoint: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout_ms: z.number().min(100).max(30000).optional(),
  retry: z.object({
    attempts: z.number().min(0).max(5).optional(),
    delay_ms: z.number().min(100).max(5000).optional(),
  }).optional(),
});

export type HttpToolExtension = z.infer<typeof HttpToolExtensionSchema>;

// CLI工具扩展配置
export const CliToolExtensionSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  working_dir: z.string().optional(),
  shell: z.boolean().default(false),
});

export type CliToolExtension = z.infer<typeof CliToolExtensionSchema>;

// MCP工具扩展配置
export const McpToolExtensionSchema = z.object({
  server: z.string(),
  config: z.record(z.string(), z.any()),
  tools: z.array(z.string()).optional(),
});

export type McpToolExtension = z.infer<typeof McpToolExtensionSchema>;

// WebView工具扩展配置
export const WebViewToolExtensionSchema = z.object({
  url: z.string().url(),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(2160).optional(),
  features: z.record(z.string(), z.any()).optional(),
});

export type WebViewToolExtension = z.infer<typeof WebViewToolExtensionSchema>;

// 完整的工具manifest（包含扩展）
export const CompleteToolManifestSchema = ToolManifestSchema.extend({
  extensions: z.object({
    http: HttpToolExtensionSchema.optional(),
    cli: CliToolExtensionSchema.optional(),
    mcp: McpToolExtensionSchema.optional(),
    webview: WebViewToolExtensionSchema.optional(),
  }).optional(),
});

export type CompleteToolManifest = z.infer<typeof CompleteToolManifestSchema>;

// 工具运行结果
export const ToolResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
  metadata: z.object({
    execution_time_ms: z.number(),
    resource_usage: ResourceLimitsSchema.optional(),
  }).optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// 工具运行选项
export const ToolRunOptionsSchema = z.object({
  input: z.any().optional(),
  config: z.record(z.string(), z.any()).optional(),
  timeout_ms: z.number().optional(),
  resource_limits: ResourceLimitsSchema.optional(),
});

export type ToolRunOptions = z.infer<typeof ToolRunOptionsSchema>;