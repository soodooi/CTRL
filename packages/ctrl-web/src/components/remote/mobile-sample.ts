// Sample surfaces for the desktop Mobile-page preview (ADR-005 §2). These stand
// in for what each pack will return from `describe` once the live wiring lands;
// they exist only so the desktop preview renders without a phone/kernel. English
// placeholder content on purpose — the point is the GENERIC renderer, and real
// packs supply their own localized labels via their own data.
import type { PackTab } from './MobilePreview';

export const SAMPLE_TABS: PackTab[] = [
  {
    key: 'markets',
    label: 'Markets',
    icon: '◪',
    surface: {
      v: 1,
      pack: 'markets',
      title: 'Markets · Today',
      parts: [
        {
          kind: 'gauge',
          id: 'sentiment',
          title: 'Sentiment',
          data: { value: 62, unit: '°', verdict: 'Choppy', tone: 'warn', read: 'mixed breadth, pick strength' },
        },
        {
          kind: 'metrics',
          id: 'breadth',
          data: {
            items: [
              { label: 'Up', value: 3527, tone: 'up' },
              { label: 'Down', value: 1584, tone: 'down' },
              { label: 'Limit', value: 108 },
              { label: 'Fail', value: '32%', tone: 'warn' },
            ],
          },
        },
        {
          kind: 'barlist',
          id: 'movers',
          title: 'Top movers',
          data: {
            rows: [
              { name: 'Zhongji', sub: '300308', value: '+3.82', ratio: 1, tone: 'up', tag: 'inst' },
              { name: 'Foxconn', sub: '601138', value: '+2.71', ratio: 0.71, tone: 'up' },
              { name: 'GigaDevice', sub: '603986', value: '+1.83', ratio: 0.48, tone: 'up' },
            ],
          },
          actions: [{ id: 'refresh', label: 'Refresh', verb: 'query', source: 'markets', op: 'movers' }],
        },
      ],
    },
  },
  {
    key: 'sales',
    label: 'Sales',
    icon: '☎',
    surface: {
      v: 1,
      pack: 'sales',
      title: 'Sales · Pipeline',
      parts: [
        {
          kind: 'record',
          id: 'month',
          title: 'This month',
          data: {
            fields: [
              { label: 'New', value: 18 },
              { label: 'Follow-ups', value: 7, tone: 'warn' },
              { label: 'Closed', value: '$42,800', tone: 'down' },
            ],
          },
        },
        {
          kind: 'table',
          id: 'deals',
          title: 'Recent deals',
          data: {
            columns: ['Client', 'Stage', 'Amount'],
            rows: [
              ['Acme Co', 'Quote', '28,000'],
              ['Bright Edu', 'Follow', '12,500'],
              ['Hengyi', 'Closed', '42,800'],
            ],
          },
        },
        {
          kind: 'list',
          id: 'today',
          title: 'Today',
          data: {
            items: [
              { text: 'Call Acme re: quote', meta: '10:30' },
              { text: 'Send contract Hengyi', meta: '14:00' },
            ],
          },
          actions: [{ id: 'new', label: '+ New contact', verb: 'produce', source: 'sales', op: 'contact.create' }],
        },
      ],
    },
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: '✎',
    surface: {
      v: 1,
      pack: 'notes',
      title: 'Notes',
      parts: [
        {
          kind: 'list',
          id: 'recent',
          title: 'Recent',
          data: {
            items: [
              { text: 'Q3 planning', meta: '2d' },
              { text: 'Vendor shortlist', meta: '5d' },
              { text: 'Trip checklist', meta: '1w' },
            ],
          },
        },
      ],
    },
  },
];
