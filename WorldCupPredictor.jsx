import React, { useState, useMemo } from "react";

// ---- Sample predictions so the UI renders immediately. ----
// Replace via the "Load predictions" box with your model's worldcup_predictions.json
const SAMPLE = {
  groups: {
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
  },
  matches: [],
};

// Deterministic pseudo-prob for sample fixtures when no model data is loaded.
function seededProbs(a, b) {
  let s = 0;
  const str = a + "|" + b;
  for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) % 100000;
  const r1 = (s % 1000) / 1000;
  const r2 = ((s >> 3) % 1000) / 1000;
  let pH = 0.25 + r1 * 0.45;
  let pD = 0.18 + r2 * 0.22;
  let pA = Math.max(0.05, 1 - pH - pD);
  const tot = pH + pD + pA;
  return { pHome: pH / tot, pDraw: pD / tot, pAway: pA / tot };
}

function buildSampleMatches(groups) {
  const out = [];
  Object.values(groups).forEach((teams) => {
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) {
        const p = seededProbs(teams[i], teams[j]);
        out.push({ home: teams[i], away: teams[j], neutral: true, ...p });
      }
  });
  return out;
}

function outcome(m) {
  if (m.pDraw > 0.36 && m.pDraw >= m.pHome && m.pDraw >= m.pAway) return "draw";
  return m.pHome >= m.pAway ? "home" : "away";
}

