import { useMemo, useState, type ReactNode } from 'react';
import { useWallet, type Entry, type Tx } from '@/store/wallet';
import { useNav } from '@/store/nav';
import { useLive } from '@/store/live';
import { CIRCUIT_META } from '@/data/circuits';
import { flagEmoji, fmtClock, fmtDate, fmtGap, fmtLap, fmtNumber, fmtSec, getLang, has, t } from '@/i18n/core';
import { Header, SubHeader } from '@/app/Header';
import { outcomeLabel, poolTexts } from '@/app/poolText';
import { usePools } from '@/demo/poolEngine';
import { oddsText } from '@/ui/bet/parts';
import { settleFromReplay } from '@/app/sessionService';
import { Card, Collapsible, Segmented } from '@/ui/kit';
import { IconChevron, IconClose, IconCoin, IconGift, IconRefund, IconTicket, IconTimer, IconTrophy, IconPlus } from '@/ui/icons';
import type { Settlement } from '@/domain/types';
import { haptic } from '@/telegram/sdk';
import { DRIVER_BY_ID } from '@/data/teams';
import '@/styles/mypools.css';

type Tab = 'open' | 'settled' | 'history';

export function stateBadge(e: Entry) {
  const cls = e.state === 'WON' ? 'badge--lime' : e.state === 'LOST' ? 'badge--red' : e.state === 'VOID' ? 'badge--yellow' : e.settlement?.provisional ? 'badge--cyan' : 'badge--ghost';
  const key = e.state === 'WON' ? 'entries.won' : e.state === 'LOST' ? 'entries.lost' : e.state === 'VOID' ? 'entries.void' : e.settlement?.provisional ? 'entries.provisional' : 'entries.pending';
  return <span className={`badge ${cls}`}>{t(key)}</span>;
}

function StateIcon({ e, size = 20 }: { e: Entry; size?: number }) {
  if (e.state === 'WON') return <IconTrophy size={size} />;
  if (e.state === 'LOST') return <IconClose size={size} />;
  if (e.state === 'VOID') return <IconRefund size={size} />;
  return <IconTimer size={size} />;
}

const potential = (e: Entry) => Math.round(e.stake * e.estimate);

