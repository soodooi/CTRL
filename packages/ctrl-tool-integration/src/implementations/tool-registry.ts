import { 
  IToolRegistry, 
  ITool, 
  ToolEvent, 
  ToolEventType,
  IToolFactory 
} from '../interfaces/tool';
import { ToolManifest } from '../schemas/tool-manifest';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { ToolFactory } from './base-tool';

/**
 * 工具注册表实现
 */
export class ToolRegistry extends EventEmitter implements IToolRegistry {
  private tools: Map<string, ITool> = new Map();
  private factory: IToolFactory;
  
  constructor(factory?: IToolFactory) {
    super();
    this.factory = factory || new ToolFactory();
  }
  
  // 工具管理
  async registerTool(tool: ITool): Promise<void> {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool ${tool.id} is already registered`);
    }
    
    this.tools.set(tool.id, tool);
    
    // 监听工具事件
    tool.on('*', (event: ToolEvent) => {
      this.emit(event.type, event);
    });
    
    this.emit('tool_registered', { toolId: tool.id });
  }
  
  async unregisterTool(toolId: string): Promise<void> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }
    
    // 停止工具
    try {
      await tool.stop();
    } catch (error) {
      // 忽略停止错误
    }
    
    this.tools.delete(toolId);
    this.emit('tool_unregistered', { toolId });
  }
  
  async getTool(toolId: string): Promise<ITool | null> {
    return this.tools.get(toolId) || null;
  }
  
  async listTools(): Promise<ITool[]> {
    return Array.from(this.tools.values());
  }
  
  // 工具发现
  async discoverTools(directory: string): Promise<ITool[]> {
    const tools: ITool[] = [];
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // 检查目录中是否有manifest文件
          const manifestPath = path.join(directory, entry.name, 'manifest.json');
          const yamlManifestPath = path.join(directory, entry.name, 'manifest.yaml');
          const ymlManifestPath = path.join(directory, entry.name, 'manifest.yml');
          
          let manifestFile: string | null = null;
          
          if (await this.fileExists(manifestPath)) {
            manifestFile = manifestPath;
          } else if (await this.fileExists(yamlManifestPath)) {
            manifestFile = yamlManifestPath;
          } else if (await this.fileExists(ymlManifestPath)) {
            manifestFile = ymlManifestPath;
          }
          
          if (manifestFile) {
            try {
              const tool = await this.loadToolFromManifest(manifestFile);
              tools.push(tool);
            } catch (error) {
              console.warn(`Failed to load tool from ${manifestFile}:`, error.message);
            }
          }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          // 检查是否是独立的manifest文件
          const manifestPath = path.join(directory, entry.name);
          try {
            const tool = await this.loadToolFromManifest(manifestPath);
            tools.push(tool);
          } catch (error) {
            // 忽略非manifest文件
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    return tools;
  }
  
  async loadToolFromManifest(manifestPath: string): Promise<ITool> {
    // 读取manifest文件
    const content = await fs.readFile(manifestPath, 'utf-8');
    
    let manifest: ToolManifest;
    
    // 解析JSON或YAML
    if (manifestPath.endsWith('.json')) {
      manifest = JSON.parse(content);
    } else if (manifestPath.endsWith('.yaml') || manifestPath.endsWith('.yml')) {
      manifest = yaml.parse(content);
    } else {
      throw new Error(`Unsupported manifest format: ${manifestPath}`);
    }
    
    // 验证manifest
    // TODO: 使用zod验证
    
    // 创建工具
    const tool = await this.factory.createTool(manifest);
    
    // 设置工具的工作目录
    const toolDir = path.dirname(manifestPath);
    // TODO: 将工具目录信息传递给工具
    
    return tool;
  }
  
  // 事件管理
  on(event: ToolEventType, listener: (event: ToolEvent) => void): void;
  on(event: string, listener: (...args: any[]) => void): void {
    super.on(event, listener);
  }
  
  off(event: ToolEventType, listener: (event: ToolEvent) => void): void;
  off(event: string, listener: (...args: any[]) => void): void {
    super.off(event, listener);
  }
  
  emit(event: ToolEvent): void;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
  
  // 批量操作
  async startAll(): Promise<void> {
    const tools = await this.listTools();
    const promises = tools.map(tool => tool.start().catch(error => {
      console.warn(`Failed to start tool ${tool.id}:`, error.message);
    }));
    
    await Promise.all(promises);
  }
  
  async stopAll(): Promise<void> {
    const tools = await this.listTools();
    const promises = tools.map(tool => tool.stop().catch(error => {
      console.warn(`Failed to stop tool ${tool.id}:`, error.message);
    }));
    
    await Promise.all(promises);
  }
  
  async installAll(): Promise<void> {
    const tools = await this.listTools();
    const promises = tools.map(tool => tool.install().catch(error => {
      console.warn(`Failed to install tool ${tool.id}:`, error.message);
    }));
    
    await Promise.all(promises);
  }
  
  async uninstallAll(): Promise<void> {
    const tools = await this.listTools();
    const promises = tools.map(tool => tool.uninstall().catch(error => {
      console.warn(`Failed to uninstall tool ${tool.id}:`, error.message);
    }));
    
    await Promise.all(promises);
  }
  
  // 工具方法
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  // 工具搜索
  async searchTools(query: string): Promise<ITool[]> {
    const tools = await this.listTools();
    const lowerQuery = query.toLowerCase();
    
    return tools.filter(tool => 
      tool.id.toLowerCase().includes(lowerQuery) ||
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.manifest.description?.toLowerCase().includes(lowerQuery)
    );
  }
  
  // 工具分类
  async getToolsByCategory(): Promise<Map<string, ITool[]>> {
    const tools = await this.listTools();
    const categories = new Map<string, ITool[]>();
    
    for (const tool of tools) {
      // TODO: 从manifest中获取分类信息
      const category = 'uncategorized';
      
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(tool);
    }
    
    return categories;
  }
  
  // 工具统计
  async getStats(): Promise<ToolRegistryStats> {
    const tools = await this.listTools();
    const runningTools = tools.filter(tool => {
      const status = tool.getStatus();
      return status.then(s => s.running).catch(() => false);
    });
    
    const installedTools = tools.filter(tool => {
      const status = tool.getStatus();
      return status.then(s => s.installed).catch(() => false);
    });
    
    return {
      totalTools: tools.length,
      runningTools: (await Promise.all(runningTools.map(t => t.getStatus()))).length,
      installedTools: (await Promise.all(installedTools.map(t => t.getStatus()))).length,
      lastUpdated: new Date()
    };
  }
}

/**
 * 工具注册表统计信息
 */
export interface ToolRegistryStats {
  totalTools: number;
  runningTools: number;
  installedTools: number;
  lastUpdated: Date;
}

/**
 * 工具运行器实现
 */
export class ToolRunner implements IToolRegistry {
  private registry: ToolRegistry;
  private runningTasks: Map<string, RunningTask> = new Map();
  private runHistory: ToolRunHistory[] = [];
  private maxHistorySize = 1000;
  
  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }
  
  // 实现IToolRegistry接口（委托给registry）
  async registerTool(tool: ITool): Promise<void> {
    return this.registry.registerTool(tool);
  }
  
  async unregisterTool(toolId: string): Promise<void> {
    // 取消正在运行的任务
    await this.cancelRun(toolId);
    return this.registry.unregisterTool(toolId);
  }
  
  async getTool(toolId: string): Promise<ITool | null> {
    return this.registry.getTool(toolId);
  }
  
  async listTools(): Promise<ITool[]> {
    return this.registry.listTools();
  }
  
  async discoverTools(directory: string): Promise<ITool[]> {
    return this.registry.discoverTools(directory);
  }
  
  async loadToolFromManifest(manifestPath: string): Promise<ITool> {
    return this.registry.loadToolFromManifest(manifestPath);
  }
  
  on(event: ToolEventType, listener: (event: ToolEvent) => void): void {
    this.registry.on(event, listener);
  }
  
  off(event: ToolEventType, listener: (event: ToolEvent) => void): void {
    this.registry.off(event, listener);
  }
  
  emit(event: ToolEvent): void {
    this.registry.emit(event);
  }
  
  async startAll(): Promise<void> {
    return this.registry.startAll();
  }
  
  async stopAll(): Promise<void> {
    // 停止所有运行中的任务
    for (const [taskId, task] of this.runningTasks) {
      try {
        task.cancel();
      } catch (error) {
        console.warn(`Failed to cancel task ${taskId}:`, error.message);
      }
    }
    
    return this.registry.stopAll();
  }
  
  async installAll(): Promise<void> {
    return this.registry.installAll();
  }
  
  async uninstallAll(): Promise<void> {
    // 取消所有运行中的任务
    this.runningTasks.clear();
    return this.registry.uninstallAll();
  }
  
  // IToolRunner接口实现
  async runTool(toolId: string, options: ToolRunOptions): Promise<ToolResult> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool ${toolId} not found`
        }
      };
    }
    
    // 创建任务
    const taskId = `${toolId}-${Date.now()}`;
    const task: RunningTask = {
      id: taskId,
      toolId,
      startTime: new Date(),
      options,
      cancel: () => {
        // 默认实现，子类可以重写
        task.cancelled = true;
      },
      cancelled: false
    };
    
    this.runningTasks.set(taskId, task);
    
    try {
      // 运行工具
      const result = await tool.run(options);
      
      // 记录历史
      const history: ToolRunHistory = {
        toolId,
        startTime: task.startTime,
        endTime: new Date(),
        success: result.success,
        result: result.data,
        error: result.error?.message,
        resourceUsage: result.metadata?.resource_usage || {}
      };
      
      this.addToHistory(history);
      
      return result;
    } catch (error) {
      // 记录错误历史
      const history: ToolRunHistory = {
        toolId,
        startTime: task.startTime,
        endTime: new Date(),
        success: false,
        error: error.message,
        resourceUsage: {}
      };
      
      this.addToHistory(history);
      
      throw error;
    } finally {
      // 清理任务
      this.runningTasks.delete(taskId);
    }
  }
  
  async cancelRun(toolId: string): Promise<void> {
    // 取消该工具的所有运行任务
    for (const [taskId, task] of this.runningTasks) {
      if (task.toolId === toolId) {
        task.cancel();
        this.runningTasks.delete(taskId);
      }
    }
  }
  
  async getRunningTools(): Promise<RunningTool[]> {
    const runningTools: RunningTool[] = [];
    
    for (const task of this.runningTasks.values()) {
      const tool = await this.getTool(task.toolId);
      if (tool) {
        const resourceUsage = await tool.getResourceUsage();
        
        runningTools.push({
          toolId: task.toolId,
          startTime: task.startTime,
          options: task.options,
          resourceUsage
        });
      }
    }
    
    return runningTools;
  }
  
  async getToolRunHistory(toolId: string, limit: number = 50): Promise<ToolRunHistory[]> {
    const history = this.runHistory
      .filter(h => h.toolId === toolId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
    
    return history;
  }
  
  async getTotalResourceUsage(): Promise<ResourceUsage> {
    const runningTools = await this.getRunningTools();
    
    const totalUsage: ResourceUsage = {
      memory_mb: 0,
      cpu_percent: 0,
      network_mbps: 0,
      uptime_seconds: 0
    };
    
    for (const tool of runningTools) {
      totalUsage.memory_mb += tool.resourceUsage.memory_mb;
      totalUsage.cpu_percent += tool.resourceUsage.cpu_percent;
      totalUsage.network_mbps += tool.resourceUsage.network_mbps;
      totalUsage.uptime_seconds = Math.max(
        totalUsage.uptime_seconds,
        tool.resourceUsage.uptime_seconds
      );
    }
    
    return totalUsage;
  }
  
  async setGlobalResourceLimits(limits: ResourceLimits): Promise<void> {
    // 设置所有工具的全局资源限制
    const tools = await this.listTools();
    const promises = tools.map(tool => tool.setResourceLimits(limits));
    await Promise.all(promises);
  }
  
  // 工具方法
  private addToHistory(history: ToolRunHistory): void {
    this.runHistory.unshift(history);
    
    // 限制历史记录大小
    if (this.runHistory.length > this.maxHistorySize) {
      this.runHistory = this.runHistory.slice(0, this.maxHistorySize);
    }
  }
  
  // 获取运行统计
  async getRunStats(): Promise<RunStats> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const recentHistory = this.runHistory.filter(h => h.startTime > oneHourAgo);
    const dailyHistory = this.runHistory.filter(h => h.startTime > oneDayAgo);
    
    const successCount = (history: ToolRunHistory[]) => 
      history.filter(h => h.success).length;
    
    const avgExecutionTime = (history: ToolRunHistory[]) => {
      if (history.length === 0) return 0;
      const totalTime = history.reduce((sum, h) => {
        const executionTime = h.endTime.getTime() - h.startTime.getTime();
        return sum + executionTime;
      }, 0);
      return totalTime / history.length;
    };
    
    return {
      totalRuns: this.runHistory.length,
      recentRuns: recentHistory.length,
      dailyRuns: dailyHistory.length,
      successRate: {
        overall: this.runHistory.length > 0 ? successCount(this.runHistory) / this.runHistory.length : 0,
        recent: recentHistory.length > 0 ? successCount(recentHistory) / recentHistory.length : 0,
        daily: dailyHistory.length > 0 ? successCount(dailyHistory) / dailyHistory.length : 0
      },
      avgExecutionTimeMs: {
        overall: avgExecutionTime(this.runHistory),
        recent: avgExecutionTime(recentHistory),
        daily: avgExecutionTime(dailyHistory)
      },
      mostUsedTools: await this.getMostUsedTools(10)
    };
  }
  
  private async getMostUsedTools(limit: number): Promise<{ toolId: string; count: number }[]> {
    const toolCounts = new Map<string, number>();
    
    for (const history of this.runHistory) {
      const count = toolCounts.get(history.toolId) || 0;
      toolCounts.set(history.toolId, count + 1);
    }
    
    return Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([toolId, count]) => ({ toolId, count }));
  }
}

/**
 * 运行任务
 */
interface RunningTask {
  id: string;
  toolId: string;
  startTime: Date;
  options: ToolRunOptions;
  cancel: () => void;
  cancelled: boolean;
}

/**
 * 运行统计
 */
interface RunStats {
  totalRuns: number;
  recentRuns: number;
  dailyRuns: number;
  successRate: {
    overall: number;
    recent: number;
    daily: number;
  };
  avgExecutionTimeMs: {
    overall: number;
    recent: number;
    daily: number;
  };
  mostUsedTools: { toolId: string; count: number }[];
}

// 重新导出接口中定义的类型
export type { 
  RunningTool, 
  ToolRunHistory, 
  ResourceUsage 
} from '../interfaces/tool';