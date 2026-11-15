import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  LockKeyhole,
  Mail,
  Sparkles,
} from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import { api } from '../lib/api';

/**
 * Test mode: one read-only student account is shipped with the demo so the
 * portal can be checked without provisioning a login first.
 */
const TEST_ACCOUNT = {
  email: '170001@students.xchool.edu.in',
  password: 'Xchool@123',
  name: 'Ishita Gandhi',
  className: '10-A',
};

export default function Login() {
  const { session, login } = useStudentData();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(TEST_ACCOUNT.email);
  const [password, setPassword] = useState(TEST_ACCOUNT.password);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState('');
  const [checking, setChecking] = useState(true);

  const checkConfig = async () => {
    setChecking(true);
    try {
      setConfig(await api.publicConfig());
      setConfigError('');
    } catch (loadError) {
      setConfigError(loadError.message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    document.title = 'Sign in · Xchool Student';
    checkConfig();
    // The switch is a school-wide flag; one read on mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (session) return <Navigate to="/" replace />;

  if (config && config.studentPortalEnabled === false) {
    return (
      <div className="login-screen">
        <div className="login-orb login-orb-one" aria-hidden="true" />
        <div className="login-orb login-orb-two" aria-hidden="true" />
        <div className="login-content">
          <div className="login-brand">
            <span className="login-logo">
              <img src={`${import.meta.env.BASE_URL}school-logo.jpg`} alt="Xchool crest" />
            </span>
            <div>
              <strong>Xchool</strong>
              <small>Student Portal</small>
            </div>
          </div>

          <section className="login-card login-closed" aria-live="polite">
            <span className="login-closed-icon">
              <LockKeyhole size={24} />
            </span>
            <h2>Portal closed</h2>
            <p>
              {config.message ||
                'The school has switched the student portal off. Please contact the school office.'}
            </p>
            {config.schoolName ? <small>{config.schoolName}</small> : null}
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={checkConfig}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </section>
        </div>
      </div>
    );
  }

  const go = () => navigate(location.state?.from || '/', { replace: true });

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

  const demoLogin = async () => {
    setEmail(TEST_ACCOUNT.email);
    setPassword(TEST_ACCOUNT.password);
    setError('');
    setBusy(true);
    try {
      await login(TEST_ACCOUNT.email, TEST_ACCOUNT.password);
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
            <img src={`${import.meta.env.BASE_URL}school-logo.jpg`} alt="Xchool crest" />
          </span>
          <div>
            <strong>Xchool</strong>
            <small>Student Portal</small>
          </div>
        </div>

        <div className="login-hero">
          <span className="login-kicker">
            <Sparkles size={14} />
            Your school, in one place
          </span>
          <h1>
            Learn today,
            <br />
            grow every day.
          </h1>
          <p>
            Your timetable, attendance, results, syllabus and report card — always
            with you, even on a slow connection.
          </p>
          <div className="login-features">
            <span>
              <CalendarCheck2 size={15} /> Attendance at a glance
            </span>
            <span>
              <GraduationCap size={15} /> Results and progress
            </span>
            <span>
              <CheckCircle2 size={15} /> Report card ready to print
            </span>
          </div>
        </div>

        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <h2>Welcome back</h2>
            <p>Sign in with the school account issued to you.</p>
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
                placeholder="you@school.edu"
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

          <div className="login-divider">
            <span>test mode</span>
          </div>
          <button type="button" className="demo-account" onClick={demoLogin} disabled={busy}>
            <span className="avatar" style={{ background: '#4338CA', width: 38, height: 38, fontSize: 12 }}>
              IG
            </span>
            <span>
              <strong>Continue as {TEST_ACCOUNT.name}</strong>
              <small>{TEST_ACCOUNT.className} · read-only sample account</small>
            </span>
            <ArrowRight size={17} />
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
