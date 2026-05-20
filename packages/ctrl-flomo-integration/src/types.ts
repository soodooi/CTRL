import { z } from 'zod';

// Flomo笔记数据结构
export const FlomoNoteSchema = z.object({
  id: z.string(),
  content: z.string(),
  created_at: z.string(),
  tags: z.array(z.string()).optional(),
  slug: z.string().optional(),
  memo_link: z.string().optional(),
});

export type FlomoNote = z.infer<typeof FlomoNoteSchema>;

// Keycap意向数据结构
export const KeycapIdeaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['cli', 'http', 'mcp', 'webview', 'declarative']),
  priority: z.enum(['p0', 'p1', 'p2']),
  status: z.enum(['idea', 'research', 'development', 'completed', 'released']),
  recordedDate: z.string(),
  source: z.enum(['flomo', 'community', 'internal']),
  tags: z.array(z.string()).optional(),
  links: z.array(z.string()).optional(),
  notes: z.string().optional(),
  flomoNoteId: z.string().optional(),
  flomoNoteLink: z.string().optional(),
});

export type KeycapIdea = z.infer<typeof KeycapIdeaSchema>;

// Webhook请求数据
export const FlomoWebhookSchema = z.object({
  content: z.string(),
  tags: z.array(z.string()).optional(),
  created_at: z.string(),
  memo_link: z.string(),
});

export type FlomoWebhook = z.infer<typeof FlomoWebhookSchema>;

// API响应数据
export const FlomoApiResponseSchema = z.object({
  memos: z.array(FlomoNoteSchema),
  has_more: z.boolean().optional(),
  total: z.number().optional(),
});

export type FlomoApiResponse = z.infer<typeof FlomoApiResponseSchema>;

// 配置数据
export const FlomoConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().default('https://flomoapp.com/api/v1'),
  webhookSecret: z.string().optional(),
  syncInterval: z.number().default(3600000), // 1小时
  defaultTags: z.array(z.string()).default(['ctrl-keycap']),
});

export type FlomoConfig = z.infer<typeof FlomoConfigSchema>;

// 解析结果
export const ParseResultSchema = z.object({
  success: z.boolean(),
  idea: KeycapIdeaSchema.optional(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;