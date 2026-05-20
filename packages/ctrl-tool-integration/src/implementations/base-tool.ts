import { 
  ITool, 
  ToolStatus, 
  ResourceUsage,
  ToolEvent,
  ToolEventType,
  IToolFactory
} from '../interfaces/tool';
import { 
  ToolManifest, 
  ResourceLimits, 
  StartupPolicy,
  ToolResultSchema,
  ToolRunOptionsSchema,
  ToolResult,
  ToolRunOptions
} from '../schemas/tool-manifest';
import { EventEmitter } from 'events';

/**
 * 基础工具抽象类
 */
export abstract class BaseTool extends EventEmitter implements ITool {
  protected _manifest: ToolManifest;
  protected _status: ToolStatus;
  protected _config: Record<string, any> = {};
  protected _resourceLimits: ResourceLimits = {};
  protected _resourceUsage: ResourceUsage = {
    memory_mb: 0,
    cpu_percent: 0,
    network_mbps: 0,
    uptime_seconds: 0
  };
  
  constructor(manifest: ToolManifest) {
    super();
    this._manifest = manifest;
    this._status = {
      installed: false,
      running: false,
      startupPolicy: manifest.startup_policy,
      resourceLimits: manifest.resource_limits || {}
    };
    this._resourceLimits = manifest.resource_limits || {};
  }
  
  // 基本信息
  get id(): string {
    return this._manifest.id;
  }
  
  get name(): string {
    return this._manifest.name;
  }
  
  get version(): string {
    return this._manifest.version;
  }
  
  get manifest(): ToolManifest {
    return this._manifest;
  }
  
  // 状态管理
  async isInstalled(): Promise<boolean> {
    return this._status.installed;
  }
  
  async install(): Promise<void> {
    try {
      await this.onInstall();
      this._status.installed = true;
      this.emitEvent('installed');
    } catch (error) {
      this.emitEvent('error', { error: error.message });
      throw error;
    }
  }
  
  async uninstall(): Promise<void> {
    try {
      await this.onUninstall();
      this._status.installed = false;
      this._status.running = false;
      this.emitEvent('uninstalled');
    } catch (error) {
      this.emitEvent('error', { error: error.message });
      throw error;
    }
  }
  
  // 生命周期管理
  async getStatus(): Promise<ToolStatus> {
    return { ...this._status };
  }
  
