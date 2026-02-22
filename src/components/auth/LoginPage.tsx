import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import SignupPage from './SignupPage';
import { Mail, Lock, ArrowRight, Loader2, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import logoDark from '../../assets/logo_transparent_dark.svg';
import texture from '../../assets/texture.jpg';

type AuthView = 'login' | 'signup' | 'magic-link-sent';

const appWindow = getCurrentWindow();

export default function LoginPage() {
  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  const { login, sendMagicLink, isLoading, authError, clearError } = useAuthStore();

  useEffect(() => {
    const check = async () => setIsMaximized(await appWindow.isMaximized());
    check();
    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  if (view === 'signup') {
    return <SignupPage onBack={() => { clearError(); setView('login'); }} />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    await login(email.trim(), password.trim());
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = magicLinkEmail.trim() || email.trim();
    if (!target) return;
    const { error } = await sendMagicLink(target);
    if (!error) {
      setMagicLinkEmail(target);
      setView('magic-link-sent');
    }
  };

  const windowControls = (
    <div data-tauri-drag-region style={styles.titleBar}>
      <div style={{ flex: 1 }} data-tauri-drag-region />
      <div style={styles.windowBtns}>
        <button onClick={handleMinimize} style={styles.winBtn} title="Minimize">
          <Minus size={16} />
        </button>
        <button onClick={handleMaximize} style={styles.winBtn} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3.5" y="5" width="8" height="8" rx="1" />
              <path d="M5.5 5V3.5a1 1 0 011-1H12a1 1 0 011 1V9a1 1 0 01-1 1h-1.5" />
            </svg>
          ) : (
            <Square size={14} />
          )}
        </button>
        <button onClick={handleClose} style={styles.winBtnClose} title="Close">
          <X size={16} />
        </button>
      </div>
    </div>
  );

  if (view === 'magic-link-sent') {
    return (
      <div style={styles.container}>
        <div style={styles.textureBg} />
        {windowControls}
        <div style={styles.content}>
          <div style={styles.card}>
            <div style={styles.iconWrap}>
              <Mail size={32} style={{ color: '#2DB87A' }} />
            </div>
            <h1 style={styles.title}>Check your email</h1>
            <p style={styles.subtitle}>
              We sent a magic link to <strong style={{ color: '#DCE0E4' }}>{magicLinkEmail}</strong>.
              Click the link in the email to sign in.
            </p>
            <p style={styles.hint}>Didn't receive it? Check your spam folder.</p>
            <button
              style={styles.secondaryBtn}
              onClick={() => { clearError(); setView('login'); }}
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.textureBg} />
      {windowControls}
      <div style={styles.content}>
        <div style={styles.card}>
          <div style={styles.logoWrap}>
            <img src={logoDark} alt="omnirun" style={{ height: 130 }} />
          </div>
          <h1 style={styles.title}>Welcome back</h1>
          <p style={styles.subtitle}>Sign in to your omnirun account</p>

          {authError && (
            <div style={styles.errorBox}>{authError}</div>
          )}

          <form onSubmit={handleLogin} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email</label>
              <div style={styles.inputWrap}>
                <Mail size={16} style={styles.inputIcon} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={styles.input}
                  autoFocus
                  disabled={isLoading}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Password</label>
              <div style={styles.inputWrap}>
                <Lock size={16} style={styles.inputIcon} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={styles.input}
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              type="submit"
              style={styles.primaryBtn}
              disabled={isLoading || !email.trim() || !password.trim()}
            >
              {isLoading ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div style={styles.divider}>
            <span style={styles.dividerLine} />
            <span style={styles.dividerText}>or</span>
            <span style={styles.dividerLine} />
          </div>

          <form onSubmit={handleMagicLink}>
            <button type="submit" style={styles.magicLinkBtn} disabled={isLoading}>
              <Mail size={16} />
              Sign in with magic link
            </button>
          </form>

          <p style={styles.footerText}>
            Don't have an account?{' '}
            <button style={styles.linkBtn} onClick={() => { clearError(); setView('signup'); }}>
              Create one
            </button>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: '100vh',
    backgroundColor: '#2F3238',
    position: 'relative' as const,
    fontFamily: "'Sora', sans-serif",
  },
  textureBg: {
    position: 'absolute' as const,
    inset: 0,
    backgroundImage: `url(${texture})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: 0.05,
    pointerEvents: 'none' as const,
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    height: 40,
    position: 'relative' as const,
    zIndex: 10,
    WebkitAppRegion: 'drag' as any,
  },
  windowBtns: {
    display: 'flex',
    alignItems: 'center',
    WebkitAppRegion: 'no-drag' as any,
  },
  winBtn: {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: '#6B7280',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
  },
  winBtnClose: {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: '#6B7280',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    position: 'relative' as const,
    zIndex: 1,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    background: 'rgba(56, 60, 67, 0.55)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(85, 91, 99, 0.5)',
    borderRadius: 12,
    padding: 28,
  },
  logoWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#DCE0E4',
    fontSize: 24,
    fontWeight: 700,
    textAlign: 'center' as const,
    margin: '0 0 8px 0',
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center' as const,
    margin: '0 0 24px 0',
    lineHeight: 1.5,
  },
  hint: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center' as const,
    margin: '12px 0 24px 0',
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 16,
    color: '#EF4444',
    fontSize: 13,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  label: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: 500,
  },
  inputWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute' as const,
    left: 12,
    color: '#6B7280',
    pointerEvents: 'none' as const,
  },
  input: {
    width: '100%',
    background: '#262A2F',
    border: '1px solid #4A4F57',
    borderRadius: 8,
    padding: '10px 14px 10px 36px',
    color: '#DCE0E4',
    fontSize: 14,
    outline: 'none',
    fontFamily: "'Sora', sans-serif",
    transition: 'border-color 150ms ease',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: '#2DB87A',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 150ms ease',
    fontFamily: "'Sora', sans-serif",
    marginTop: 4,
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'transparent',
    color: '#9CA3AF',
    border: '1px solid #4A4F57',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
    fontFamily: "'Sora', sans-serif",
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: '#4A4F57',
  },
  dividerText: {
    color: '#6B7280',
    fontSize: 12,
  },
  magicLinkBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    background: 'transparent',
    color: '#DCE0E4',
    border: '1px solid #4A4F57',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 150ms ease, border-color 150ms ease',
    fontFamily: "'Sora', sans-serif",
  },
  footerText: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 20,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#2DB87A',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    fontFamily: "'Sora', sans-serif",
  },
};