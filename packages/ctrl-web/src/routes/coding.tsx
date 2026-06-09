// Coding — H-2026-06-09-001 (opencode brain).
//
// L1 Coding tab — 2-column split:
//   left  ~40% = `<CodingArtifactPane />` (files opencode edited,
//                 fetched via opencode API)
//   right ~60% = `<OpencodeChat />` (opencode HTTP API)

import type { ReactElement } from 'react';
import { OpencodeChat } from '@/components/opencode/OpencodeChat';
import { CodingArtifactPane } from '@/components/coding/CodingArtifactPane';

export const CodingRoute = (): ReactElement => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: '0 0 40%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <CodingArtifactPane />
      </div>
      <div
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <OpencodeChat />
      </div>
    </div>
  );
};