export function MyPoolsScreen() {
  const entries = useWallet((s) => s.entries);
  const txs = useWallet((s) => s.txs);
  const push = useNav((s) => s.push);
  const go = useNav((s) => s.go);
  const [tab, setTab] = useState<Tab>('open');
  const open = entries.filter((e) => e.state === 'PENDING');
  const settled = entries.filter((e) => e.state !== 'PENDING');
  const inPlay = open.reduce((a, e) => a + e.stake, 0);
  const wonTotal = settled.reduce((a, e) => a + (e.state === 'WON' ? e.payout : 0), 0);
  const decided = settled.filter((e) => e.state === 'WON' || e.state === 'LOST');
  const hitRate = decided.length ? Math.round((decided.filter((e) => e.state === 'WON').length / decided.length) * 100) : null;
  const openEntry = (e: Entry) => push({ name: 'entry', entryId: e.id });

  return (
    <div className="mypools">
      <Header />
      <h1 className="page-title">{t('entries.title')}</h1>
      <p className="page-sub">{t('entries.sub')}</p>

      <div className="mp-stats">
        <div className="mp-stat">
          <span className="mp-stat__k">{t('mp.inPlay')}</span>
          <span className="mp-stat__v num">
            <IconCoin size={14} className="icon cyan" /> {fmtNumber(inPlay)}
          </span>
        </div>
        <div className="mp-stat">
          <span className="mp-stat__k">{t('mp.wonTotal')}</span>
          <span className="mp-stat__v num lime">+{fmtNumber(wonTotal)}</span>
        </div>
        <div className="mp-stat">
          <span className="mp-stat__k">{t('mp.hitRate')}</span>
          <span className="mp-stat__v num">{hitRate === null ? '—' : `${hitRate}%`}</span>
        </div>
      </div>

      <Segmented<Tab>
        label={t('entries.title')}
        value={tab}
        onChange={setTab}
        options={[
          { id: 'open', label: t('entries.open'), count: open.length },
          { id: 'settled', label: t('pd.tab.settled'), count: settled.length },
          { id: 'history', label: t('entries.history') },
        ]}
      />

      <div className="mp-panel" key={tab}>
        {tab === 'open' && (
          <>
            <div className="mp-head">
              <span className="mp-head__sub muted">{t('entries.openSub')}</span>
            </div>
            {open.length === 0 ? (
              <EmptyState
                icon={<IconTicket size={34} />}
                title={t('entries.empty')}
                sub={t('mp.emptyOpenSub')}
                action={
                  <button
                    className="btn btn--primary"
                    onClick={() => {
                      haptic.impact('light');
                      go('live');
                    }}
                  >
                    {t('entries.emptyCta')}
                  </button>
                }
              />
            ) : (
              <div className="list">
                {open.map((e) => (
                  <EntryCard key={e.id} e={e} onOpen={() => openEntry(e)} />
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'settled' && (
          <>
            <div className="mp-head">
              <span className="mp-head__sub muted">{t('entries.settledSub')}</span>
            </div>
            {settled.length === 0 ? (
              <EmptyState icon={<IconTrophy size={34} />} title={t('mp.emptySettled')} sub={t('mp.emptySettledSub')} />
            ) : (
              <div className="list">
                {settled.map((e) => (
                  <EntryCard key={e.id} e={e} onOpen={() => openEntry(e)} />
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'history' && (
          <div className="list mp-history">
            {txs.length === 0 && <EmptyState icon={<IconCoin size={34} />} title={t('mp.emptyHistory')} />}
            {txs.map((x) => (
              <TxRow key={x.id} x={x} onOpen={x.entryId && entries.some((e) => e.id === x.entryId) ? () => push({ name: 'entry', entryId: x.entryId! }) : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="card empty mp-empty">
      <div className="empty__orb">{icon}</div>
      <div className="empty__title">{title}</div>
      {sub && <div className="empty__sub">{sub}</div>}
      {action && <div className="mp-empty__action">{action}</div>}
    </div>
  );
}

const TX_ICON: Record<Tx['kind'], { icon: (p: { size?: number }) => ReactNode; tone: string }> = {
  stake: { icon: IconTicket, tone: 'cyan' },
  payout: { icon: IconTrophy, tone: 'lime' },
  refund: { icon: IconRefund, tone: 'yellow' },
  bonus: { icon: IconGift, tone: 'purple' },
  topup: { icon: IconPlus, tone: 'lime' },
};

function TxRow({ x, onOpen }: { x: Tx; onOpen?: () => void }) {
  const { icon: Icon, tone } = TX_ICON[x.kind];
  const body = (
    <>
      <span className={`mp-tx__icon mp-tx__icon--${tone}`}>
        <Icon size={18} />
      </span>
      <div className="mp-tx__main">
        <div className="mp-tx__title">{t(`wallet.tx.${x.kind}`)}</div>
        <div className="muted num mp-tx__meta ellipsis">
          {fmtDate(x.at, { day: 'numeric', month: 'short' })} · {fmtClock(x.at)}
          {x.entryId ? ` · ${x.entryId}` : ''}
        </div>
      </div>
      <span className={`num mp-tx__amt ${x.amount > 0 ? 'lime' : x.amount < 0 ? 'mp-tx__amt--neg' : ''}`}>
        {x.amount > 0 ? '+' : x.amount < 0 ? '−' : ''}
        {fmtNumber(Math.abs(x.amount))}
      </span>
      {onOpen && <IconChevron size={14} className="icon muted" />}
    </>
  );
  return onOpen ? (
    <Card className="mp-tx" pad={false} onClick={onOpen} ariaLabel={t(`wallet.tx.${x.kind}`)}>
      {body}
    </Card>
  ) : (
    <div className="card mp-tx">{body}</div>
  );
}

function EntryCard({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const lang = getLang();
  const meta = CIRCUIT_META.find((c) => c.id === e.circuitId);
  const tx = poolTexts(e.pool);
  const state = e.state.toLowerCase();
  return (
    <Card className={`ticket ticket--${state}`} pad={false} glow={e.state === 'WON'} onClick={onOpen} ariaLabel={`${tx.question} · ${t(`entries.${state === 'pending' ? 'pending' : state}`)}`}>
      <div className="ticket__main">
        <span className="ticket__icon">
          <StateIcon e={e} />
        </span>
        <div className="ticket__info">
          <div className="ticket__kicker ellipsis">{tx.title}</div>
          <div className="ticket__q clamp-2">{tx.question}</div>
          <div className="ticket__meta">
            <span className="ticket__flag">{flagEmoji(meta?.countryCode ?? '')}</span>
            {e.meetingName[lang] || meta?.name} · {fmtDate(e.createdAt, { day: 'numeric', month: 'short' })} {fmtClock(e.createdAt)}
          </div>
        </div>
        <div className="ticket__side">
          {stateBadge(e)}
          <IconChevron size={16} className="icon muted" />
        </div>
      </div>
      <div className="ticket__perf" aria-hidden="true" />
      <div className="ticket__stats">
        <div className="ticket__stat ticket__stat--pick">
          <span className="ticket__k">{t('entries.yourPick')}</span>
          <span className="ticket__v">{e.outcomeLabel}</span>
        </div>
        <div className="ticket__stat">
          <span className="ticket__k">{t('entries.stake')}</span>
          <span className="ticket__v num">{fmtNumber(e.stake)}</span>
        </div>
        <div className="ticket__stat ticket__stat--end">
          <span className="ticket__k">{e.state === 'PENDING' ? t('entries.potential') : t('entries.payout')}</span>
          <span className="ticket__v ticket__v--pay num">{e.state === 'PENDING' ? `≈${fmtNumber(potential(e))}` : fmtNumber(e.payout)}</span>
        </div>
      </div>
      {e.settlementHistory.length > 0 && (
        <div className="ticket__note">
          <span className="badge badge--yellow">{t('entries.corrected')}</span>
        </div>
      )}
    </Card>
  );
}

const COMPOUNDS = new Set(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET']);
const OCCUPANCY = new Set(['ON_TRACK', 'PIT_LANE', 'GARAGE']);

function valueLabel(k: string): string {
  const key = `pd.val.${k}`;
  return has(key) ? t(key) : k.replace(/_/g, ' ');
}

/** Measured settlement values in the user's units: lap times, seconds, gaps, names, compounds. */
function formatValue(k: string, v: string | number | boolean | null): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? t('pd.yes') : t('pd.no');
  if (typeof v === 'number' && /_ms$/.test(k)) {
    if (k.includes('lap') || k.includes('reference')) return fmtLap(v);
    if (k.includes('delta') || k.includes('gap')) return `${fmtGap(v)} ${t('pl.unit.s')}`;
    return `${fmtSec(v)} ${t('pl.unit.s')}`;
  }
  if (typeof v === 'number' && k === 'distance_m') return `${fmtNumber(v)} ${t('pd.unit.m')}`;
  if (typeof v === 'number' && k.startsWith('position')) return `P${v}`;
  if (typeof v === 'number') return fmtNumber(v);
  if (/^\d{4}-\d\d-\d\dT[\d:.]+Z?$/.test(v) && !Number.isNaN(Date.parse(v))) return fmtClock(Date.parse(v), true);
  if (DRIVER_BY_ID[v]) return DRIVER_BY_ID[v]!.lastName;
  if (COMPOUNDS.has(v)) return t(`tyre.${v.toLowerCase()}`);
  if (OCCUPANCY.has(v)) return t(`occ.${v}`);
  if (/^S[123]$/.test(v)) return t('f1.outcome.sector', { sector: v.slice(1) });
  if (v === 'PIT') return t('f1.location.pit');
  if (has(`pd.status.${v}`)) return t(`pd.status.${v}`);
  return v;
}

export function EntryScreen({ entryId }: { entryId: string }) {
  const back = useNav((s) => s.back);
  const entry = useWallet((s) => s.entries.find((e) => e.id === entryId));
  const runner = useLive((s) => s.runner);
  const go = useNav((s) => s.go);
  const push = useNav((s) => s.push);
  const poolLive = usePools((s) => s.pools.some((p) => p.pool.pool_id === entry?.poolId));
  const [busy, setBusy] = useState(false);
  const events = useMemo(() => {
    if (!entry?.settlement || !runner || runner.manifest.session_id !== entry.sessionId) return [];
    const ids = new Set(entry.settlement.evidence_source_event_ids);
    return runner.events.filter((e) => ids.has(e.source_event_id));
  }, [entry?.settlement, runner, entry?.sessionId]);
  const lang = getLang();
  if (!entry) {
    return (
      <div className="mypools">
        <SubHeader onBack={back} title={t('mp.ticket')} />
        <EmptyState
          icon={<IconTicket size={34} />}
          title={t('pd.entryGone')}
          sub={t('mp.emptyOpenSub')}
          action={
            <button
              className="btn btn--primary"
              onClick={() => {
                haptic.impact('light');
                go('pools');
              }}
            >
              {t('entries.title')}
            </button>
          }
        />
      </div>
    );
  }
  const tx = poolTexts(entry.pool);
  const s = entry.settlement;
  const winner = s?.winner_outcome_id ? entry.pool.outcomes.find((o) => o.id === s.winner_outcome_id) : null;
  const isActive = runner?.manifest.session_id === entry.sessionId;
  const meta = CIRCUIT_META.find((c) => c.id === entry.circuitId);
  const state = entry.state.toLowerCase();
  const mult = entry.finalMultiplier ?? entry.estimate;
  const headline = entry.state === 'WON' ? t('mp.youWon') : entry.state === 'LOST' ? t('mp.notThisTime') : entry.state === 'VOID' ? t('mp.refunded') : t('mp.awaiting');
  const amount =
    entry.state === 'WON' ? `+${fmtNumber(entry.payout)}` : entry.state === 'LOST' ? `−${fmtNumber(entry.stake)}` : entry.state === 'VOID' ? fmtNumber(entry.payout) : `≈${fmtNumber(potential(entry))}`;

  return (
    <div className="mypools">
      <SubHeader onBack={back} title={t('mp.ticket')} right={stateBadge(entry)} />

      <div className={`card xticket xticket--${state}`}>
        <div className="xticket__hero">
          <span className="xticket__orb">
            <StateIcon e={entry} size={28} />
          </span>
          <div className="xticket__headline">
            <span className="xticket__label">{headline}</span>
            <span className="xticket__amount num">
              {amount} <small>PULSE</small>
            </span>
          </div>
        </div>
        <div className="xticket__body">
          <div className="ticket__kicker">{tx.title}</div>
          <h1 className="xticket__q">{tx.question}</h1>
          {tx.anchor && <div className="xticket__anchor">{tx.anchor}</div>}
          <div className="ticket__meta">
            <span className="ticket__flag">{flagEmoji(meta?.countryCode ?? '')}</span>
            {entry.meetingName[lang] || meta?.name}
          </div>
        </div>
        <div className="ticket__perf" aria-hidden="true" />
        <div className="xticket__grid">
          <div className="xticket__cell xticket__cell--pick">
            <span className="ticket__k">{t('entries.yourPick')}</span>
            <span className="xticket__v">{entry.outcomeLabel}</span>
          </div>
          <div className="xticket__cell">
            <span className="ticket__k">{t('entries.stake')}</span>
            <span className="xticket__v num">
              <IconCoin size={15} className="icon lime" /> {fmtNumber(entry.stake)}
            </span>
          </div>
          <div className="xticket__cell">
            <span className="ticket__k">{entry.finalMultiplier !== null ? t('mp.finalMultiplier') : t('mp.estMultiplier')}</span>
            <span className="xticket__v num cyan">{oddsText(mult)}</span>
          </div>
          <div className="xticket__cell xticket__cell--pay">
            <span className="ticket__k">{entry.state === 'PENDING' ? t('entries.potential') : t('entries.payout')}</span>
            <span className="xticket__v xticket__v--pay num">{entry.state === 'PENDING' ? `≈${fmtNumber(potential(entry))}` : fmtNumber(entry.payout)}</span>
          </div>
        </div>
        <div className="xticket__ids num">
          <span>
            {t('mp.placedAt')} {fmtDate(entry.createdAt, { day: 'numeric', month: 'short' })} {fmtClock(entry.createdAt, true)}
          </span>
          <span className="ellipsis">
            {t('mp.ticketId')} {entry.id}
          </span>
          <span className="ellipsis">
            {t('mp.poolId')} {entry.pool.pool_id}
          </span>
        </div>
        <div className="xticket__chequer" aria-hidden="true" />
      </div>

      {isActive && (
        <div className="xticket-actions">
          {poolLive && (
            <button
              className="btn btn--primary"
              onClick={() => {
                haptic.impact('light');
                push({ name: 'pool', channelId: entry.channelId, poolId: entry.poolId });
              }}
            >
              {t('pd.toPool')}
            </button>
          )}
          <button
            className={`btn ${poolLive ? 'btn--ghost' : 'btn--primary'}`}
            onClick={() => {
              haptic.impact('light');
              go('live');
            }}
          >
            {t('pd.watch')}
          </button>
        </div>
      )}

      {!s && entry.state === 'PENDING' && !isActive && (
        <Card className="mt xticket-await">
          <div className="row">
            <span className="loader-ring xticket-await__ring" />
            <div className="muted">{t('entries.awaitReplay')}</div>
          </div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 12 }}
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
          <Card className="mt proof">
            <div className="proof__title">{t('entries.proof')}</div>
            {winner && (
              <ProofRow k={t('entries.winner')}>
                <b className="lime">{outcomeLabel(winner, entry.pool.market_id)}</b>
              </ProofRow>
            )}
            {s.void_reason && (
              <ProofRow k={t('entries.voidReason')}>
                <b className="yellow">{t(`f1.void.${s.void_reason.toLowerCase()}`)}</b>
              </ProofRow>
            )}
            <ProofRow k={t('entries.rule')} block>
              {tx.rule}
            </ProofRow>
            <ProofRow k={t('pool.determinedBy')} block>
              {tx.determinant}
            </ProofRow>
            <ProofRow k={t('entries.determinedAt')}>
              <span className="num">{fmtClock(Date.parse(s.determined_at), true)}</span>
            </ProofRow>
            <ProofRow k={t('entries.revision')}>
              <span className="num">
                #{s.settlement_revision} {s.provisional ? `· ${t('entries.provisional')}` : ''} · {s.template_version}
              </span>
            </ProofRow>
          </Card>
          <Card className="mt">
            <div className="proof__title">{t('entries.measured')}</div>
            <div className="values">
              {Object.entries(s.normalized_values).map(([k, v]) => (
                <div key={k} className="values__row">
                  <span className="muted">{valueLabel(k)}</span>
                  <span className="num values__v">{formatValue(k, v)}</span>
                </div>
              ))}
              {Object.keys(s.normalized_values).length === 0 && <div className="muted">{t('f1.result.none')}</div>}
            </div>
          </Card>
          <div className="mt">
            <Collapsible title={`${t('entries.evidence')} (${s.evidence_source_event_ids.length})`} defaultOpen={s.evidence_source_event_ids.length <= 4}>
              <div className="evidence">
                {s.evidence_source_event_ids.map((id) => {
                  const ev = events.find((e) => e.source_event_id === id);
                  return (
                    <div key={id} className="evidence__row">
                      <span className="evidence__dot" aria-hidden="true" />
                      <div className="evidence__main">
                        <div className="evidence__type">{ev?.type ?? 'EVENT'}</div>
                        <div className="num ellipsis evidence__id">{id}</div>
                        <div className="muted num evidence__meta">
                          rev {s.evidence_revisions[id] ?? '1'} {ev ? `· ${fmtClock(Date.parse(ev.occurred_at), true)} · ${ev.source_product}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          </div>
          {entry.settlementHistory.length > 0 && (
            <Card className="mt">
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge--yellow">{t('entries.corrected')}</span>
              </div>
              <div className="values">
                {entry.settlementHistory.map((h: Settlement) => {
                  const o = h.winner_outcome_id ? entry.pool.outcomes.find((x) => x.id === h.winner_outcome_id) : null;
                  return (
                    <div key={h.settlement_revision} className="values__row">
                      <span className="muted">
                        {t('entries.prevValue')} · #{h.settlement_revision}
                      </span>
                      <span className="values__v">{o ? outcomeLabel(o, entry.pool.market_id) : h.void_reason ? t(`f1.void.${h.void_reason.toLowerCase()}`) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ProofRow({ k, children, block }: { k: string; children: ReactNode; block?: boolean }) {
  return (
    <div className={`proof__row ${block ? 'proof__row--block' : ''}`}>
      <span className="proof__k">{k}</span>
      <span className="proof__v">{children}</span>
    </div>
  );
}
