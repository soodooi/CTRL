import { describe, expect, it } from 'vitest';

import {
  type CtrlCapabilities,
  createHello,
  formatStreamId,
  parseStreamId,
  readCtrlCapabilities,
} from '../../index.js';

describe('stream id helpers', () => {
  it('formats publisher + instance', () => {
    expect(formatStreamId({ publisher: 'clipboard-ai', instance: 'pid-42' })).toBe(
      'clipboard-ai:pid-42',
    );
  });

  it('formats publisher only when instance is missing', () => {
    expect(formatStreamId({ publisher: 'eink-boox' })).toBe('eink-boox');
    expect(formatStreamId({ publisher: 'eink-boox', instance: '' })).toBe('eink-boox');
  });

  it('parses on the first colon only', () => {
    expect(parseStreamId('clipboard-ai:pid-42')).toEqual({
      publisher: 'clipboard-ai',
      instance: 'pid-42',
    });
    expect(parseStreamId('host:device:42')).toEqual({
      publisher: 'host',
      instance: 'device:42',
    });
    expect(parseStreamId('singleton')).toEqual({ publisher: 'singleton' });
  });
});

describe('CtrlCapabilities in handshake', () => {
  it('hardware-source declares profile in Hello capability bag', () => {
    const caps: CtrlCapabilities = {
      cell_kinds: ['hardware_reading'],
      needs_capability: ['CameraRead', 'LlmCall'],
      hardware_profile: {
        device_type: 'ai_glasses',
        power_class: 'always_on',
        bandwidth_class: '50kbps',
        latency_budget_ms: 100,
        battery_aware: true,
      },
    };

    const hello = createHello({
      source: 'glasses:abc',
      seq: 0,
      role: 'sender',
      stream_id: 'glasses:abc',
      capabilities: caps,
    });

    const round = JSON.parse(JSON.stringify(hello));
    const recovered = readCtrlCapabilities(round.payload.capabilities);
    expect(recovered.hardware_profile?.device_type).toBe('ai_glasses');
    expect(recovered.hardware_profile?.power_class).toBe('always_on');
    expect(recovered.needs_capability).toEqual(['CameraRead', 'LlmCall']);
  });

  it('e-ink receiver declares render profile + backpressure', () => {
    const caps: CtrlCapabilities = {
      eink_render_profile: {
        ppi: 227,
        refresh_class: 'static',
        page_size: [1404, 1872],
        contrast_class: '16_grey',
        preferred_cells: ['llm_response', 'tool_result'],
      },
      backpressure: {
        buffer_size: 32,
        drop_policy: 'coalesce',
        coalesce_window_ms: 500,
      },
    };

    const hello = createHello({
      source: 'boox:mira5',
      seq: 0,
      role: 'receiver',
      stream_id: 'session-shared',
      capabilities: caps,
    });

    const recovered = readCtrlCapabilities(hello.payload.capabilities);
    expect(recovered.eink_render_profile?.page_size).toEqual([1404, 1872]);
    expect(recovered.backpressure?.drop_policy).toBe('coalesce');
    expect(recovered.backpressure?.coalesce_window_ms).toBe(500);
  });

  it('readCtrlCapabilities returns empty object for undefined bag', () => {
    expect(readCtrlCapabilities(undefined)).toEqual({});
  });

  it('foreign keys in capability bag are tolerated (forward-compat)', () => {
    const caps = {
      hardware_profile: {
        device_type: 'foo',
        power_class: 'intermittent' as const,
        bandwidth_class: '5kbps' as const,
        latency_budget_ms: 200,
      },
      future_field_we_dont_know: { x: 1 },
    };
    const recovered = readCtrlCapabilities(caps);
    expect(recovered.hardware_profile?.device_type).toBe('foo');
  });
});
