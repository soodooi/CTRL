// /vault — the VMark-style three-pane browser into ~/Documents/CTRL/.

import type { ReactElement } from 'react';
import { VaultBrowser } from '@/components/vault/VaultBrowser';

export const VaultRoute = (): ReactElement => <VaultBrowser />;