  async start(): Promise<void> {
    if (!this._status.installed) {
      throw new Error(`Tool ${this.id} is not installed`);
    }
    
    if (this._status.running) {
      return; // 已经在运行
    }
    
    try {
      await this.onStart();
      this._status.running = true;
      this._status.lastRunTime = new Date();
      this.emitEvent('started');
    } catch (error) {
      this._status.lastError = error.message;
      this.emitEvent('error', { error: error.message });
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this._status.running) {
      return; // 已经停止
    }
    
    try {
      await this.onStop();
      this._status.running = false;
      this.emitEvent('stopped');
    } catch (error) {
      this.emitEvent('error', { error: error.message });
      throw error;
    }
  }
  
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  
  // 运行工具
  async run(options: ToolRunOptions): Promise<ToolResult> {
    // 验证选项
    const validatedOptions = ToolRunOptionsSchema.parse(options);
    
    // 检查工具状态
    if (!this._status.installed) {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_INSTALLED',
          message: `Tool ${this.id} is not installed`
        }
      };
    }
    
    // 如果需要，启动工具
    if (this._manifest.startup_policy === 'on_demand' && !this._status.running) {
      await this.start();
    }
    
    // 检查资源限制
    const resourceCheck = await this.checkResourceLimits();
    if (!resourceCheck.success) {
      return resourceCheck;
    }
    
    // 运行工具
    const startTime = Date.now();
    try {
      const result = await this.onRun(validatedOptions);
      const executionTime = Date.now() - startTime;
      
      // 更新状态
      this._status.lastRunTime = new Date();
      
      // 返回结果
      return ToolResultSchema.parse({
        success: true,
        data: result,
        metadata: {
          execution_time_ms: executionTime,
          resource_usage: this._resourceUsage
        }
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this._status.lastError = error.message;
      this.emitEvent('error', { error: error.message });
      
      return {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error.message,
          details: error.stack
        },
        metadata: {
          execution_time_ms: executionTime,
          resource_usage: this._resourceUsage
        }
      };
    }
  }
  
  // 配置管理
  async getConfig(): Promise<Record<string, any>> {
    return { ...this._config };
  }
  
  async updateConfig(config: Record<string, any>): Promise<void> {
    // 验证配置
    const isValid = await this.validateConfig(config);
    if (!isValid) {
      throw new Error('Invalid configuration');
    }
    
    // 更新配置
    this._config = { ...this._config, ...config };
    await this.onConfigUpdated(this._config);
    this.emitEvent('config_updated', { config: this._config });
  }
  
  async validateConfig(config: Record<string, any>): Promise<boolean> {
    // 基础验证：检查必填字段
    if (this._manifest.config) {
      for (const [key, param] of Object.entries(this._manifest.config)) {
        if (param.required && (config[key] === undefined || config[key] === null)) {
          return false;
        }
      }
    }
    
    // 子类可以重写此方法进行更复杂的验证
    return true;
  }
  
  // 资源管理
  async getResourceUsage(): Promise<ResourceUsage> {
    return { ...this._resourceUsage };
  }
  
  async setResourceLimits(limits: ResourceLimits): Promise<void> {
    this._resourceLimits = { ...this._resourceLimits, ...limits };
    this._status.resourceLimits = this._resourceLimits;
    await this.onResourceLimitsUpdated(this._resourceLimits);
  }
  
  // 抽象方法（子类必须实现）
  protected abstract onInstall(): Promise<void>;
  protected abstract onUninstall(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract onRun(options: ToolRunOptions): Promise<any>;
  protected abstract onConfigUpdated(config: Record<string, any>): Promise<void>;
  protected abstract onResourceLimitsUpdated(limits: ResourceLimits): Promise<void>;
  
  // 工具方法
  protected emitEvent(type: ToolEventType, data?: any): void {
    const event: ToolEvent = {
      type,
      toolId: this.id,
      timestamp: new Date(),
      data
    };
    this.emit(type, event);
    this.emit('*', event);
  }
  
  protected async checkResourceLimits(): Promise<ToolResult> {
    const usage = await this.getResourceUsage();
    
    // 检查内存限制
    if (this._resourceLimits.memory_mb && usage.memory_mb > this._resourceLimits.memory_mb) {
      return {
        success: false,
        error: {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          message: `Memory limit exceeded: ${usage.memory_mb}MB > ${this._resourceLimits.memory_mb}MB`
        }
      };
    }
    
    // 检查CPU限制
    if (this._resourceLimits.cpu_percent && usage.cpu_percent > this._resourceLimits.cpu_percent) {
      return {
        success: false,
        error: {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          message: `CPU limit exceeded: ${usage.cpu_percent}% > ${this._resourceLimits.cpu_percent}%`
        }
      };
    }
    
    return { success: true };
  }
  
  protected updateResourceUsage(usage: Partial<ResourceUsage>): void {
    this._resourceUsage = { ...this._resourceUsage, ...usage };
  }
  
  protected validateInput(input: any): boolean {
    if (!this._manifest.input) {
      return true; // 没有输入定义，接受任何输入
    }
    
    // 基础类型检查
    switch (this._manifest.input.type) {
      case 'text':
        return typeof input === 'string';
      case 'json':
        try {
          JSON.parse(input);
          return true;
        } catch {
          return false;
        }
      case 'file':
        return typeof input === 'string' && input.startsWith('file://');
      default:
        return true;
    }
  }
  
  protected validateOutput(output: any): boolean {
    if (!this._manifest.output) {
      return true; // 没有输出定义，接受任何输出
    }
    
    // 基础类型检查
    switch (this._manifest.output.type) {
      case 'text':
        return typeof output === 'string';
      case 'json':
        return typeof output === 'object' && output !== null;
      case 'file':
        return typeof output === 'string' && output.startsWith('file://');
      default:
        return true;
    }
  }
  
  protected formatInput(input: any): any {
    if (!this._manifest.input) {
      return input;
    }
    
    switch (this._manifest.input.type) {
      case 'json':
        if (typeof input === 'string') {
          try {
            return JSON.parse(input);
          } catch {
            return input;
          }
        }
        return input;
      default:
        return input;
    }
  }
  
  protected formatOutput(output: any): any {
    if (!this._manifest.output) {
      return output;
    }
    
    switch (this._manifest.output.type) {
      case 'json':
        if (typeof output === 'object') {
          return JSON.stringify(output, null, 2);
        }
        return output;
      default:
        return output;
    }
  }
}

