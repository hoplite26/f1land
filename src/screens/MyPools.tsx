import { useMemo, useState } from 'react';
import { useWallet, type Entry } from '@/store/wallet';
import { useNav } from '@/store/nav';
import { useLive } from '@/store/live';
import { CIRCUIT_META } from '@/data/circuits';
import { flagEmoji, fmtClock, fmtDate, fmtLap, fmtNumber, getLang, t } from '@/i18n/core';
import { Header, SubHeader } from '@/app/Header';
import { poolTexts } from '@/app/poolText';
import { settleFromReplay } from '@/app/sessionService';
import { Card, Collapsible, Segmented } from '@/ui/kit';
import { IconChevron, IconHistory, IconTrophy } from '@/ui/icons';
import type { Settlement } from '@/domain/types';
import { haptic } from '@/telegram/sdk';
import { DRIVER_BY_ID } from '@/data/teams';

type Tab = 'open' | 'settled' | 'history';

export function stateBadge(e: Entry) {
  const cls = e.state === 'WON' ? 'badge--lime' : e.state === 'LOST' ? 'badge--red' : e.state === 'VOID' ? 'badge--yellow' : e.settlement?.provisional ? 'badge--cyan' : 'badge--ghost';
  const key = e.state === 'WON' ? 'entries.won' : e.state === 'LOST' ? 'entries.lost' : e.state === 'VOID' ? 'entries.void' : e.settlement?.provisional ? 'entries.provisional' : 'entries.pending';
  return <span className={`badge ${cls}`}>{t(key)}</span>;
}

