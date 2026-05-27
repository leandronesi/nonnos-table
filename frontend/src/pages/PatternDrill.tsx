import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate, useNavigate } from "react-router-dom";
import { ChevronRight, CheckCircle2, XCircle, AlertCircle, ListChecks } from "lucide-react";
import type { PlayerModel, PositionRow } from "../types";
import { PageShell } from "./PageShell";
import { PositionPuzzle } from "../session/WarmupGuidato";
import { buildPatterns, categoryColor, categoryLabel } from "../patterns";
import {
  startDrillRun, logDrillPosition, finishDrillRun, type DrillVerdict,
} from "../session/drillLog";
import { advanceQueue, queuePosition, clearQueue } from "../session/drillQueue";

interface Props {
  pm: PlayerModel;
}

const MAX_POSITIONS_PER_RUN = 5;

/**
 * Pattern drill — il loop di learning vero.
 *
 * URL: /patterns/:key/drill
 *
 * L'utente clicca "Allena questo pattern" → vede in sequenza fino a 5 posizioni
 * di QUEL pattern, una dopo l'altra. Ogni posizione è un PositionPuzzle senza
 * hint (drill modality). Verdetti tracciati nel drill log → SRS evolution.
 *
 * Al termine: riepilogo verdetti + CTA "Torna al pattern" / "Allena un altro".
 */
