// auto-register utility tests — mock entity ontology, no host coupling.
//
// olym-core's MCP utility is host-agnostic. These tests use a synthetic
// ontology to verify deriveReadOnlyTools / registerEntity / registerDomain
// behavior. Host-specific bootstrap tests (e.g. bootstraphostDomain
// registering 10 entities) live in @<host>/domain (host package)'s own test suite.

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  registerEntity,
  registerDomain,
  getRegisteredTools,
  getEntityTools,
  clearRegistry,
  deriveReadOnlyTools,
} from '../mcp/auto-register.js'

// Synthetic test entity — minimum shape to exercise the utility.
const widgetOntology = {
  description: 'Synthetic Widget entity for testing.',
  insert: z.object({
    id: z.string().describe('Widget id.'),
    name: z.string().describe('Widget display name.'),
  }),
  select: z.object({
    id: z.string(),
    name: z.string(),
  }),
}

const gizmoOntology = {
  description: 'Synthetic Gizmo entity for testing.',
  insert: z.object({
    id: z.string().describe('Gizmo id.'),
  }),
  select: z.object({
    id: z.string(),
  }),
}

describe('MCP auto-register', () => {
  beforeEach(() => {
    clearRegistry()
  })

  describe('deriveReadOnlyTools — 5 tools per entity', () => {
    it('produces 5 tools for one entity', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      expect(tools.length).toBe(5)
    })

    it('tool names follow mcp_<entity>_<verb> convention', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      const names = tools.map((t) => t.name)
      expect(names).toEqual([
        'mcp_widget_get',
        'mcp_widget_list',
        'mcp_widget_search',
        'mcp_widget_count',
        'mcp_widget_describe',
      ])
    })

    it('every tool description includes the entity ontology description', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      for (const t of tools) {
        expect(t.description).toContain('Synthetic Widget')
      }
    })

    it('_get input schema accepts { id } only — not the full insert shape', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      const getTool = tools.find((t) => t.name === 'mcp_widget_get')!
      const okResult = getTool.inputSchema.safeParse({ id: 'abc' })
      expect(okResult.success).toBe(true)
    })

    it('_list input accepts filter + limit + cursor', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      const listTool = tools.find((t) => t.name === 'mcp_widget_list')!
      const ok = listTool.inputSchema.safeParse({ filter: { name: 'foo' }, limit: 25 })
      expect(ok.success).toBe(true)
      const okEmpty = listTool.inputSchema.safeParse({})
      expect(okEmpty.success).toBe(true)
      const badLimit = listTool.inputSchema.safeParse({ limit: 9999 })
      expect(badLimit.success).toBe(false)
    })

    it('_search requires a non-empty query', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      const searchTool = tools.find((t) => t.name === 'mcp_widget_search')!
      const ok = searchTool.inputSchema.safeParse({ query: 'hello' })
      expect(ok.success).toBe(true)
      const badEmpty = searchTool.inputSchema.safeParse({ query: '' })
      expect(badEmpty.success).toBe(false)
    })

    it('_describe accepts empty input', () => {
      const tools = deriveReadOnlyTools({
        entityName: 'widget',
        ontology: widgetOntology,
      })
      const describeTool = tools.find((t) => t.name === 'mcp_widget_describe')!
      const ok = describeTool.inputSchema.safeParse({})
      expect(ok.success).toBe(true)
    })
  })

  describe('Registry', () => {
    it('starts empty', () => {
      expect(getRegisteredTools().length).toBe(0)
    })

    it('registerEntity adds 5 tools per call', () => {
      registerEntity({ entityName: 'widget', ontology: widgetOntology })
      expect(getRegisteredTools().length).toBe(5)
    })

    it('multiple entity registrations accumulate', () => {
      registerEntity({ entityName: 'widget', ontology: widgetOntology })
      registerEntity({ entityName: 'gizmo', ontology: gizmoOntology })
      expect(getRegisteredTools().length).toBe(10)
    })

    it('getEntityTools returns 5 tools for that entity', () => {
      registerEntity({ entityName: 'gizmo', ontology: gizmoOntology })
      expect(getEntityTools('gizmo').length).toBe(5)
      expect(getEntityTools('nonexistent').length).toBe(0)
    })
  })

  describe('registerDomain — bulk registration', () => {
    it('registers all entities in one call', () => {
      const registry = registerDomain({
        name: 'test-domain',
        entities: {
          widget: widgetOntology,
          gizmo: gizmoOntology,
        },
      })
      expect(registry.name).toBe('test-domain')
      expect(registry.entityCount).toBe(2)
      expect(registry.toolCount).toBe(10)
      expect(registry.tools.length).toBe(10)
    })

    it('returned tool list matches getRegisteredTools() after call', () => {
      registerDomain({
        name: 'test-domain',
        entities: { widget: widgetOntology },
      })
      expect(getRegisteredTools().length).toBe(5)
    })

    it('handles empty entity map', () => {
      const registry = registerDomain({ name: 'empty', entities: {} })
      expect(registry.entityCount).toBe(0)
      expect(registry.toolCount).toBe(0)
      expect(registry.tools).toEqual([])
    })
  })
})