function computeStandings(groups, matches) {
  const table = {};
  Object.entries(groups).forEach(([g, teams]) => {
    table[g] = {};
    teams.forEach((t) => (table[g][t] = { team: t, pts: 0, w: 0, d: 0, l: 0, gp: 0, xg: 0 }));
  });
  matches.forEach((m) => {
    const g = Object.keys(groups).find(
      (k) => groups[k].includes(m.home) && groups[k].includes(m.away)
    );
    if (!g) return;
    const res = outcome(m);
    const h = table[g][m.home], a = table[g][m.away];
    if (!h || !a) return;
    h.gp++; a.gp++;
    h.xg += m.pHome - m.pAway; a.xg += m.pAway - m.pHome;
    if (res === "home") { h.pts += 3; h.w++; a.l++; }
    else if (res === "away") { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  });
  const ranked = {};
  Object.entries(table).forEach(([g, teams]) => {
    ranked[g] = Object.values(teams).sort(
      (x, y) => y.pts - x.pts || y.xg - x.xg
    );
  });
  return ranked;
}

// 2026 bracket: 12 group winners + 12 runners-up + 8 best thirds = 32.
// Simplified seeding: winners and runners-up, then top 8 third-placed by points/xg.
function buildKnockout(standings) {
  const winners = [], runners = [], thirds = [];
  Object.entries(standings).forEach(([g, t]) => {
    if (t[0]) winners.push({ ...t[0], grp: g, pos: "1" });
    if (t[1]) runners.push({ ...t[1], grp: g, pos: "2" });
    if (t[2]) thirds.push({ ...t[2], grp: g, pos: "3" });
  });
  thirds.sort((a, b) => b.pts - a.pts || b.xg - a.xg);
  const bestThirds = thirds.slice(0, 8);
  const pool = [...winners, ...runners, ...bestThirds].sort(
    (a, b) => b.pts - a.pts || b.xg - a.xg
  );
  // Pair strongest vs weakest for a 32 team R32.
  const r32 = [];
  for (let i = 0; i < pool.length / 2; i++) {
    r32.push([pool[i], pool[pool.length - 1 - i]]);
  }
  return r32;
}

function knockoutWinner(a, b, matches) {
  if (!a || !b) return a || b;
  const m = matches.find(
    (x) =>
      (x.home === a.team && x.away === b.team) ||
      (x.home === b.team && x.away === a.team)
  );
  let pa;
  if (m) {
    const aHome = m.home === a.team;
    const ph = aHome ? m.pHome : m.pAway;
    const pl = aHome ? m.pAway : m.pHome;
    pa = ph / (ph + pl);
  } else {
    // fall back to xg-derived strength
    pa = 1 / (1 + Math.exp(-(a.xg - b.xg)));
  }
  return pa >= 0.5 ? a : b;
}

function simulateBracket(r32, matches) {
  const rounds = [r32];
  let current = r32.map(([a, b]) => knockoutWinner(a, b, matches));
  while (current.length > 1) {
    const pairs = [];
    for (let i = 0; i < current.length; i += 2) pairs.push([current[i], current[i + 1]]);
    rounds.push(pairs);
    current = pairs.map(([a, b]) => knockoutWinner(a, b, matches));
  }
  return { rounds, champion: current[0] };
}

const ROUND_NAMES = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

export default function App() {
  const [data, setData] = useState(() => {
    const g = SAMPLE.groups;
    return { groups: g, matches: buildSampleMatches(g) };
  });
  const [raw, setRaw] = useState("");
  const [view, setView] = useState("groups");
  const [usingSample, setUsingSample] = useState(true);

  const standings = useMemo(
    () => computeStandings(data.groups, data.matches),
    [data]
  );
  const r32 = useMemo(() => buildKnockout(standings), [standings]);
  const bracket = useMemo(() => simulateBracket(r32, data.matches), [r32, data.matches]);

  function loadJSON() {
    try {
      const parsed = JSON.parse(raw);
      const matches = parsed.matches.map((m) => ({
        home: m.home, away: m.away, neutral: m.neutral,
        pHome: m.pHome, pDraw: m.pDraw, pAway: m.pAway,
      }));
      setData({ groups: parsed.groups, matches });
      setUsingSample(false);
    } catch (e) {
      alert("Invalid JSON: " + e.message);
    }
  }

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <header style={S.header}>
        <div style={S.kicker}>MODEL FORECAST · FIFA WORLD CUP 2026</div>
        <h1 style={S.title}>Group to Glory</h1>
        <p style={S.sub}>
          XGBoost group-stage probabilities, rolled into standings and a knockout run.
          {usingSample && " Showing sample data — load your model's JSON to see real forecasts."}
        </p>
        <div style={S.tabs}>
          <button onClick={() => setView("groups")} className={view === "groups" ? "tab on" : "tab"}>Groups</button>
          <button onClick={() => setView("bracket")} className={view === "bracket" ? "tab on" : "tab"}>Knockout Bracket</button>
          <button onClick={() => setView("load")} className={view === "load" ? "tab on" : "tab"}>Load Predictions</button>
        </div>
      </header>

      {view === "load" && (
        <div style={S.loadBox}>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#9aa" }}>
            Paste the contents of <code>worldcup_predictions.json</code>:
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{ "groups": {...}, "matches": [...] }'
            style={S.textarea}
          />
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
                  <span style={S.teamName}>{t.team}</span>
                  <span style={S.rec}>{t.w}-{t.d}-{t.l}</span>
                  <span style={S.pts}>{t.pts}</span>
                </div>
              ))}
            </div>
          ))}
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
                  <div style={S.roundName}>{ROUND_NAMES[ri] || `Round ${ri + 1}`}</div>
                  {round.map((pair, pi) => {
                    const [a, b] = Array.isArray(pair) ? pair : [pair, null];
                    const w = knockoutWinner(a, b, data.matches);
                    return (
                      <div key={pi} style={S.tie}>
                        <div style={{ ...S.slot, ...(w === a ? S.slotWin : {}) }}>
                          {a ? a.team : "—"}
                        </div>
                        {b !== undefined && (
                          <div style={{ ...S.slot, ...(w === b ? S.slotWin : {}) }}>
                            {b ? b.team : "—"}
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
.tab{background:transparent;border:1px solid #2a3340;color:#8b97a6;padding:8px 18px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.04em;transition:all .15s}
.tab:hover{border-color:#3d6b4f;color:#cfe}
.tab.on{background:#1db954;border-color:#1db954;color:#04140a}
.primary{background:#1db954;border:none;color:#04140a;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px}
.primary:hover{background:#22d662}
`;

const S = {
  page: { minHeight: "100vh", background: "radial-gradient(120% 80% at 50% 0%, #11202a 0%, #0a1014 60%)", color: "#e8eef2", fontFamily: "'Inter',system-ui,sans-serif", padding: "32px 24px 80px" },
  header: { maxWidth: 1100, margin: "0 auto 28px" },
  kicker: { fontSize: 11, letterSpacing: ".22em", color: "#1db954", fontWeight: 700 },
  title: { fontSize: 46, margin: "6px 0 4px", fontWeight: 800, letterSpacing: "-.02em", fontFamily: "'Georgia',serif" },
  sub: { color: "#8b97a6", fontSize: 14, maxWidth: 560, lineHeight: 1.5, margin: "0 0 20px" },
  tabs: { display: "flex", gap: 10, flexWrap: "wrap" },
  loadBox: { maxWidth: 720, margin: "0 auto", background: "#101a21", border: "1px solid #1f2a33", borderRadius: 14, padding: 22 },
  textarea: { width: "100%", height: 220, background: "#0a1014", color: "#cfe", border: "1px solid #243039", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, marginBottom: 12, resize: "vertical", boxSizing: "border-box" },
  groupGrid: { maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 16 },
  groupCard: { background: "#101a21", border: "1px solid #1f2a33", borderRadius: 14, overflow: "hidden" },
  groupHead: { background: "#16242e", padding: "10px 16px", fontWeight: 700, fontSize: 14, letterSpacing: ".05em", borderBottom: "1px solid #1f2a33" },
  row: { display: "flex", alignItems: "center", padding: "9px 14px", borderBottom: "1px solid #161f26", fontSize: 14 },
  qualify: { background: "rgba(29,185,84,.06)" },
  pos: { width: 20, color: "#5d6b78", fontWeight: 700, fontSize: 13 },
  teamName: { flex: 1, fontWeight: 500 },
  rec: { color: "#6b7884", fontSize: 12, marginRight: 12, fontVariantNumeric: "tabular-nums" },
  pts: { fontWeight: 800, color: "#1db954", width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  champ: { maxWidth: 1100, margin: "0 auto 24px", textAlign: "center", padding: "22px", background: "linear-gradient(135deg,#1db95422,#11202a)", border: "1px solid #1db95455", borderRadius: 16 },
  champLabel: { fontSize: 11, letterSpacing: ".2em", color: "#1db954", fontWeight: 700 },
  champName: { fontSize: 34, fontWeight: 800, marginTop: 4, fontFamily: "'Georgia',serif" },
  bracketScroll: { overflowX: "auto", paddingBottom: 16 },
  bracket: { display: "flex", gap: 28, minWidth: "fit-content", padding: "0 8px" },
  roundCol: { display: "flex", flexDirection: "column", justifyContent: "space-around", minWidth: 170, gap: 12 },
  roundName: { fontSize: 11, letterSpacing: ".12em", color: "#6b7884", fontWeight: 700, textAlign: "center", marginBottom: 6 },
  tie: { background: "#101a21", border: "1px solid #1f2a33", borderRadius: 8, overflow: "hidden" },
  slot: { padding: "8px 12px", fontSize: 13, borderBottom: "1px solid #161f26", color: "#7e8a96" },
  slotWin: { color: "#e8eef2", fontWeight: 700, background: "rgba(29,185,84,.1)", borderLeft: "3px solid #1db954" },
};