/**
 * HTTP工具实现
 */
export class HttpTool extends BaseTool {
  private axiosInstance: any;
  
  constructor(manifest: ToolManifest) {
    super(manifest);
    // 延迟加载axios
  }
  
  protected async onInstall(): Promise<void> {
    // HTTP工具不需要特殊安装
  }
  
  protected async onUninstall(): Promise<void> {
    // HTTP工具不需要特殊卸载
  }
  
  protected async onStart(): Promise<void> {
    // 创建axios实例
    const axios = await import('axios');
    this.axiosInstance = axios.default.create({
      timeout: this._manifest.extensions?.http?.timeout_ms || 10000,
      headers: this._manifest.extensions?.http?.headers || {}
    });
  }
  
  protected async onStop(): Promise<void> {
    this.axiosInstance = null;
  }
  
  protected async onRun(options: ToolRunOptions): Promise<any> {
    if (!this._manifest.extensions?.http) {
      throw new Error('HTTP tool configuration not found');
    }
    
    const { endpoint, method } = this._manifest.extensions.http;
    const config = options.config || {};
    
    // 准备请求数据
    let requestData: any;
    if (options.input) {
      if (method === 'GET') {
        // GET请求将参数放在query string中
        requestData = { params: options.input };
      } else {
        // 其他方法将参数放在body中
        requestData = { data: options.input };
      }
    }
    
    // 合并配置
    const requestConfig = {
      ...requestData,
      ...config
    };
    
    // 发送请求
    const response = await this.axiosInstance.request({
      url: endpoint,
      method,
      ...requestConfig
    });
    
    // 更新资源使用情况（估算）
    this.updateResourceUsage({
      network_mbps: this.estimateNetworkUsage(response)
    });
    
    return response.data;
  }
  
  protected async onConfigUpdated(config: Record<string, any>): Promise<void> {
    // 更新axios配置
    if (this.axiosInstance) {
      this.axiosInstance.defaults = {
        ...this.axiosInstance.defaults,
        ...config
      };
    }
  }
  
  protected async onResourceLimitsUpdated(limits: ResourceLimits): Promise<void> {
    // 更新超时设置
    if (limits.timeout_seconds && this.axiosInstance) {
      this.axiosInstance.defaults.timeout = limits.timeout_seconds * 1000;
    }
  }
  
  private estimateNetworkUsage(response: any): number {
    // 简单估算网络使用量
    const headersSize = JSON.stringify(response.headers).length;
    const dataSize = typeof response.data === 'string' 
      ? response.data.length 
      : JSON.stringify(response.data).length;
    const totalSize = headersSize + dataSize;
    
    // 转换为Mbps（假设请求在1秒内完成）
    return totalSize * 8 / 1000000;
  }
}

/**
 * CLI工具实现
 */
