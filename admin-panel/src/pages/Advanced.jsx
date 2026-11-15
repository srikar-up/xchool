import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Gauge,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { api } from '../lib/api';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import { relativeTime } from '../lib/format';

const REFRESH_MS = 10_000;

function roleLabel(account) {
  return account.kind === 'student' ? 'Student' : 'Staff';
}

function accountLabel(account) {
  return account.name || account.id;
}

export default function Advanced() {
  const { data, permissions, refresh, notify, user } = useAppData();
  const [portalOn, setPortalOn] = useState(data.meta.studentPortalEnabled !== false);
  const [savingPortal, setSavingPortal] = useState(false);
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const ignore = useRef(false);

  useEffect(() => {
    setPortalOn(data.meta.studentPortalEnabled !== false);
  }, [data.meta.studentPortalEnabled]);

  const loadTelemetry = useCallback(
    async (quiet = false) => {
      if (!permissions.superAdmin) return;
      if (!quiet) setLoading(true);
      try {
        const payload = await api.getTelemetry();
        if (!ignore.current) {
          setTelemetry(payload);
          setUpdatedAt(new Date());
          setError('');
        }
      } catch (loadError) {
        if (!ignore.current) setError(loadError.message);
      } finally {
        if (!ignore.current && !quiet) setLoading(false);
      }
    },
    [permissions.superAdmin]
  );

  useEffect(() => {
    ignore.current = false;
    if (!permissions.superAdmin) return undefined;
    loadTelemetry();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadTelemetry(true);
    }, REFRESH_MS);
    return () => {
      ignore.current = true;
      clearInterval(timer);
    };
  }, [loadTelemetry, permissions.superAdmin]);

  const togglePortal = async () => {
    const next = !portalOn;
    setSavingPortal(true);
    try {
      await api.setStudentPortal(next);
      setPortalOn(next);
      notify(
        next ? 'Student app is open again.' : 'Student app switched off for everyone.',
        next ? 'success' : 'info'
      );
      refresh().catch(() => {});
      loadTelemetry(true);
    } catch (toggleError) {
      notify(toggleError.message, 'error');
    } finally {
      setSavingPortal(false);
    }
  };

  const accounts = useMemo(() => {
    const list = telemetry?.accounts || [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (account) =>
        accountLabel(account).toLowerCase().includes(needle) ||
        String(account.id).toLowerCase().includes(needle) ||
        roleLabel(account).toLowerCase().includes(needle)
    );
  }, [telemetry, filter]);

  const openBlock = (account) => {
    setTarget(account);
    setReason(account.blocked ? '' : '');
  };

  const submitBlock = async (blocked) => {
    if (!target) return;
    setBlockBusy(true);
    try {
      await api.blockAccount({
        kind: target.kind,
        id: target.id,
        blocked,
        reason: reason.trim(),
      });
      notify(
        blocked ? `${accountLabel(target)} blocked.` : `${accountLabel(target)} unblocked.`,
        blocked ? 'info' : 'success'
      );
      setTarget(null);
      setReason('');
      loadTelemetry(true);
    } catch (blockError) {
      notify(blockError.message, 'error');
    } finally {
      setBlockBusy(false);
    }
  };

  if (!permissions.superAdmin) {
    return (
      <div className="advanced-page">
        <PageHeader
          eyebrow="System"
          title="Advanced settings"
          subtitle="Only a SuperAdmin can open the access switches and the developer console."
        />
        <section className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2>Restricted</h2>
              <p>Ask a SuperAdmin to change portal access or block an account.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const changedAt = data.meta.studentPortalChangedAt;

  return (
    <div className="advanced-page">
      <PageHeader
        eyebrow="System"
        title="Advanced settings"
        subtitle="Switch the student app on or off, watch API traffic per account, and block an account that is hammering the server."
      />

      <section className="admin-card advanced-access-card">
        <div className="admin-card-head">
          <div>
            <h2>
              <ShieldAlert size={17} /> Student app access
            </h2>
            <p>
              One switch for the whole student portal. While it is off every
              <code> /api/student/* </code> call returns 503 and the student app shows a closed
              notice. Staff, attendance and marks are unaffected.
            </p>
          </div>
          <Badge tone={portalOn ? 'success' : 'danger'} icon={portalOn ? CheckCircle2 : Ban}>
            {portalOn ? 'Open' : 'Switched off'}
          </Badge>
        </div>

        <div className="advanced-switch-row">
          <div>
            <strong>{portalOn ? 'Students can sign in' : 'Students cannot sign in'}</strong>
            <small>
              {changedAt
                ? `Last changed ${relativeTime(changedAt)}${data.meta.studentPortalChangedBy ? ` by ${data.meta.studentPortalChangedBy}` : ''}`
                : 'Never changed — the portal is open by default'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={portalOn}
            aria-label="Student app access"
            className={`advanced-switch ${portalOn ? 'on' : ''}`}
            onClick={togglePortal}
            disabled={savingPortal}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="admin-card advanced-console-card">
        <div className="admin-card-head">
          <div>
            <h2>
              <Activity size={17} /> Developer console
            </h2>
            <p>
              Authenticated calls in the last minute, per account. A tab left on a short poll or a
              retry loop shows up here before it burns the Firestore quota.
            </p>
          </div>
          <div className="advanced-console-actions">
            {updatedAt ? <span className="advanced-updated">Updated {relativeTime(updatedAt)}</span> : null}
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={() => loadTelemetry()}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="advanced-stats">
          <div className="advanced-stat">
            <Gauge size={16} />
            <div>
              <strong>{telemetry?.requestsInWindow ?? '—'}</strong>
              <span>requests / {telemetry?.windowSeconds || 60}s</span>
            </div>
          </div>
          <div className="advanced-stat">
            <Users size={16} />
            <div>
              <strong>{telemetry?.accountsTracked ?? '—'}</strong>
              <span>accounts seen</span>
            </div>
          </div>
          <div className="advanced-stat">
            <ShieldCheck size={16} />
            <div>
              <strong>{telemetry?.trackedRequests ?? '—'}</strong>
              <span>calls since this server started</span>
            </div>
          </div>
        </div>

        <div className="advanced-filter">
          <Search size={15} />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name, id or role"
            aria-label="Filter accounts"
          />
          <span className="advanced-count">
            {accounts.length} of {telemetry?.accounts?.length ?? 0}
          </span>
        </div>

        {error ? (
          <p className="advanced-error">
            <AlertTriangle size={14} /> {error}
          </p>
        ) : null}

        {accounts.length ? (
          <div className="advanced-table-wrap">
            <table className="advanced-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th className="num">Req / min</th>
                  <th className="num">Total</th>
                  <th>Last call</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={`${account.kind}:${account.id}`} className={account.blocked ? 'blocked' : ''}>
                    <td>
                      <strong>{accountLabel(account)}</strong>
                      <small>{account.id}</small>
                    </td>
                    <td>
                      <Badge tone={account.kind === 'student' ? 'brand' : 'neutral'}>
                        {roleLabel(account)}
                      </Badge>
                    </td>
                    <td className={`num ${account.requestsInWindow > 60 ? 'hot' : ''}`}>
                      {account.requestsInWindow}
                    </td>
                    <td className="num">{account.total}</td>
                    <td>
                      <code>{account.lastMethod}</code> {account.lastPath}
                    </td>
                    <td>{relativeTime(account.lastSeen)}</td>
                    <td className="actions">
                      {account.kind === 'staff' && user?.id === account.id ? (
                        <span className="advanced-self">This is you</span>
                      ) : (
                        <button
                          type="button"
                          className={`admin-btn admin-btn-sm ${account.blocked ? 'admin-btn-ghost' : 'admin-btn-danger-ghost'}`}
                          onClick={() => openBlock(account)}
                        >
                          {account.blocked ? 'Unblock' : 'Block'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="advanced-empty">
            {telemetry
              ? 'No authenticated calls recorded in this window. Open the teacher or student app and refresh to see its account here.'
              : 'Loading telemetry…'}
          </p>
        )}

        <p className="advanced-note">
          Counters live in the server isolate handling your request, so a busy school can have
          several lists. A block is permanent until you lift it: the account gets 403 on every API
          call, including teacher and student routes.
        </p>
      </section>

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={target?.blocked ? 'Unblock account' : 'Block account'}
        footer={
          <>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`admin-btn ${target?.blocked ? 'admin-btn-primary' : 'admin-btn-danger'}`}
              onClick={() => submitBlock(!target?.blocked)}
              disabled={blockBusy}
            >
              {target?.blocked ? 'Unblock' : 'Block account'}
            </button>
          </>
        }
      >
        {target ? (
          <div className="advanced-block-dialog">
            <p>
              {target.blocked
                ? `${accountLabel(target)} can use the API again immediately.`
                : `${accountLabel(target)} will get 403 on every API call until you unblock them.`}
            </p>
            {target.blocked ? null : (
              <label>
                <span>Reason (optional)</span>
                <input
                  type="text"
                  value={reason}
                  maxLength={160}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Too many /api/state calls"
                />
              </label>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
