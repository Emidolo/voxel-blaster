export const GRID = 32;
export const SLOTS = 5;
export const COLS = 4;

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Farthest-point init so small accent colors (eyes, tongue) get their own cluster.
function kmeans(pts, k) {
  const cents = [pts[0]];
  while (cents.length < Math.min(k, pts.length)) {
    let best = pts[0], bd = -1;
    for (const p of pts) { const m = Math.min(...cents.map(c => d2(p, c))); if (m > bd) { bd = m; best = p; } }
    if (bd < 45) break; // remaining colors are near-duplicates: merge them so every shooter color is easy to tell apart
    cents.push(best);
  }
  let lab = [];
  for (let it = 0; it < 10; it++) {
    lab = pts.map(p => { let b = 0; cents.forEach((c, j) => { if (d2(p, c) < d2(p, cents[b])) b = j; }); return b; });
    cents.forEach((c, j) => {
      const m = pts.filter((_, i) => lab[i] === j);
      if (m.length) cents[j] = [0, 1, 2].map(ch => m.reduce((s, p) => s + p[ch], 0) / m.length);
    });
  }
  return { cents, lab };
}

// Local pipeline: work at 5x resolution, flood-fill the background in from the borders
// (follows gradients/shadows), drop specks, then downsample + quantize the subject.
export function imageToGrid(src) {
  const F = 5, S = GRID * F, N = S * S;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  const sc = S / Math.max(src.width, src.height);
  g.drawImage(src, (S - src.width * sc) / 2, (S - src.height * sc) / 2, src.width * sc, src.height * sc);
  const d = g.getImageData(0, 0, S, S).data;
  const rgb = i => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
  const clear = i => d[i * 4 + 3] < 128;

  const border = [];
  for (let i = 0; i < S; i++) border.push(i, (S - 1) * S + i, i * S, i * S + S - 1);
  const opaqueBorder = border.filter(i => !clear(i)).map(rgb);
  const bgCols = opaqueBorder.length ? kmeans(opaqueBorder, 3).cents : [];
  const nearBg = i => bgCols.some(b => d2(rgb(i), b) < 80);

  const bg = new Uint8Array(N), stack = [];
  for (const i of border) if (clear(i) || nearBg(i)) { bg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % S, y = (i / S) | 0;
    for (const j of [x > 0 && i - 1, x < S - 1 && i + 1, y > 0 && i - S, y < S - 1 && i + S]) {
      if (j === false || bg[j]) continue;
      if (clear(j) || (!clear(i) && d2(rgb(i), rgb(j)) < 24 && nearBg(j))) { bg[j] = 1; stack.push(j); }
    }
  }
  for (let i = 0; i < N; i++) if (clear(i)) bg[i] = 1;

  // drop specks: foreground blobs smaller than 2% of the subject
  let fgCount = N - bg.reduce((a, b) => a + b, 0);
  if (fgCount < N * 0.03) { // background removal ate everything: keep the whole image
    for (let i = 0; i < N; i++) bg[i] = clear(i) ? 1 : 0;
    fgCount = N;
  }
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (bg[i] || seen[i]) continue;
    const blob = [i]; seen[i] = 1;
    for (let k = 0; k < blob.length; k++) {
      const p = blob[k], x = p % S, y = (p / S) | 0;
      for (const j of [x > 0 && p - 1, x < S - 1 && p + 1, y > 0 && p - S, y < S - 1 && p + S])
        if (j !== false && !bg[j] && !seen[j]) { seen[j] = 1; blob.push(j); }
    }
    if (blob.length < fgCount * 0.02) blob.forEach(p => (bg[p] = 1));
  }

  // downsample: a cell is solid if at least half its pixels are subject; color = their average
  const cells = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const sum = [0, 0, 0]; let n = 0;
    for (let v = 0; v < F; v++) for (let u = 0; u < F; u++) {
      const i = (y * F + v) * S + x * F + u;
      if (!bg[i]) { const p = rgb(i); sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++; }
    }
    if (n * 2 >= F * F) cells.push({ x, y, col: sum.map(s => s / n) });
  }
  if (!cells.length) throw new Error('No encontré ningún objeto en la imagen.');
  const { cents, lab } = kmeans(cells.map(c => c.col), 8);
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill(-1));
  cells.forEach((c, i) => (grid[c.y][c.x] = lab[i]));
  return { palette: cents.map(hex), grid };
}

