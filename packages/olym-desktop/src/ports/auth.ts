// Auth Port — desktop auth abstraction (license + cloud-sync token).
// Concrete adapters call ctrl-cloud worker, store tokens in Tauri Keychain.

export interface AuthPrincipal {
  readonly userId: string;
  readonly email?: string;
  readonly tier: 'free' | 'subscriber' | 'creator';
  readonly capabilities: ReadonlyArray<string>;
  readonly tokenExpiresAt: number; // epoch ms
}

export interface AuthPort {
  signIn(email: string, password: string): Promise<AuthPrincipal>;
  signInWithMagicLink(token: string): Promise<AuthPrincipal>;
  signOut(): Promise<void>;
  currentPrincipal(): Promise<AuthPrincipal | null>;
  refreshToken(): Promise<AuthPrincipal>;
  // BYOK key vault
  setProviderKey(provider: 'anthropic' | 'openai', key: string): Promise<void>;
  getProviderKey(provider: 'anthropic' | 'openai'): Promise<string | null>;
}
