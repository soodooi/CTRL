// RemoteEntry — the phone-side account login (ADR-005 §2, dev scheme). Log in
// with a username + password and it connects to your desktop (the credentials
// derive the relay room + E2E key; the desktop logged in with the same account
// is already there). Persisted, so you don't log in again and again. Dev default
// is admin / 898989.
import { useEffect, useState, type ReactElement } from 'react';
import {
  deriveSession,
  loadAccount,
  saveAccount,
  clearAccount,
  DEV_ACCOUNT,
  type Account,
  type DerivedSession,
} from '@/lib/remote-account';
import { RemoteApp } from './RemoteApp';
import styles from './RemoteEntry.module.css';

export function RemoteEntry(): ReactElement {
  const [account, setAccount] = useState<Account | null>(() => loadAccount());
  const [session, setSession] = useState<DerivedSession | null>(null);
  const [username, setUsername] = useState(DEV_ACCOUNT.username);
  const [password, setPassword] = useState(DEV_ACCOUNT.password);

  useEffect(() => {
    if (account == null) {
      setSession(null);
      return;
    }
    let alive = true;
    void deriveSession(account).then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  const login = (): void => {
    const acc = { username: username.trim(), password };
    if (acc.username === '' || acc.password === '') return;
    saveAccount(acc);
    setAccount(acc);
  };

  const logout = (): void => {
    clearAccount();
    setAccount(null);
    setSession(null);
  };

  if (account != null && session != null) {
    return (
      <div className={styles.wrap}>
        <RemoteApp room={session.room} keyB64={session.keyB64} />
        <button type="button" className={styles.logout} onClick={logout} title="Sign out">
          ⏻
        </button>
      </div>
    );
  }
  if (account != null) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.center}>
      <div className={styles.mark}>CTRL</div>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.sub}>Log in to reach your own desktop from this phone.</p>
      <input
        className={styles.input}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoCapitalize="none"
      />
      <input
        className={styles.input}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && login()}
        placeholder="Password"
      />
      <button type="button" className={styles.btn} onClick={login}>
        Sign in
      </button>
      <div className={styles.devHint}>dev: admin / 898989</div>
    </div>
  );
}
