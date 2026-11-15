import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Sparkles,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext';

const TEST_ACCOUNT = { email: 'teacher@nawazschool.edu', password: 'teacher123' };

export default function Login() {
  const { session, login } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(TEST_ACCOUNT.email);
  const [password, setPassword] = useState(TEST_ACCOUNT.password);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Sign in · Xchool Teacher';
  }, []);

  if (session) return <Navigate to="/" replace />;

  const go = () => {
    const target = location.state?.from || '/';
    navigate(target, { replace: true });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      go();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <div className="login-orb login-orb-three" aria-hidden="true" />

      <div className="login-content">
        <div className="login-brand">
          <span className="login-logo">
            <img
              src={`${import.meta.env.BASE_URL}school-logo.jpg`}
              alt="Xchool crest"
            />
          </span>
          <div>
            <strong>Xchool</strong>
            <small>Teacher Mobile Workspace</small>
          </div>
        </div>

        <div className="login-hero">
          <span className="login-kicker">
            <Sparkles size={14} />
            A calmer school day
          </span>
          <h1>
            Your classroom,
            <br />
            in your pocket.
          </h1>
          <p>
            Attendance, schedules, marks and notices — built for the few minutes
            between classes.
          </p>
          <div className="login-features">
            <span>
              <CalendarCheck2 size={15} /> One-tap roll-call
            </span>
            <span>
              <CheckCircle2 size={15} /> Works with the admin console
            </span>
          </div>
        </div>

        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <h2>Welcome back</h2>
            <p>Sign in with your school account.</p>
          </div>

          <label className="field">
            <span>School email</span>
            <div className="input-with-icon">
              <Mail size={17} />
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@nawazschool.edu"
                required
              />
            </div>
          </label>

          <label className="field">
            <span>Password</span>
            <div className="input-with-icon">
              <LockKeyhole size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="input-action"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? <span className="btn-spinner" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
            {!busy ? <ArrowRight size={18} /> : null}
          </button>

          <p className="login-hint">
            Test account: <code>{TEST_ACCOUNT.email}</code> · password{' '}
            <code>{TEST_ACCOUNT.password}</code>
          </p>
        </form>

        <p className="login-footer">Xchool · Learn. Grow. Lead.</p>
      </div>
    </div>
  );
}
