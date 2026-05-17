export * from './types';
export * from './parser';
export * from './sync';

// 示例使用
/**
 * 使用示例：
 * 
 * ```typescript
 * import { FlomoParser, FlomoSync } from '@ctrl/flomo-integration';
 * 
 * // 解析单个笔记
 * const parser = new FlomoParser();
 * const result = parser.parseNote(flomoNote);
 * 
 * if (result.success && result.idea) {
 *   console.log('解析成功:', result.idea);
 * } else {
 *   console.error('解析失败:', result.errors);
 * }
 * 
 * // 同步flomo笔记
 * const sync = new FlomoSync({
 *   apiKey: 'your-flomo-api-key'
 * });
 * 
 * // 同步keycap意向
 * const ideas = await sync.syncKeycapIdeas();
 * console.log('同步到的意向:', ideas);
 * ```
 */