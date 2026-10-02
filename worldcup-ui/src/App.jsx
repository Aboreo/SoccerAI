import React, { useState, useMemo, useEffect } from "react";

const SAMPLE_GROUPS = {
  A: ["Mexico", "South Africa", "South Korea", "Czech Republic"],
  B: ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
  C: ["United States", "Paraguay", "Australia", "Turkey"],
  D: ["Brazil", "Morocco", "Haiti", "Scotland"],
  E: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

function seededProbs(a, b) {
  let s = 0;
  const str = a + "|" + b;
  for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) % 100000;
  const r1 = (s % 1000) / 1000, r2 = ((s >> 3) % 1000) / 1000;
  let pH = 0.25 + r1 * 0.45, pD = 0.18 + r2 * 0.22;
  let pA = Math.max(0.05, 1 - pH - pD);
  const t = pH + pD + pA;
  return { pHome: pH / t, pDraw: pD / t, pAway: pA / t };
}

function buildSampleMatches(groups) {
  const out = [];
  Object.values(groups).forEach((teams) => {
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        out.push({ home: teams[i], away: teams[j], neutral: true, ...seededProbs(teams[i], teams[j]) });
  });
  return out;
}

function buildSampleStats(groups) {
  const stats = {};
  Object.values(groups).flat().forEach((t) => {
    let s = 0;
    for (let i = 0; i < t.length; i++) s = (s * 31 + t.charCodeAt(i)) % 100000;
    stats[t] = {
      elo: 1400 + (s % 500), squadValue: ((s % 300) / 100 - 1).toFixed(2),
      recentForm: (1 + (s % 200) / 100).toFixed(2), goalsFor: (0.8 + (s % 200) / 100).toFixed(2),
      goalsAgainst: (0.6 + (s % 150) / 100).toFixed(2), daysSinceLast: 4 + (s % 30),
    };
  });
  return stats;
}

function outcome(m) {
  if (m.pDraw > 0.36 && m.pDraw >= m.pHome && m.pDraw >= m.pAway) return "draw";
  return m.pHome >= m.pAway ? "home" : "away";
}
function matchKey(m) { return `${m.home}__${m.away}`; }