export function PatternDrill({ pm }: Props) {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const decoded = key ? decodeURIComponent(key) : "";

  const pattern = useMemo(
    () => buildPatterns(pm).find((p) => p.key === decoded) ?? null,
    [pm, decoded],
  );

  // Posizioni del drill: max 5 ordinate per cp_loss desc (le piu` pesanti prima).
  const positions = useMemo<PositionRow[]>(() => {
    if (!pattern) return [];
    return pattern.positions
      .slice()
      .sort((a, b) => b.cp_loss - a.cp_loss)
      .slice(0, MAX_POSITIONS_PER_RUN);
  }, [pattern]);

  const [idx, setIdx] = useState(0);
  const [verdicts, setVerdicts] = useState<DrillVerdict[]>([]);

  // Avvia la drill run alla prima posizione
  useEffect(() => {
    if (pattern && positions.length > 0) {
      startDrillRun(pattern.key, pattern.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern?.key]);

  if (!pattern) return <Navigate to="/patterns" replace />;

  if (positions.length === 0) {
    return (
      <PageShell title={`Allena: ${pattern.name}`} subtitle="Nessuna posizione disponibile">
        <div className="surface surface-padded text-center max-w-xl mx-auto">
          <h2 className="display-small">Niente posizioni mirate per ora</h2>
          <p className="text-[color:var(--color-text-soft)] mt-3 leading-relaxed">
            Il modello rileva questo pattern nelle metriche ma non ho ancora abbastanza errori
            concreti per costruirti una serie di allenamento. Gioca qualche partita e torna qui.
          </p>
          <Link to={`/patterns/${encodeURIComponent(pattern.key)}`} className="btn btn-primary mt-6">
            Torna al pattern
          </Link>
        </div>
      </PageShell>
    );
  }

  const done = idx >= positions.length;
  const current = positions[idx];
  const cColor = categoryColor(pattern.category);
  const introBanner = behavioralIntro(pattern.key, pattern.category, positions.length);

  function handleVerdict(v: DrillVerdict, p: PositionRow) {
    setVerdicts((vs) => [...vs, v]);
    logDrillPosition(pattern!.key, {
      game_id: p.game_id,
      ply: p.ply,
      verdict: v,
      attempts: 1,
      cp_loss: p.cp_loss,
      at: Date.now(),
    });
  }

  function handleNext() {
    if (idx + 1 >= positions.length) {
      finishDrillRun(pattern!.key, pattern!.name);
    }
    setIdx((i) => i + 1);
  }

  const queuePos = queuePosition(pattern.key);
  const queueSubtitle = queuePos
    ? `Pattern ${queuePos.current} di ${queuePos.total} · ${categoryLabel(pattern.category)} · ${positions.length} posizioni`
    : `${categoryLabel(pattern.category)} · ${positions.length} posizioni`;

  return (
    <PageShell title={`Allena: ${pattern.name}`} subtitle={queueSubtitle}>
      <nav className="pattern-detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/patterns">Pattern</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link to={`/patterns/${encodeURIComponent(pattern.key)}`}>{pattern.name}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>Allenamento</span>
      </nav>

      {queuePos && (
        <div className="drill-queue-banner">
          <ListChecks size={16} aria-hidden="true" />
          <span>
            Allenamento in coda: <strong>{queuePos.current} di {queuePos.total} pattern</strong>
          </span>
          <button
            onClick={() => { clearQueue(); navigate("/patterns"); }}
            className="btn btn-ghost btn-sm ml-auto"
          >
            Esci dalla coda
          </button>
        </div>
      )}

      {introBanner && (
        <div className="drill-intro-banner" style={{ borderColor: `${cColor}55`, background: `${cColor}0d` }}>
          <strong style={{ color: cColor }}>Come funziona</strong>
          <span>{introBanner}</span>
        </div>
      )}

      {/* Progress strip */}
      <div className="drill-progress">
        {positions.map((_, i) => (
          <div
            key={i}
            className={
              "drill-progress-step" +
              (i < idx ? " done" : i === idx ? " active" : "")
            }
            style={{
              background:
                i < idx
                  ? verdictPipColor(verdicts[i] ?? "ok")
                  : i === idx
                  ? cColor
                  : undefined,
            }}
            aria-label={
              i < idx
                ? `Posizione ${i + 1}: ${verdicts[i]}`
                : i === idx
                ? `Posizione ${i + 1} (in corso)`
                : `Posizione ${i + 1}`
            }
          />
        ))}
        <span className="drill-progress-label">
          {done ? "Completato" : `${idx + 1} di ${positions.length}`}
        </span>
      </div>

      {!done ? (
        <DrillRunner
          key={`${pattern.key}:${current.game_id}:${current.ply}:${idx}`}
          position={current}
          patternLabel={pattern.name}
          onComplete={(v) => handleVerdict(v, current)}
          onNext={handleNext}
        />
      ) : (
        <DrillRecap
          pattern={pattern}
          verdicts={verdicts}
          inQueue={!!queuePos}
          onAgain={() => {
            setIdx(0);
            setVerdicts([]);
            startDrillRun(pattern.key, pattern.name);
          }}
          onBack={() => navigate(`/patterns/${encodeURIComponent(pattern.key)}`)}
          onNextInQueue={() => {
            const { next } = advanceQueue(pattern.key);
            if (next) {
              navigate(`/patterns/${encodeURIComponent(next)}/drill`);
            } else {
              clearQueue();
              navigate("/patterns");
            }
          }}
        />
      )}
    </PageShell>
  );
}

/**
 * Wrapper attorno a PositionPuzzle che intercetta il verdetto reale e
 * permette di avanzare alla posizione successiva.
 */
function DrillRunner({
  position, patternLabel, onComplete, onNext,
}: {
  position: PositionRow;
  patternLabel: string;
  onComplete: (v: DrillVerdict) => void;
  onNext: () => void;
}) {
  const [verdictRecorded, setVerdictRecorded] = useState(false);
  return (
    <PositionPuzzle
      position={position}
      patternLabel={patternLabel}
      withHint={false}
      introLines={[`Allenamento ${patternLabel.toLowerCase()} — trova la mossa giusta.`]}
      onVerdict={(v) => {
        if (!verdictRecorded) {
          setVerdictRecorded(true);
          onComplete(v);
        }
      }}
      onNext={onNext}
    />
  );
}

function DrillRecap({
  pattern, verdicts, inQueue, onAgain, onBack, onNextInQueue,
}: {
  pattern: ReturnType<typeof buildPatterns>[number];
  verdicts: DrillVerdict[];
  inQueue: boolean;
  onAgain: () => void;
  onBack: () => void;
  onNextInQueue: () => void;
}) {
  const perfect = verdicts.filter((v) => v === "perfect").length;
  const ok = verdicts.filter((v) => v === "ok").length;
  const wrong = verdicts.filter((v) => v === "wrong").length;
  return (
    <div className="drill-recap">
      <h2 className="display-medium">Allenamento completato</h2>
      <p className="text-[color:var(--color-text-soft)] mt-2">
        Hai allenato <strong>{pattern.name}</strong> su {verdicts.length} posizioni.
      </p>
      <div className="drill-recap-stats">
        <div className="drill-recap-stat">
          <CheckCircle2 size={20} style={{ color: "#34d399" }} />
          <div>
            <div className="drill-recap-stat-val">{perfect}</div>
            <div className="drill-recap-stat-lbl">perfette</div>
          </div>
        </div>
        <div className="drill-recap-stat">
          <AlertCircle size={20} style={{ color: "#facc15" }} />
          <div>
            <div className="drill-recap-stat-val">{ok}</div>
            <div className="drill-recap-stat-lbl">giocabili</div>
          </div>
        </div>
        <div className="drill-recap-stat">
          <XCircle size={20} style={{ color: "#f43f5e" }} />
          <div>
            <div className="drill-recap-stat-val">{wrong}</div>
            <div className="drill-recap-stat-lbl">sbagliate</div>
          </div>
        </div>
      </div>
      <p className="drill-recap-coach">
        {perfect === verdicts.length
          ? "Tutte trovate. Oooh, bravo. Pattern dominato per oggi."
          : wrong === 0
          ? "Buon lavoro. Domani ripassa quelle giocabili per renderle perfette."
          : "Hai sbagliato qualcosa: rivedile a freddo, poi riprova."}
      </p>
      <div className="drill-recap-cta-row">
        {inQueue ? (
          <button onClick={onNextInQueue} className="btn btn-primary btn-lg">
            Vai al prossimo pattern →
          </button>
        ) : (
          <button onClick={onBack} className="btn btn-primary btn-lg">
            Torna al pattern
          </button>
        )}
        <button onClick={onAgain} className="btn btn-ghost btn-lg">
          Riallena
        </button>
        {inQueue && (
          <button onClick={onBack} className="btn btn-ghost btn-lg">
            Esci dalla coda
          </button>
        )}
      </div>
    </div>
  );
}

function verdictPipColor(v: DrillVerdict): string {
  return { perfect: "#34d399", ok: "#facc15", wrong: "#f43f5e" }[v];
}

/**
 * Per i pattern behavioral (non-tattici), spiega ALL'UTENTE come l'app abbia
 * scelto questi N posizioni concrete. Senza spiegazione, sembra random.
 */
function behavioralIntro(key: string, category: string, n: number): string | null {
  if (category === "tactic") return null;
  if (key.startsWith("phase_")) {
    const phase = key.replace(/^phase_/, "");
    const label = ({ opening: "apertura", middlegame: "mediogioco", endgame: "finale" } as Record<string, string>)[phase] ?? phase;
    return `Queste sono le ${n} posizioni in ${label} dove sei caduto più pesantemente. Rivivile, trova le mosse giuste.`;
  }
  if (key === "time_overthinking") {
    return "Posizioni dove hai pensato a lungo e hai comunque sbagliato. Stavolta: stesso tempo, ma trova la mossa giusta.";
  }
  if (key === "time_instant_moves") {
    return "Posizioni dove hai mosso senza pensare e hai sbagliato. Stavolta: prenditi 10 secondi.";
  }
  if (key === "tilt_post_blunder") {
    return `Le ${n} posizioni più pesanti delle tue partite. Ritorna lucido, una alla volta.`;
  }
  if (key === "blow_winning") {
    return "Posizioni dove avevi vantaggio e l'hai ceduto. Stavolta: trova la mossa che lo conserva.";
  }
  if (key === "color_imbalance") {
    return `Le ${n} posizioni più difficili dalle tue partite. Allenale per portare a casa anche col colore debole.`;
  }
  return "Posizioni concrete che esprimono questo pattern. Allena la mossa giusta.";
}