const key = (x, y, z) => `${x},${y},${z}`;
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 2D art -> 3D sculpt:
//  1. distance from each pixel to the silhouette edge (chamfer, ~euclidean)
//  2. rounded "pillow" profile: thick in the middle, curving down at the edges, thin parts stay thin
//  3. small enclosed color regions (eyes, mouth, buttons) pop out one block in front
//  4. back side is a flatter copy of the front so the model reads as a solid object from any angle
function sculpt(grid) {
  const at = (x, y) => (x < 0 || y < 0 || x >= GRID || y >= GRID ? -1 : grid[y][x]);
  const D = grid.map(r => r.map(v => (v < 0 ? 0 : 1e9)));
  const dAt = (x, y) => (at(x, y) < 0 ? 0 : D[y][x]);
  const relax = (x, y, steps) => {
    if (grid[y][x] < 0) return;
    for (const [dx, dy, w] of steps) D[y][x] = Math.min(D[y][x], dAt(x + dx, y + dy) + w);
  };
  const fwd = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]];
  const bwd = [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) relax(x, y, fwd);
  for (let y = GRID - 1; y >= 0; y--) for (let x = GRID - 1; x >= 0; x--) relax(x, y, bwd);

  const maxD = Math.max(...D.flat());
  const R = Math.min(4, Math.max(1, Math.round(maxD * 0.6)));
  const H = D.map(r => r.map(d => (d ? Math.max(1, Math.round(R * Math.sqrt(1 - (1 - Math.min(d, R) / R) ** 2))) : 0)));

  // features: same-color blobs that are small and don't touch the silhouette edge
  const fg = grid.flat().filter(v => v >= 0).length;
  const pop = grid.map(r => r.map(() => 0));
  const seen = grid.map(r => r.map(() => false));
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    if (grid[y][x] < 0 || seen[y][x]) continue;
    const c = grid[y][x], blob = [[x, y]];
    let edge = false;
    seen[y][x] = true;
    for (let k = 0; k < blob.length; k++) {
      const [bx, by] = blob[k];
      for (const [nx, ny] of [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]]) {
        if (at(nx, ny) < 0) edge = true;
        else if (at(nx, ny) === c && !seen[ny][nx]) { seen[ny][nx] = true; blob.push([nx, ny]); }
      }
    }
    if (!edge && blob.length >= 2 && blob.length < fg * 0.06) blob.forEach(([bx, by]) => (pop[by][bx] = 1));
  }

  const voxels = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const h = H[y][x];
    if (!h) continue;
    const back = Math.ceil(h / 2);
    for (let z = -(back - 1); z <= h - 1 + pop[y][x]; z++) voxels.push({ x, y: GRID - 1 - y, z, c: grid[y][x] });
  }
  return voxels;
}

// 3D voxels -> shooters ordered by how deep their blocks are, so levels are fair.
export function buildLevel({ palette, grid }) {
  const voxels = sculpt(grid);
  if (!voxels.length) throw new Error('El nivel quedó vacío');

  // peel the model like an onion: layer = round in which the voxel becomes reachable
  const left = new Map(voxels.map(v => [key(v.x, v.y, v.z), v]));
  for (let layer = 0; left.size; layer++) {
    const peel = [...left.values()].filter(v => N6.some(([a, b, c]) => !left.has(key(v.x + a, v.y + b, v.z + c))));
    peel.forEach(v => { v.layer = layer; left.delete(key(v.x, v.y, v.z)); });
  }

  // ammo scales with level size so every level has ~50 shooters
  const avg = Math.max(25, voxels.length / 50);
  const shooters = [];
  palette.forEach((_, c) => {
    const vs = voxels.filter(v => v.c === c).sort((a, b) => a.layer - b.layer);
    for (let i = 0; i < vs.length;) {
      let n = Math.max(10, Math.round((avg * (0.6 + Math.random() * 0.8)) / 5) * 5);
      if (vs.length - i - n < 10) n = vs.length - i;
      shooters.push({ c, ammo: n, t: vs[i].layer + Math.random() * 2 });
      i += n;
    }
  });
  shooters.sort((a, b) => a.t - b.t);
  const columns = Array.from({ length: COLS }, (_, i) => shooters.filter((_, j) => j % COLS === i).map(({ c, ammo }) => ({ c, ammo })));
  return { palette, grid, voxels: voxels.map(({ x, y, z, c }) => ({ x, y, z, c })), columns };
}