function computeStandings(groups, matches) {
  const table = {};
  Object.entries(groups).forEach(([g, teams]) => {
    table[g] = {};
    teams.forEach((t) => (table[g][t] = { team: t, pts: 0, w: 0, d: 0, l: 0, gp: 0, xg: 0 }));
  });
  matches.forEach((m) => {
    const g = Object.keys(groups).find((k) => groups[k].includes(m.home) && groups[k].includes(m.away));
    if (!g) return;
    const res = outcome(m), h = table[g][m.home], a = table[g][m.away];
    if (!h || !a) return;
    h.gp++; a.gp++; h.xg += m.pHome - m.pAway; a.xg += m.pAway - m.pHome;
    if (res === "home") { h.pts += 3; h.w++; a.l++; }
    else if (res === "away") { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  });
  const ranked = {};
  Object.entries(table).forEach(([g, teams]) => {
    ranked[g] = Object.values(teams).sort((x, y) => y.pts - x.pts || y.xg - x.xg);
  });
  return ranked;
}

function buildKnockout(standings) {
  const winners = [], runners = [], thirds = [];
  Object.entries(standings).forEach(([g, t]) => {
    if (t[0]) winners.push({ ...t[0], grp: g });
    if (t[1]) runners.push({ ...t[1], grp: g });
    if (t[2]) thirds.push({ ...t[2], grp: g });
  });
  thirds.sort((a, b) => b.pts - a.pts || b.xg - a.xg);
  const pool = [...winners, ...runners, ...thirds.slice(0, 8)].sort((a, b) => b.pts - a.pts || b.xg - a.xg);
  const r32 = [];
  for (let i = 0; i < pool.length / 2; i++) r32.push([pool[i], pool[pool.length - 1 - i]]);
  return r32;
}

// returns { winner, pA, pB } for a knockout tie
function tieResult(a, b, matches) {
  if (!a || !b) return { winner: a || b, pA: a ? 1 : 0, pB: b ? 1 : 0 };
  const m = matches.find((x) => (x.home === a.team && x.away === b.team) || (x.home === b.team && x.away === a.team));
  let pa;
  if (m) {
    const aHome = m.home === a.team;
    const ph = aHome ? m.pHome : m.pAway, pl = aHome ? m.pAway : m.pHome;
    pa = ph / (ph + pl);
  } else pa = 1 / (1 + Math.exp(-(a.xg - b.xg)));
  return { winner: pa >= 0.5 ? a : b, pA: pa, pB: 1 - pa };
}

function simulateBracket(r32, matches) {
  const rounds = [r32];
  let current = r32.map(([a, b]) => tieResult(a, b, matches).winner);
  while (current.length > 1) {
    const pairs = [];
    for (let i = 0; i < current.length; i += 2) pairs.push([current[i], current[i + 1]]);
    rounds.push(pairs);
    current = pairs.map(([a, b]) => tieResult(a, b, matches).winner);
  }
  return { rounds, champion: current[0] };
}

const ROUND_NAMES = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

function TeamLabel({ name, stats, children, style }) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const s = stats && stats[name];
  return (
    <span style={{ ...style, cursor: s ? "help" : "default", borderBottom: s ? "1px dotted #6b5a78" : "none" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}>
      {children || name}
      {hover && s && (
        <div style={{ ...TT.box, left: pos.x + 14, top: pos.y + 14 }}>
          <div style={TT.title}>{name}</div>
          <div style={TT.row}><span>Elo rating</span><b>{s.elo}</b></div>
          <div style={TT.row}><span>Squad value (z)</span><b>{s.squadValue}</b></div>
          <div style={TT.row}><span>Recent form</span><b>{s.recentForm}</b></div>
          <div style={TT.row}><span>Goals for / game</span><b>{s.goalsFor}</b></div>
          <div style={TT.row}><span>Goals against / game</span><b>{s.goalsAgainst}</b></div>
          <div style={TT.row}><span>Days since last</span><b>{s.daysSinceLast ?? "—"}</b></div>
        </div>
      )}
    </span>
  );
}

export default function App() {
  const [data, setData] = useState(() => {
    const g = SAMPLE_GROUPS;
    return { groups: g, matches: buildSampleMatches(g), teamStats: buildSampleStats(g) };
  });
  const [raw, setRaw] = useState("");
  const [view, setView] = useState("groups");
  const [usingSample, setUsingSample] = useState(true);
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [verdicts, setVerdicts] = useState({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("wc_verdicts");
      if (saved) setVerdicts(JSON.parse(saved));
    } catch (e) {}
  }, []);

  function saveVerdict(key, val) {
    const next = { ...verdicts };
    if (next[key] === val) delete next[key];
    else next[key] = val;
    setVerdicts(next);
    try { localStorage.setItem("wc_verdicts", JSON.stringify(next)); } catch (e) {}
  }

  const standings = useMemo(() => computeStandings(data.groups, data.matches), [data]);
  const r32 = useMemo(() => buildKnockout(standings), [standings]);
  const bracket = useMemo(() => simulateBracket(r32, data.matches), [r32, data.matches]);

  function loadJSON() {
    try {
      const parsed = JSON.parse(raw);
      setData({ groups: parsed.groups, matches: parsed.matches, teamStats: parsed.teamStats || {} });
      setUsingSample(false); setView("groups");
    } catch (e) { alert("Invalid JSON: " + e.message); }
  }

  const groupOf = (m) => Object.keys(data.groups).find((k) => data.groups[k].includes(m.home) && data.groups[k].includes(m.away));
  const filteredMatches = groupFilter === "ALL" ? data.matches : data.matches.filter((m) => groupOf(m) === groupFilter);

  const scored = Object.values(verdicts);
  const correct = scored.filter((v) => v === "correct").length;
  const wrong = scored.filter((v) => v === "wrong").length;
  const total = correct + wrong;
  const acc = total ? (correct / total) * 100 : 0;

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <header style={S.header}>
        <div style={S.kicker}>MODEL FORECAST · FIFA WORLD CUP 2026</div>
        <h1 style={S.title}>Group to Glory</h1>
        <p style={S.sub}>
          Group-stage probabilities rolled into standings, match cards, and a knockout run.
          {usingSample && " Showing sample data — load your model's JSON for real forecasts."}
        </p>
        <div style={S.tabs}>
          {["groups", "matches", "bracket", "accuracy", "load"].map((v) => (
            <button key={v} onClick={() => setView(v)} className={view === v ? "tab on" : "tab"}>
              {v === "groups" ? "Groups" : v === "matches" ? "All Matches" : v === "bracket" ? "Knockout Bracket" : v === "accuracy" ? "Accuracy" : "Load"}
            </button>
          ))}
        </div>
      </header>

      {view === "load" && (
        <div style={S.loadBox}>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#9a8ba6" }}>
            Paste the contents of <code>worldcup_predictions.json</code>:
          </p>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)}
            placeholder='{ "groups": {...}, "matches": [...], "teamStats": {...} }' style={S.textarea} />
          <button onClick={loadJSON} className="primary">Load predictions</button>
        </div>
      )}

      {view === "groups" && (
        <div style={S.groupGrid}>
          {Object.entries(standings).map(([g, teams]) => (
            <div key={g} style={S.groupCard}>
              <div style={S.groupHead}>Group {g}</div>
              {teams.map((t, i) => (
                <div key={t.team} style={{ ...S.row, ...(i < 2 ? S.qualify : {}) }}>
                  <span style={S.pos}>{i + 1}</span>
                  <TeamLabel name={t.team} stats={data.teamStats} style={S.teamName} />
                  <span style={S.rec}>{t.w}-{t.d}-{t.l}</span>
                  <span style={S.pts}>{t.pts}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {view === "matches" && (
        <div style={S.matchWrap}>
          <div style={S.filterBar}>
            <button onClick={() => setGroupFilter("ALL")} className={groupFilter === "ALL" ? "chip on" : "chip"}>All</button>
            {Object.keys(data.groups).map((g) => (
              <button key={g} onClick={() => setGroupFilter(g)} className={groupFilter === g ? "chip on" : "chip"}>{g}</button>
            ))}
          </div>
          <div style={S.matchList}>
            {filteredMatches.map((m, i) => {
              const res = outcome(m);
              const label = res === "draw" ? "Draw" : res === "home" ? m.home + " win" : m.away + " win";
              const key = matchKey(m), v = verdicts[key];
              return (
                <div key={i} style={S.matchCard}>
                  <div style={S.matchTop}>
                    <span style={S.grpTag}>{groupOf(m)}</span>
                    <TeamLabel name={m.home} stats={data.teamStats} style={{ ...S.mt, ...(res === "home" ? S.winTeam : {}), textAlign: "right", flex: 1 }} />
                    <span style={S.vs}>v</span>
                    <TeamLabel name={m.away} stats={data.teamStats} style={{ ...S.mt, ...(res === "away" ? S.winTeam : {}), flex: 1 }} />
                  </div>
                  <div style={S.probBar}>
                    <div style={{ ...S.probSeg, width: (m.pHome * 100) + "%", background: "#6a9a78" }} />
                    <div style={{ ...S.probSeg, width: (m.pDraw * 100) + "%", background: "#7a6a55" }} />
                    <div style={{ ...S.probSeg, width: (m.pAway * 100) + "%", background: "#a5645a" }} />
                  </div>
                  <div style={S.probLabels}>
                    <span>{(m.pHome * 100).toFixed(0)}%</span>
                    <span style={S.predLabel}>{label}</span>
                    <span>{(m.pAway * 100).toFixed(0)}%</span>
                  </div>
                  <div style={S.verdictRow}>
                    <button onClick={() => saveVerdict(key, "correct")} style={{ ...S.vBtn, ...(v === "correct" ? S.vBtnCorrect : {}) }}>✓ Right</button>
                    <button onClick={() => saveVerdict(key, "wrong")} style={{ ...S.vBtn, ...(v === "wrong" ? S.vBtnWrong : {}) }}>✗ Wrong</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "accuracy" && (
        <div style={S.accWrap}>
          <div style={S.accHero}>
            <div style={S.accBig}>{total ? acc.toFixed(1) + "%" : "—"}</div>
            <div style={S.accLabel}>{total ? `correct on ${total} graded matches` : "Grade matches in the All Matches tab to track accuracy"}</div>
          </div>
          <div style={S.accStats}>
            <div style={S.accCard}><div style={{ ...S.accNum, color: "#7ab38a" }}>{correct}</div><div style={S.accSub}>Right</div></div>
            <div style={S.accCard}><div style={{ ...S.accNum, color: "#c4847a" }}>{wrong}</div><div style={S.accSub}>Wrong</div></div>
            <div style={S.accCard}><div style={{ ...S.accNum, color: "#9a8ba6" }}>{72 - total}</div><div style={S.accSub}>Ungraded</div></div>
          </div>
          {total > 0 && (<div style={S.accBarWrap}><div style={{ ...S.accBarFill, width: acc + "%" }} /></div>)}
          <p style={S.accNote}>Your grades are saved in this browser and persist between visits.</p>
        </div>
      )}

      {view === "bracket" && (
        <div>
          {bracket.champion && (
            <div style={S.champ}>
              <div style={S.champLabel}>PREDICTED CHAMPION</div>
              <div style={S.champName}>{bracket.champion.team}</div>
            </div>
          )}
          <div style={S.bracketScroll}>
            <div style={S.bracket}>
              {bracket.rounds.map((round, ri) => (
                <div key={ri} style={S.roundCol}>
                  <div style={S.roundName}>{ROUND_NAMES[ri] || "Round " + (ri + 1)}</div>
                  {round.map((pair, pi) => {
                    const [a, b] = Array.isArray(pair) ? pair : [pair, null];
                    const tr = tieResult(a, b, data.matches);
                    return (
                      <div key={pi} style={S.tie}>
                        <div style={{ ...S.slot, ...(tr.winner === a ? S.slotWin : {}) }}>
                          <span>{a ? <TeamLabel name={a.team} stats={data.teamStats} /> : "—"}</span>
                          {a && b && <span style={S.slotPct}>{(tr.pA * 100).toFixed(0)}%</span>}
                        </div>
                        {b !== undefined && (
                          <div style={{ ...S.slot, borderBottom: "none", ...(tr.winner === b ? S.slotWin : {}) }}>
                            <span>{b ? <TeamLabel name={b.team} stats={data.teamStats} /> : "—"}</span>
                            {a && b && <span style={S.slotPct}>{(tr.pB * 100).toFixed(0)}%</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.tab{background:transparent;border:1px solid #3a3245;color:#9a8ba6;padding:8px 18px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.04em;transition:all .15s}
.tab:hover{border-color:#6b5a78;color:#c4b5d0}
.tab.on{background:#8a6a9a;border-color:#8a6a9a;color:#f4ecf8}
.chip{background:transparent;border:1px solid #3a3245;color:#9a8ba6;padding:5px 13px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer}
.chip:hover{border-color:#6b5a78}
.chip.on{background:#2c2536;border-color:#8a6a9a;color:#c4a5d0}
.primary{background:#8a6a9a;border:none;color:#f4ecf8;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px}
.primary:hover{background:#9a7aaa}
`;

const TT = {
  box: { position: "fixed", zIndex: 50, background: "#241e2e", border: "1px solid #4a3d56", borderRadius: 10, padding: "10px 12px", minWidth: 190, boxShadow: "0 8px 30px rgba(0,0,0,.45)", pointerEvents: "none" },
  title: { fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#c4a5d0" },
  row: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9a8ba6", padding: "2px 0", gap: 16 },
};

const S = {
  page: { minHeight: "100vh", background: "linear-gradient(165deg, #1a1622 0%, #221b2c 55%, #2a1f30 100%)", color: "#d8cfe0", fontFamily: "'Inter',system-ui,sans-serif", padding: "32px 24px 80px" },
  header: { maxWidth: 1100, margin: "0 auto 28px" },
  kicker: { fontSize: 11, letterSpacing: ".22em", color: "#a585b8", fontWeight: 700 },
  title: { fontSize: 46, margin: "6px 0 4px", fontWeight: 800, letterSpacing: "-.02em", fontFamily: "'Georgia',serif", color: "#e8dcf0" },
  sub: { color: "#9a8ba6", fontSize: 14, maxWidth: 580, lineHeight: 1.5, margin: "0 0 20px" },
  tabs: { display: "flex", gap: 10, flexWrap: "wrap" },
  loadBox: { maxWidth: 720, margin: "0 auto", background: "#241e2e", border: "1px solid #382f44", borderRadius: 14, padding: 22 },
  textarea: { width: "100%", height: 220, background: "#1a1622", color: "#c4b5d0", border: "1px solid #3a3245", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, marginBottom: 12, resize: "vertical", boxSizing: "border-box" },
  groupGrid: { maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 16 },
  groupCard: { background: "#241e2e", border: "1px solid #382f44", borderRadius: 14, overflow: "hidden" },
  groupHead: { background: "#2c2438", padding: "10px 16px", fontWeight: 700, fontSize: 14, letterSpacing: ".05em", borderBottom: "1px solid #382f44", color: "#c4a5d0" },
  row: { display: "flex", alignItems: "center", padding: "9px 14px", borderBottom: "1px solid #2a2335", fontSize: 14 },
  qualify: { background: "rgba(106,154,120,.12)" },
  pos: { width: 20, color: "#6b5d78", fontWeight: 700, fontSize: 13 },
  teamName: { flex: 1, fontWeight: 500 },
  rec: { color: "#8a7d96", fontSize: 12, marginRight: 12, fontVariantNumeric: "tabular-nums" },
  pts: { fontWeight: 800, color: "#8ab89a", width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  matchWrap: { maxWidth: 1100, margin: "0 auto" },
  filterBar: { display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 18 },
  matchList: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 },
  matchCard: { background: "#241e2e", border: "1px solid #382f44", borderRadius: 12, padding: "14px 16px" },
  matchTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  grpTag: { fontSize: 10, fontWeight: 700, color: "#8a7d96", background: "#2c2438", borderRadius: 5, padding: "2px 6px" },
  mt: { fontSize: 14, fontWeight: 500, color: "#c4b5d0" },
  winTeam: { color: "#8ab89a", fontWeight: 700 },
  vs: { fontSize: 11, color: "#6b5d78" },
  probBar: { display: "flex", height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 6 },
  probSeg: { height: "100%" },
  probLabels: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9a8ba6", marginBottom: 10 },
  predLabel: { color: "#d8cfe0", fontWeight: 600 },
  verdictRow: { display: "flex", gap: 8, borderTop: "1px solid #2a2335", paddingTop: 10 },
  vBtn: { flex: 1, padding: "6px 0", borderRadius: 7, border: "1px solid #3a3245", background: "#1f1929", color: "#9a8ba6", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  vBtnCorrect: { background: "rgba(106,154,120,.22)", borderColor: "#5a8a6a", color: "#9ad0a8" },
  vBtnWrong: { background: "rgba(165,100,90,.22)", borderColor: "#a5645a", color: "#d0a098" },
  accWrap: { maxWidth: 640, margin: "0 auto", textAlign: "center" },
  accHero: { background: "#241e2e", border: "1px solid #382f44", borderRadius: 18, padding: "40px 24px" },
  accBig: { fontSize: 64, fontWeight: 800, fontFamily: "'Georgia',serif", color: "#c4a5d0", lineHeight: 1 },
  accLabel: { color: "#9a8ba6", fontSize: 14, marginTop: 8 },
  accStats: { display: "flex", gap: 14, marginTop: 18 },
  accCard: { flex: 1, background: "#241e2e", border: "1px solid #382f44", borderRadius: 12, padding: "18px 0" },
  accNum: { fontSize: 30, fontWeight: 800 },
  accSub: { fontSize: 12, color: "#9a8ba6", marginTop: 2, letterSpacing: ".05em" },
  accBarWrap: { marginTop: 18, height: 12, background: "#2a2335", borderRadius: 8, overflow: "hidden" },
  accBarFill: { height: "100%", background: "linear-gradient(90deg,#6a9a78,#8ab89a)", transition: "width .4s" },
  accNote: { color: "#7a6d86", fontSize: 12, marginTop: 16 },
  champ: { maxWidth: 1100, margin: "0 auto 24px", textAlign: "center", padding: "22px", background: "linear-gradient(135deg,#3a2c44,#2a1f30)", border: "1px solid #5a4566", borderRadius: 16 },
  champLabel: { fontSize: 11, letterSpacing: ".2em", color: "#a585b8", fontWeight: 700 },
  champName: { fontSize: 34, fontWeight: 800, marginTop: 4, fontFamily: "'Georgia',serif", color: "#e8dcf0" },
  bracketScroll: { overflowX: "auto", paddingBottom: 16 },
  bracket: { display: "flex", gap: 28, minWidth: "fit-content", padding: "0 8px" },
  roundCol: { display: "flex", flexDirection: "column", justifyContent: "space-around", minWidth: 190, gap: 12 },
  roundName: { fontSize: 11, letterSpacing: ".12em", color: "#8a7d96", fontWeight: 700, textAlign: "center", marginBottom: 6 },
  tie: { background: "#241e2e", border: "1px solid #382f44", borderRadius: 8, overflow: "hidden" },
  slot: { padding: "8px 12px", fontSize: 13, borderBottom: "1px solid #2a2335", color: "#8a7d96", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  slotWin: { color: "#e8dcf0", fontWeight: 700, background: "rgba(106,154,120,.14)", borderLeft: "3px solid #8ab89a" },
  slotPct: { fontSize: 11, color: "#a585b8", fontVariantNumeric: "tabular-nums" },
};