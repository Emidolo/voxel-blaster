import { useEffect, useRef, useState } from 'react';
import { Game } from './Game3D.js';
import { imageToGrid, buildLevel } from './level.js';
import { sfx } from './sfx.js';

// Built-in campaign: each level is an emoji rendered to a canvas and run through the same image pipeline.
const LEVELS = ['🐠', '🍉', '🍄', '🐸', '🍩', '🦊', '🐙', '🌵', '🍓', '🐧', '🦄', '🚀'];

const loadImg = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('No pude leer esa imagen.')); i.src = src; });

function emojiLevel(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '110px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  return buildLevel(imageToGrid(c));
}

function Shooter({ s, palette, onClick, dim }) {
  return (
    <button className={`shooter${dim ? ' dim' : ''}`} style={{ '--c': palette[s.c] }} onClick={onClick} disabled={!onClick}>
      {s.ammo}
    </button>
  );
}

export default function App() {
  const view = useRef();
  const game = useRef();
  const fileInput = useRef();
  const [snap, setSnap] = useState(null);
  const [toast, setToast] = useState(null);
  const [shake, setShake] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  const [level, setLevel] = useState(() => { try { return Math.min(+localStorage.getItem('level') || 0, LEVELS.length - 1); } catch { return 0; } });
  const [custom, setCustom] = useState(false);
  const [unlocked, setUnlocked] = useState(() => { try { return +localStorage.getItem('unlocked') || 0; } catch { return 0; } });

  useEffect(() => {
    game.current = new Game(view.current, setSnap);
    return () => game.current.dispose();
  }, []);

  function playLevel(i) {
    setLevel(i);
    setCustom(false);
    setMenu(false);
    try { localStorage.setItem('level', i); } catch {}
    game.current.load(emojiLevel(LEVELS[i]));
  }
  useEffect(() => playLevel(level), []);

  // unlock the next level on a win
  useEffect(() => {
    if (snap?.status !== 'won' || custom || level + 1 <= unlocked) return;
    setUnlocked(level + 1);
    try { localStorage.setItem('unlocked', level + 1); } catch {}
  }, [snap?.status]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadFile(file) {
    if (!file?.type.startsWith('image/')) return setToast({ error: true, text: 'Eso no es una imagen.' });
    try {
      const level = buildLevel(imageToGrid(await loadImg(URL.createObjectURL(file))));
      game.current.load(level);
      setCustom(true);
      setMenu(false);
      setToast({ text: `¡Nivel listo! ${level.voxels.length} bloques` });
    } catch (e) {
      setToast({ error: true, text: e.message });
    }
  }

  function pick(i) {
    if (game.current.pick(i)) { sfx.pick(); navigator.vibrate?.(12); return; }
    sfx.full();
    navigator.vibrate?.([30, 40, 30]);
    setShake(true);
    setTimeout(() => setShake(false), 350);
  }

  const pct = snap ? Math.round(100 * (1 - snap.remaining / snap.total)) : 0;
  const slotsEmpty = snap?.slots.every(s => !s);
  const newLevel = () => fileInput.current.click();

  return (
    <div className="app"
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => e.currentTarget === e.target && setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files[0]); }}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { loadFile(e.target.files[0]); e.target.value = ''; }} />
      <header>
        <button className="logo" onClick={() => setMenu(true)}>☰ {custom ? 'Tu imagen' : `Nivel ${level + 1}`}</button>
        <div className="progress"><div style={{ width: pct + '%' }} /><b>{pct}%</b></div>
        <button onClick={() => setMuted(sfx.toggle())} aria-label="Sonido">{muted ? '🔇' : '🔊'}</button>
        <button className="primary" onClick={newLevel}>📷<span className="wide"> Subir imagen</span></button>
      </header>

      <main ref={view} className="view">
        {snap && snap.status !== 'playing' && (
          <div className="overlay">
            <div className="card center">
              <h2>{snap.status === 'won' ? '¡Nivel completado! 🎉' : 'Sin espacio 😵'}</h2>
              <p>{snap.status === 'won' ? 'Destruiste todos los bloques.' : 'Los 5 slots están llenos y ninguno puede disparar.'}</p>
              <div className="row">
                <button onClick={() => game.current.restart()}>↻ Reintentar</button>
                {snap.status === 'won' && !custom && level + 1 < LEVELS.length
                  ? <button className="primary" onClick={() => playLevel(level + 1)}>Siguiente ▶</button>
                  : <button className="primary" onClick={() => setMenu(true)}>☰ Niveles</button>}
              </div>
            </div>
          </div>
        )}
        {menu && (
          <div className="overlay" onClick={e => e.target === e.currentTarget && setMenu(false)}>
            <div className="card center">
              <h2>Niveles</h2>
              <div className="levels">
                {LEVELS.map((e, i) => (
                  <button key={i} className={i === level && !custom ? 'on' : ''} disabled={i > unlocked} onClick={() => playLevel(i)}>
                    {i > unlocked ? '🔒' : e}<small>{i + 1}</small>
                  </button>
                ))}
              </div>
              <button className="primary big" onClick={newLevel}>📷 Crear nivel con tu imagen</button>
            </div>
          </div>
        )}
        {dragging && <div className="overlay drop-hint">Suelta la imagen para crear el nivel</div>}
        {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.text}</div>}
      </main>

      {snap && (
        <footer>
          <div className={`slots${shake ? ' shake' : ''}`}>
            {snap.slots.map((s, i) => (
              <div key={i} className="slot">{s && <Shooter key={s.ammo} s={s} palette={snap.palette} />}</div>
            ))}
          </div>
          <p className="hint">{shake ? 'Slots llenos: espera a que alguno termine' : slotsEmpty ? 'Toca un disparador: dispara solo a los bloques de su color' : ' '}</p>
          <div className="columns">
            {snap.columns.map((col, i) => (
              <div key={i} className="column">
                {col.top.map((s, j) => (
                  <Shooter key={j} s={s} palette={snap.palette} dim={j > 0} onClick={j === 0 && snap.status === 'playing' ? () => pick(i) : null} />
                ))}
                <small>{col.left > 3 ? `+${col.left - 3}` : ' '}</small>
              </div>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