export class CliTool extends BaseTool {
  private childProcess: any = null;
  
  constructor(manifest: ToolManifest) {
    super(manifest);
  }
  
  protected async onInstall(): Promise<void> {
    // 检查命令是否存在
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    if (!this._manifest.extensions?.cli) {
      throw new Error('CLI tool configuration not found');
    }
    
    const { command } = this._manifest.extensions.cli;
    
    try {
      await execAsync(`which ${command}`);
    } catch (error) {
      throw new Error(`Command ${command} not found in PATH`);
    }
  }
  
  protected async onUninstall(): Promise<void> {
    // CLI工具不需要特殊卸载
  }
  
  protected async onStart(): Promise<void> {
    // CLI工具按需启动，不需要预启动
  }
  
  protected async onStop(): Promise<void> {
    // 停止正在运行的进程
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
  }
  
  protected async onRun(options: ToolRunOptions): Promise<any> {
    if (!this._manifest.extensions?.cli) {
      throw new Error('CLI tool configuration not found');
    }
    
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const { command, args, env, working_dir, shell } = this._manifest.extensions.cli;
    
    // 构建命令
    let fullCommand = command;
    if (args.length > 0) {
      fullCommand += ' ' + args.join(' ');
    }
    
    // 替换输入参数
    if (options.input) {
      const inputStr = typeof options.input === 'string' 
        ? options.input 
        : JSON.stringify(options.input);
      fullCommand = fullCommand.replace(/{input}/g, inputStr);
    }
    
    // 合并环境变量
    const processEnv = {
      ...process.env,
      ...env,
      ...options.config
    };
    
    // 执行命令
    const startTime = Date.now();
    try {
      const result = await execAsync(fullCommand, {
        cwd: working_dir,
        env: processEnv,
        shell,
        timeout: this._resourceLimits.timeout_seconds ? this._resourceLimits.timeout_seconds * 1000 : undefined
      });
      
      const executionTime = Date.now() - startTime;
      
      // 更新资源使用情况
      this.updateResourceUsage({
        cpu_percent: this.estimateCpuUsage(executionTime),
        memory_mb: this.estimateMemoryUsage(result)
      });
      
      // 解析输出
      let output: any;
      try {
        output = JSON.parse(result.stdout);
      } catch {
        output = result.stdout.trim();
      }
      
      return output;
    } catch (error) {
      throw new Error(`CLI execution failed: ${error.message}\n${error.stderr}`);
    }
  }
  
  protected async onConfigUpdated(config: Record<string, any>): Promise<void> {
    // CLI工具配置更新
  }
  
  protected async onResourceLimitsUpdated(limits: ResourceLimits): Promise<void> {
    // 更新资源限制
  }
  
  private estimateCpuUsage(executionTimeMs: number): number {
    // 简单估算：假设单核100%使用
    return Math.min(100, (executionTimeMs / 1000) * 100);
  }
  
  private estimateMemoryUsage(result: any): number {
    // 简单估算：基于输出大小
    const outputSize = result.stdout.length + result.stderr.length;
    return Math.ceil(outputSize / 1024 / 1024); // 转换为MB
  }
}

/**
 * 工具工厂
 */
export class ToolFactory implements IToolFactory {
  async createTool(manifest: ToolManifest): Promise<ITool> {
    switch (manifest.type) {
      case 'http':
        return new HttpTool(manifest);
      case 'cli':
        return new CliTool(manifest);
      case 'mcp':
        throw new Error('MCP tool implementation not yet available');
      case 'webview':
        throw new Error('WebView tool implementation not yet available');
      case 'declarative':
        throw new Error('Declarative tool implementation not yet available');
      default:
        throw new Error(`Unsupported tool type: ${manifest.type}`);
    }
  }
  
  supportsType(toolType: string): boolean {
    return ['http', 'cli', 'mcp', 'webview', 'declarative'].includes(toolType);
  }
}