export function MyPoolsScreen() {
  const entries = useWallet((s) => s.entries);
  const txs = useWallet((s) => s.txs);
  const push = useNav((s) => s.push);
  const go = useNav((s) => s.go);
  const [tab, setTab] = useState<Tab>('open');
  const open = entries.filter((e) => e.state === 'PENDING');
  const settled = entries.filter((e) => e.state !== 'PENDING');
  return (
    <>
      <Header />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('entries.title')}</h1>
          <p className="page-sub">{t('entries.sub')}</p>
        </div>
        <span className="script-note" aria-hidden="true">
          More than a Race
        </span>
      </div>
      <Segmented<Tab>
        label={t('entries.title')}
        value={tab}
        onChange={setTab}
        options={[
          { id: 'open', label: t('entries.open'), count: open.length },
          { id: 'settled', label: t('entries.settled'), count: settled.length },
          { id: 'history', label: t('entries.history') },
        ]}
      />
      {tab === 'open' && (
        <>
          <div className="section__head" style={{ marginTop: 16 }}>
            <div>
              <h2 className="section__title">{t('entries.open')}</h2>
              <div className="muted" style={{ fontSize: 13 }}>{t('entries.openSub')}</div>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>{open.length}</span>
          </div>
          {open.length === 0 ? (
            <Card>
              <div className="empty">
                <IconTrophy className="empty__icon" />
                <div>{t('entries.empty')}</div>
                <button className="btn btn--primary" style={{ marginTop: 14 }} onClick={() => go('live')}>
                  {t('entries.emptyCta')}
                </button>
              </div>
            </Card>
          ) : (
            <div className="list">{open.map((e) => <EntryCard key={e.id} e={e} onOpen={() => push({ name: 'entry', entryId: e.id })} />)}</div>
          )}
        </>
      )}
      {tab === 'settled' && (
        <>
          <div className="section__head" style={{ marginTop: 16 }}>
            <div>
              <h2 className="section__title">{t('entries.settled')}</h2>
              <div className="muted" style={{ fontSize: 13 }}>{t('entries.settledSub')}</div>
            </div>
          </div>
          {settled.length === 0 ? <div className="empty">{t('entries.empty')}</div> : <div className="list">{settled.map((e) => <EntryCard key={e.id} e={e} onOpen={() => push({ name: 'entry', entryId: e.id })} />)}</div>}
        </>
      )}
      {tab === 'history' && (
        <div className="list" style={{ marginTop: 14 }}>
          {txs.map((x) => (
            <div key={x.id} className="card list-row">
              <IconHistory className="icon muted" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{t(`wallet.tx.${x.kind}`)}</div>
                <div className="muted num" style={{ fontSize: 11 }}>
                  {fmtDate(x.at, { day: 'numeric', month: 'short' })} · {fmtClock(x.at)} {x.entryId ? `· ${x.entryId}` : ''}
                </div>
              </div>
              <span className={`num ${x.amount >= 0 ? 'lime' : ''}`} style={{ fontWeight: 700 }}>
                {x.amount >= 0 ? '+' : ''}
                {fmtNumber(x.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EntryCard({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const lang = getLang();
  const meta = CIRCUIT_META.find((c) => c.id === e.circuitId);
  const tx = poolTexts(e.pool);
  const won = e.state === 'WON';
  return (
    <Card className={`entry ${won ? 'entry--won' : ''}`} glow={won} onClick={onOpen} ariaLabel={tx.title}>
      <div className="row">
        <span className="flag">{flagEmoji(meta?.countryCode ?? '')}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 700 }}>
            {e.meetingName[lang] || meta?.name}
          </div>
          <div className="muted ellipsis" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            {tx.title} · {fmtDate(e.createdAt, { day: 'numeric', month: 'short' })}
          </div>
        </div>
        {stateBadge(e)}
        <IconChevron size={16} />
      </div>
      <div className="entry__q">{tx.question}</div>
      <div className="entry__stats">
        <div className="kv">
          <span className="kv__v num">{e.stake}</span>
          <span className="kv__k">{t('entries.stake')}</span>
        </div>
        <div className="kv" style={{ minWidth: 0 }}>
          <span className="kv__v ellipsis" style={{ fontSize: 15 }}>{e.outcomeLabel}</span>
          <span className="kv__k">{t('entries.yourPick')}</span>
        </div>
        <div className="kv" style={{ textAlign: 'right' }}>
          <span className={`kv__v num ${won ? 'lime' : ''}`}>{e.state === 'PENDING' ? `≈${fmtNumber(Math.round(e.stake * e.estimate))}` : fmtNumber(e.payout)}</span>
          <span className="kv__k">{e.state === 'PENDING' ? t('entries.potential') : t('entries.payout')}</span>
        </div>
      </div>
      {e.settlementHistory.length > 0 && <span className="badge badge--yellow" style={{ marginTop: 8 }}>{t('entries.corrected')}</span>}
    </Card>
  );
}

const VALUE_LABELS: Record<string, string> = {
  position: 'P',
  lap_time_ms: 'lap',
  stop_duration_ms: 'stop',
  lane_duration_ms: 'lane',
  sector_time_ms: 'sector',
};

function formatValue(k: string, v: string | number | boolean | null): string {
  if (v === null) return '—';
  if (typeof v === 'number' && /_ms$/.test(k)) return k.includes('lap') || k.includes('reference') ? fmtLap(v) : `${fmtNumber(v)} ms`;
  if (typeof v === 'string' && /_at$/.test(k) && !Number.isNaN(Date.parse(v))) return fmtClock(Date.parse(v), true);
  if (typeof v === 'string' && DRIVER_BY_ID[v]) return DRIVER_BY_ID[v]!.lastName;
  return String(v);
}

export function EntryScreen({ entryId }: { entryId: string }) {
  const back = useNav((s) => s.back);
  const entry = useWallet((s) => s.entries.find((e) => e.id === entryId));
  const runner = useLive((s) => s.runner);
  const [busy, setBusy] = useState(false);
  const events = useMemo(() => {
    if (!entry?.settlement || !runner || runner.manifest.session_id !== entry.sessionId) return [];
    const ids = new Set(entry.settlement.evidence_source_event_ids);
    return runner.events.filter((e) => ids.has(e.source_event_id));
  }, [entry?.settlement, runner, entry?.sessionId]);
  if (!entry) {
    return (
      <>
        <SubHeader onBack={back} />
        <div className="empty">{t('entries.empty')}</div>
      </>
    );
  }
  const tx = poolTexts(entry.pool);
  const s = entry.settlement;
  const winner = s?.winner_outcome_id ? entry.pool.outcomes.find((o) => o.id === s.winner_outcome_id) : null;
  const isActive = runner?.manifest.session_id === entry.sessionId;
  return (
    <>
      <SubHeader onBack={back} title={t('entries.proof')} />
      <Card glow={entry.state === 'WON'}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="section__kicker">{tx.title}</span>
          {stateBadge(entry)}
        </div>
        <h1 className="pool-q__title" style={{ marginTop: 8 }}>{tx.question}</h1>
        {tx.anchor && <div className="pool-q__anchor">{tx.anchor}</div>}
        <div className="entry__stats" style={{ marginTop: 12 }}>
          <div className="kv">
            <span className="kv__k">{t('entries.yourPick')}</span>
            <span className="kv__v" style={{ fontSize: 15 }}>{entry.outcomeLabel}</span>
          </div>
          <div className="kv">
            <span className="kv__k">{t('entries.stake')}</span>
            <span className="kv__v num">{entry.stake}</span>
          </div>
          <div className="kv" style={{ textAlign: 'right' }}>
            <span className="kv__k">{entry.state === 'PENDING' ? t('entries.potential') : t('entries.payout')}</span>
            <span className={`kv__v num ${entry.state === 'WON' ? 'lime' : ''}`}>{entry.state === 'PENDING' ? `≈${Math.round(entry.stake * entry.estimate)}` : entry.payout}</span>
          </div>
        </div>
        <div className="muted num" style={{ fontSize: 11, marginTop: 10 }}>
          {t('confirm.entryId')}: {entry.id} · {entry.pool.pool_id}
        </div>
      </Card>

      {!s && entry.state === 'PENDING' && !isActive && (
        <Card className="mt">
          <div className="muted">{t('entries.awaitReplay')}</div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={async () => {
              haptic.impact('medium');
              setBusy(true);
              await settleFromReplay(entry);
              setBusy(false);
            }}
          >
            {busy ? t('ui.loading') : t('entries.settleNow')}
          </button>
        </Card>
      )}

      {s && (
        <>
          <Card className="mt">
            <div className="section__kicker">{t('entries.proof')}</div>
            <dl className="rules__dl" style={{ marginTop: 8 }}>
              {winner && (
                <>
                  <dt>{t('entries.winner')}</dt>
                  <dd>
                    <b className="lime">{t(winner.label_key, Object.fromEntries(Object.entries(winner.label_params ?? {}).map(([k, v]) => [k, typeof v === 'string' && DRIVER_BY_ID[v] ? DRIVER_BY_ID[v]!.lastName : v])))}</b>
                  </dd>
                </>
              )}
              {s.void_reason && (
                <>
                  <dt>{t('entries.voidReason')}</dt>
                  <dd>
                    <b className="yellow">{t(`f1.void.${s.void_reason.toLowerCase()}`)}</b>
                  </dd>
                </>
              )}
              <dt>{t('entries.rule')}</dt>
              <dd>{tx.rule}</dd>
              <dt>{t('pool.determinedBy')}</dt>
              <dd>{tx.determinant}</dd>
              <dt>{t('entries.determinedAt')}</dt>
              <dd className="num">{fmtClock(Date.parse(s.determined_at), true)}</dd>
              <dt>{t('entries.revision')}</dt>
              <dd className="num">
                #{s.settlement_revision} {s.provisional ? `· ${t('entries.provisional')}` : ''} · {s.template_version}
              </dd>
            </dl>
          </Card>
          <Card className="mt">
            <div className="section__kicker">{t('entries.measured')}</div>
            <div className="values">
              {Object.entries(s.normalized_values).map(([k, v]) => (
                <div key={k} className="values__row">
                  <span className="muted">{VALUE_LABELS[k] ?? k.replace(/_/g, ' ')}</span>
                  <span className="num">{formatValue(k, v)}</span>
                </div>
              ))}
              {Object.keys(s.normalized_values).length === 0 && <div className="muted">{t('f1.result.none')}</div>}
            </div>
          </Card>
          <Collapsible title={`${t('entries.evidence')} (${s.evidence_source_event_ids.length})`} defaultOpen={s.evidence_source_event_ids.length <= 4}>
            <div className="evidence">
              {s.evidence_source_event_ids.map((id) => {
                const ev = events.find((e) => e.source_event_id === id);
                return (
                  <div key={id} className="evidence__row">
                    <span className="badge badge--ghost">{ev?.type ?? 'EVENT'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="num ellipsis" style={{ fontSize: 12 }}>
                        {id}
                      </div>
                      <div className="muted num" style={{ fontSize: 11 }}>
                        rev {s.evidence_revisions[id] ?? '1'} {ev ? `· ${fmtClock(Date.parse(ev.occurred_at), true)} · ${ev.source_product}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Collapsible>
          {entry.settlementHistory.length > 0 && (
            <Card className="mt">
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge--yellow">{t('entries.corrected')}</span>
              </div>
              {entry.settlementHistory.map((h: Settlement) => (
                <div key={h.settlement_revision} className="values__row" style={{ marginTop: 8 }}>
                  <span className="muted">
                    {t('entries.prevValue')} · #{h.settlement_revision}
                  </span>
                  <span className="num">{h.winner_outcome_id ?? h.void_reason}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </>
  );
}
