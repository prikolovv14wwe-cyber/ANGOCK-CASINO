(() => {
/* ================== НАСТРОЙКИ ================== */
const RTP = 0.95;              // целевой RTP
const WINDOW_SEC = 7;          // окно кассы после убийства, с
const BOMB_LOSS = 0.25;        // доля выигрыша, которую сжигает мина
const BOOST_COST = 0.5;        // ★ за каждые 0.1 с ускорения при ставке 100
const BOOST_SHRINK = 0.8;      // потеря массы за каждые 0.1 с ускорения
const TAU = Math.PI * 2;
const ARENA = 4500, INIT_LEN = 14;
const P_SPEED = 245, P_BOOST = 450;
const B_SPEED = 200, B_BOOST = 370;
const BOMB_BASE = 90, BOT_N = 32;
const SPAWN_GAP = 160;          // мин. расстояние между новым червём и другими
const SPAWN_GAP_PLAYER = 700;  // мин. расстояние нового бота до игрока
const VIEW_MARGIN = 300;       // запас за краем экрана, где нельзя появляться
const BETS = [100, 500, 1000, 5000, 10000, 50000, 100000];
const BAL_PRESETS = [10000, 100000, 1000000, 10000000];
const MIN_BET = 10, MAX_BAL = 1e9;

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
let VW = 0, VH = 0, DPR = 1, vignette = null;
let MAXDPR = matchMedia('(pointer:coarse)').matches ? 1 : 1.25;   // потолок плотности пикселей; снижается автоматически, если кадры тяжёлые
function resize(){
  DPR = MAXDPR < 1 ? MAXDPR : Math.min(MAXDPR, window.devicePixelRatio || 1);   // < 1 — рендер в пониженном разрешении на слабых устройствах
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
  vignette = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.hypot(VW, VH) * .62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.55)');
}
addEventListener('resize', resize); resize();
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ================== ДЕНЬГИ ================== */
const S = { skin: 'violet', balance: 10000, bet: 100, mult: 1, round: 0, playing: false, kills: 0, stats: { rounds: 0, bet: 0, paid: 0 } };
try {
  const v = localStorage.getItem('chervi_balance'); if (v !== null && !isNaN(+v)) S.balance = +v;
  const b = +localStorage.getItem('chervi_bet'); if (b >= MIN_BET) S.bet = b;
  const sk = localStorage.getItem('chervi_skin'); if (sk) S.skin = sk;
  const st = JSON.parse(localStorage.getItem('chervi_stats') || 'null'); if (st && typeof st.rounds === 'number') S.stats = st;
} catch(e){}
function save(){
  try {
    localStorage.setItem('chervi_balance', String(S.balance));
    localStorage.setItem('chervi_bet', String(S.bet));
    localStorage.setItem('chervi_skin', S.skin);
    localStorage.setItem('chervi_stats', JSON.stringify(S.stats));
  } catch(e){}
}
const NF = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const fmt = n => NF.format(Math.round(n * 100) / 100) + ' ★';
const short = n => n >= 1e6 ? (n / 1e6) + 'M' : n >= 1000 ? (n / 1000) + 'K' : String(n);

/* ================== RTP-КОНТРОЛЛЕР ==================
   Скрытая точка краша M:  P(M ≥ x) = RTP / x.  Лимит выплаты = ставка × M.
   Ниже лимита касса открывается (контроллер подсылает червя),
   у лимита растёт давление (мины, охота), выше — касса не открывается. */
const R = { M: 1, cap: 0, window: 0, kamiT: 0, ratio: 0, bombAcc: 0, phase: '', portal: null, portalT: 0 };
const rollCrash = () => Math.min(1000, Math.floor(RTP / (1 - Math.random()) * 100) / 100);
const killAllowed = () => S.playing && S.round <= R.cap;

/* ================== СПРАЙТЫ ================== */
const SPR = {};
function makeSprite(r, draw, res){
  res = res || 2;
  const size = Math.ceil(r * 2 + 14);
  const c = document.createElement('canvas'); c.width = c.height = size * res;
  const g = c.getContext('2d'); g.scale(res, res); g.translate(size / 2, size / 2);
  draw(g, r);
  return { c, half: size / 2, r };
}
function drawSpr(sp, x, y, s){ const h = sp.half * s; ctx.drawImage(sp.c, x - h, y - h, h * 2, h * 2); }

/* --- монеты --- */
function mine(g, r){
  // круглая глянцевая бомба с металлическим колпачком и фитилём
  const gr = g.createRadialGradient(-r * .35, -r * .42, r * .05, 0, 0, r * .95);
  gr.addColorStop(0, '#6c7180'); gr.addColorStop(.32, '#262932'); gr.addColorStop(1, '#040406');
  g.fillStyle = gr; g.beginPath(); g.arc(0, r * .1, r * .88, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,60,80,.85)'; g.lineWidth = r * .09; g.setLineDash([r * .28, r * .18]);   // красный пояс
  g.beginPath(); g.ellipse(0, r * .18, r * .86, r * .3, 0, 0, Math.PI); g.stroke(); g.setLineDash([]);
  g.save(); g.translate(r * .42, -r * .58); g.rotate(.62);                                              // колпачок
  const cg = g.createLinearGradient(-r * .25, 0, r * .25, 0); cg.addColorStop(0, '#5a5f6b'); cg.addColorStop(.5, '#c4c9d4'); cg.addColorStop(1, '#4a4e58');
  g.fillStyle = cg; g.fillRect(-r * .24, -r * .2, r * .48, r * .36); g.restore();
  g.strokeStyle = '#c9a36a'; g.lineWidth = r * .11; g.lineCap = 'round';                               // фитиль
  g.beginPath(); g.moveTo(r * .55, -r * .78); g.quadraticCurveTo(r * .95, -r * 1.05, r * .82, -r * 1.3); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(-r * .36, -r * .3, r * .26, r * .13, -.7, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(-r * .46, -r * .36, r * .06, 0, TAU); g.fill();
}
function shadowBlob(g, r){
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(.6, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
}

/* --- декор карты --- */
/* --- кожа червей: цельное тело-«трубка» + анимированный слой поверх --- */
const SKIN_R = 24;
const hsl = (c, dl) => `hsl(${c[0]} ${c[1]}% ${clamp(c[2] + (dl || 0), 3, 97)}%)`;
// мягкое «зарево»: плавный спад яркости по кривой, без резких краёв
function glowSprite(col, rr){
  return makeSprite(rr, (g, r) => {
    const a0 = parseFloat(col.match(/[\d.]+\)$/)[0]), base = col.replace(/[\d.]+\)$/, '');
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (let i = 0; i <= 10; i++){ const t = i / 10; gr.addColorStop(t, base + (a0 * Math.pow(1 - t, 2.2)).toFixed(3) + ')'); }
    g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2);
  }, 1);
}
function mix(hex, k){ // k > 0 — к белому, k < 0 — к чёрному
  const n = parseInt(hex.slice(1), 16), t = k < 0 ? 0 : 255, a = Math.abs(k);
  const ch = v => Math.round(v + (t - v) * a);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
function hslHex(h, s, l){
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
/* Скины. type 'seq' — яркие цветные секции, как в slither (cols — цвета по порядку, len — длина секции в r).
   fx — дополнительный анимированный слой. Все скины чуть «текут» и по ним пробегает блик. */
const SKINS = [
  { id: 'red',      name: 'Алый',      type: 'solid', base: '#e8262f' },
  { id: 'violet',   name: 'Фиалка',    type: 'solid', base: '#7a52ff' },
  { id: 'teal',     name: 'Бирюза',    type: 'solid', base: '#62d6c6' },
  { id: 'lemon',    name: 'Лимон',     type: 'solid', base: '#e3dd48' },
  { id: 'lavender', name: 'Лаванда',   type: 'solid', base: '#8f95ff' },
  { id: 'neongreen',name: 'Кислота',   type: 'neon',  base: '#3dff5c', glow: 'rgba(60,255,90,.5)' },
  { id: 'neonpink', name: 'Фуксия', type: 'neon', base: '#ff4fd8', glow: 'rgba(255,80,220,.5)' },
  { id: 'softrainbow', name: 'Переливы', type: 'seq', cols: ['#7dff3a','#2f6bff','#ff3df0','#ffe03a','#ff2a2a','#ff9a2a','#2ad65a','#3a5bff'], len: 2.4, soft: true },
  { id: 'electric', name: 'Молния',    type: 'electric', base: '#2a1066', glow: 'rgba(160,90,255,.35)', bolt: '#c78bff' },
  { id: 'fire',     name: 'Пламя',     type: 'fire',     base: '#b8280c', glow: 'rgba(255,110,20,.32)' },
  { id: 'sunset',   name: 'Закат',     type: 'seq', cols: ['#ff3d6e','#ff7a3d','#ffc83d'], len: 1.2, glow: 'rgba(255,110,80,.25)' },
  { id: 'ocean',    name: 'Океан',     type: 'seq', cols: ['#00d2ff','#0a7cff','#00f0c8'], len: 1.2, fx: 'waves', glow: 'rgba(40,170,255,.25)' },
  { id: 'rainbow',  name: 'Радуга',    type: 'seq', cols: ['#ff3b5c','#ff9b2f','#ffe53b','#4dff7a','#2fd2ff','#4a6bff','#b44dff'], len: 1, flow: 2 },
  { id: 'hazard',   name: 'Радиация',  type: 'seq', cols: ['#ffd21a','#ffd21a','#161616'], len: .9 },
  { id: 'berry',    name: 'Ягода',     type: 'seq', cols: ['#c03dff','#ff3dd2'], len: 1.3, glow: 'rgba(220,70,255,.25)' },
  { id: 'lime',     name: 'Лайм',      type: 'seq', cols: ['#b6ff3d','#3dff86'], len: 1.3, fx: 'bubbles' },
  { id: 'gold',     name: 'Золото',    type: 'seq', cols: ['#ffd84a','#ffb020'], len: 1, fx: 'shimmer' },
  { id: 'ice',      name: 'Лёд',       type: 'seq', cols: ['#c6f4ff','#7fd6ff','#ffffff'], len: 1.1, fx: 'sparkle', glow: 'rgba(170,230,255,.22)' },
  { id: 'candy',    name: 'Конфета',   type: 'seq', cols: ['#ff6ec7','#ffffff'], len: .9 },
  { id: 'tiger',    name: 'Тигр',      type: 'seq', cols: ['#ff9a1f','#ff9a1f','#ff9a1f','#1a1208'], len: .7 },
  { id: 'galaxy',   name: 'Галактика', type: 'galaxy',   base: '#1b0f4a', glow: 'rgba(120,90,255,.25)' },
  { id: 'aurora',   name: 'Аврора',    type: 'aurora',   base: '#063a40', glow: 'rgba(60,255,200,.25)' },
  { id: 'plasma',   name: 'Плазма',    type: 'pulse',    base: '#3a0b5c', glow: 'rgba(210,90,255,.28)' },
  { id: 'cyber',    name: 'Кибер',     type: 'cyber',    base: '#0a1a28', glow: 'rgba(0,255,240,.25)' },
  { id: 'sakura',   name: 'Сакура',    type: 'seq', cols: ['#ffb3cf','#ff8fb8'], len: 1.4, fx: 'petals' },
  { id: 'zebra',    name: 'Зебра',     type: 'seq', cols: ['#f4f4f4','#1b1b1b'], len: .8 },
  { id: 'mint',     name: 'Мята',      type: 'seq', cols: ['#6fffcf','#2fe0b0','#b8fff0'], len: 1.1, glow: 'rgba(90,255,200,.25)' },
  { id: 'shadow',   name: 'Тень',      type: 'embers',   base: '#16161c', glow: 'rgba(255,40,60,.25)' },
];
function softCols(cols){
  // между соседними цветами вставляем промежуточные — переходы становятся плавными
  const out = [];
  const lerp = (a, b, t) => { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), ch = (s) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
    return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); };
  for (let i = 0; i < cols.length; i++){ const a = cols[i], b = cols[(i + 1) % cols.length]; out.push(a, lerp(a, b, .33), lerp(a, b, .66)); }
  return out;
}
function makeSkin(def){
  if (def.soft && !def._s){ def = { ...def, cols: softCols(def.cols), len: (def.len || 1) / 3, _s: true }; }
  const base = def.base || def.cols[0];
  return { ...def, base, dark: mix(base, -.6), lo: mix(base, -.5), hi: mix(base, .5), map: base };
}
function botSkin(){
  const rr = Math.random();
  if (rr < .35){ const h = (Math.random() * 360) | 0; return makeSkin({ id: 'bot', type: 'solid', base: hslHex(h, 70 + Math.random() * 25, 55 + Math.random() * 10) }); }
  if (rr < .75) return makeSkin(SKINS[(Math.random() * SKINS.length) | 0]);
  // случайная яркая раскраска из 2–3 цветов
  const h = (Math.random() * 360) | 0, k = 2 + ((Math.random() * 2) | 0), cols = [];
  for (let i = 0; i < k; i++) cols.push(hslHex((h + i * (30 + Math.random() * 40)) % 360, 85 + Math.random() * 15, 52 + Math.random() * 12));
  return makeSkin({ id: 'bot', type: 'seq', cols, len: .9 + Math.random() * .6, glow: Math.random() < .4 ? hexA(cols[0], .25) : null });
}
const hash = i => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

// тело: основная часть одним путём, хвост — сужающимися кусками
/* Тело рисуется как один гладкий контур (многоугольник вокруг сглаженной средней линии),
   поэтому нет «бусин», ступенек на хвосте и рваных полос. Узоры — полосы-контуры и ленты вдоль тела. */
let LOW = false; // режим экономии, включается автоматически
const FB = { X: new Float32Array(1100), Y: new Float32Array(1100), NX: new Float32Array(1100), NY: new Float32Array(1100), W: new Float32Array(1100), idx: [] };
function bodyFrame(pts, r, view, gulps, wave){
  const n = pts.length, step = n > 260 ? 2 : 1;
  // точки, лежащие друг на друге (хвост только что вырос), пропускаем — иначе на хвосте появлялись «шипы»
  const idx = FB.idx; idx.length = 0;
  const minD2 = (r * .12) ** 2;
  let lx = pts[0].x, ly = pts[0].y; idx.push(0);
  for (let i = step; i < n; i += step){
    const p = pts[i], dx = p.x - lx, dy = p.y - ly;
    if (dx * dx + dy * dy < minD2) continue;
    idx.push(i); lx = p.x; ly = p.y;
  }
  if (idx.length < 2) idx.push(n - 1);
  const m = idx.length, X = FB.X, Y = FB.Y;
  for (let k = 0; k < m; k++){ X[k] = pts[idx[k]].x; Y[k] = pts[idx[k]].y; }
  for (let pass = 0; pass < 2; pass++){                       // сглаживание средней линии
    let px = X[0], py = Y[0];
    for (let k = 1; k < m - 1; k++){ const cx = X[k], cy = Y[k]; X[k] = (px + 2 * cx + X[k + 1]) / 4; Y[k] = (py + 2 * cy + Y[k + 1]) / 4; px = cx; py = cy; }
  }
  const NX = FB.NX, NY = FB.NY, W = FB.W, ts = n * .55;
  let lnx = 0, lny = 1;
  for (let k = 0; k < m; k++){
    const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
    const tx = X[b] - X[a], ty = Y[b] - Y[a], L = Math.hypot(tx, ty);
    if (L > 1e-4){ lnx = -ty / L; lny = tx / L; }
    NX[k] = lnx; NY[k] = lny;
    const i = idx[k];
    let w = i < ts ? 1 : 1 - .68 * Math.pow((i - ts) / Math.max(1, n - 1 - ts), 1.25);
    if (gulps) for (const gp of gulps){ const d = (i - gp) / 3; w *= 1 + .22 * Math.exp(-d * d) * (1 - gp / n); }
    W[k] = r * w;
  }
  if (wave && wave.a > 0 && m > 4){
    // поперечная волна: от головы нарастает, к хвосту затухает вместе с шириной; бежит назад по телу
    const kk = TAU / (r * 13), gap = r * .55;
    for (let k = 1; k < m; k++){
      const i = idx[k], env = Math.min(1, i / 9) * (W[k] / r);
      const off = Math.sin(i * gap * kk - wave.t) * wave.a * r * env;
      X[k] += NX[k] * off; Y[k] += NY[k] * off;
    }
    for (let k = 0; k < m; k++){                                 // нормали после изгиба
      const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
      const tx = X[b] - X[a], ty = Y[b] - Y[a], L = Math.hypot(tx, ty);
      if (L > 1e-4){ NX[k] = -ty / L; NY[k] = tx / L; }
    }
  }
  const runs = [];
  if (!view) runs.push([0, m - 1]);
  else {
    let a = -1;
    for (let k = 0; k < m; k++){
      const vis = X[k] > view[0] && X[k] < view[2] && Y[k] > view[1] && Y[k] < view[3];
      if (vis){ if (a < 0) a = Math.max(0, k - 1); }
      else if (a >= 0){ runs.push([a, k]); a = -1; }
    }
    if (a >= 0) runs.push([a, m - 1]);
  }
  return { n, m, idx, X, Y, NX, NY, W, runs, gap: r * .55, r };
}
function bodyPath(F, k, add){
  const p = new Path2D(), { X, Y, NX, NY, W } = F;
  for (const [a, b] of F.runs){
    if (b <= a){ const w = W[a] * k + add; p.moveTo(X[a] + w, Y[a]); p.arc(X[a], Y[a], w, 0, TAU); continue; }
    const side = (from, to, sg) => {
      const dir = to > from ? 1 : -1;
      let w = W[from] * k + add, px = X[from] + NX[from] * w * sg, py = Y[from] + NY[from] * w * sg;
      if (from === a && sg === 1) p.moveTo(px, py); else p.lineTo(px, py);
      for (let j = from + dir; j !== to + dir; j += dir){
        w = W[j] * k + add; const x = X[j] + NX[j] * w * sg, y = Y[j] + NY[j] * w * sg;
        if (j === to) p.lineTo(x, y); else p.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x; py = y;
      }
    };
    side(a, b, 1);
    const wb = W[b] * k + add, ab = Math.atan2(NY[b], NX[b]);
    p.arc(X[b], Y[b], wb, ab, ab - Math.PI, true);
    side(b, a, -1);
    const wa = W[a] * k + add, aa = Math.atan2(NY[a], NX[a]);
    p.arc(X[a], Y[a], wa, aa + Math.PI, aa, true);
    p.closePath();
  }
  return p;
}
// поперечные полосы как контуры: period/duty в мировых единицах, phase сдвигает узор
function bandsPath(F, period, duty, phase, k){
  const p = new Path2D(), { X, Y, NX, NY, W, idx, gap } = F, on = duty * period;
  for (const [a, b] of F.runs){
    let L = null, Rr = null;
    const flush = () => {
      if (L && L.length > 2){ p.moveTo(L[0], L[1]); for (let i = 2; i < L.length; i += 2) p.lineTo(L[i], L[i + 1]); for (let i = Rr.length - 2; i >= 0; i -= 2) p.lineTo(Rr[i], Rr[i + 1]); p.closePath(); }
      L = Rr = null;
    };
    const at = (j, f) => {
      const x = X[j] + (X[j + 1] - X[j]) * f, y = Y[j] + (Y[j + 1] - Y[j]) * f;
      const nx = NX[j] + (NX[j + 1] - NX[j]) * f, ny = NY[j] + (NY[j + 1] - NY[j]) * f, w = Math.max(W[j], W[j + 1]) * k * 1.25;
      return [x + nx * w, y + ny * w, x - nx * w, y - ny * w];
    };
    for (let j = a; j < b; j++){
      const r0 = idx[j] * gap, r1 = idx[j + 1] * gap, len = r1 - r0; if (len <= 0) continue;
      // крайние участки продлеваем на радиус, чтобы узор покрывал закруглённые голову и хвост
      const s0 = r0 - (j === a ? W[a] * 1.3 : 0), s1 = r1 + (j === b - 1 ? W[b] * 1.3 : 0);
      let t = s0, guard = 0;
      while (t < s1 - 1e-4 && guard++ < 96){
        const ph = (((t + phase) % period) + period) % period, isOn = ph < on;
        const te = Math.min(s1, t + Math.max(1e-3, isOn ? on - ph : period - ph));
        if (isOn){
          const A = at(j, (t - r0) / len), B = at(j, (te - r0) / len);
          if (!L){ L = [A[0], A[1]]; Rr = [A[2], A[3]]; }
          L.push(B[0], B[1]); Rr.push(B[2], B[3]);
          if (te < s1 - 1e-4) flush();
        } else if (L) flush();
        t = te;
      }
    }
    flush();
  }
  return p;
}
// лента вдоль тела: off(i) — смещение в долях ширины
function ribbonF(g, F, off){
  g.beginPath();
  for (const [a, b] of F.runs){
    for (let j = a; j <= b; j++){
      const d = off(F.idx[j]) * F.W[j], x = F.X[j] + F.NX[j] * d, y = F.Y[j] + F.NY[j] * d;
      j === a ? g.moveTo(x, y) : g.lineTo(x, y);
    }
  }
}
function eachSample(F, fn){ for (const [a, b] of F.runs) for (let j = a; j <= b; j++) fn(F.idx[j], F.X[j], F.Y[j], F.NX[j], F.NY[j], F.W[j]); }
const GLOWY = new Set(['electric','galaxy','cyber','embers','aurora','pulse']);
const hexA2 = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

function drawTube(g, pts, r, sk, time, travel, boost, view, px, gulps, hero){
  if (pts.length < 2) return;
  const F = bodyFrame(pts, r, view, gulps, { t: time * (boost ? 9 : 6) + (travel || 0) * .02, a: (boost ? .3 : .22) });
  if (!F.runs.length) return;
  const detail = px === undefined || px > 5;
  const body = bodyPath(F, 1, 0), outline = bodyPath(F, 1, 1.8);
  const big = px === undefined || px > 9;
  if (!LOW && big && (hero || px === undefined || F.m < 140)){ g.save(); g.translate(r * .22, r * .42); g.fillStyle = 'rgba(0,0,0,.33)'; g.fill(outline); g.restore(); }
  if ((sk.glow || boost) && !LOW && big){
    if (sk.type === 'neon'){ g.globalCompositeOperation = 'lighter'; g.fillStyle = sk.glow; g.fill(bodyPath(F, 2.1, 4)); g.globalCompositeOperation = 'source-over'; }
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = boost ? hexA2(sk.cols ? sk.cols[0] : sk.base, .35) : sk.glow; g.fill(bodyPath(F, boost ? 1.75 : 1.45, 2));
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = sk.dark; g.fill(outline);
  g.fillStyle = sk.base; g.fill(body);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (detail){
    g.save(); g.clip(body);
    skinLayer(g, F, sk, time, r);
    volumeLayer(g, F, body, r, sk, big);
    g.restore();
  }
}
/* Объём «трубки» как в slither: края темнеют, середина светлее, поперёк идут мягкие кольца-сегменты,
   сверху — узкий блик. Всё рисуется внутри контура тела. */
function volumeLayer(g, F, body, r, sk, big){
  if (big && !LOW){                                                    // кольца сегментов
    g.fillStyle = 'rgba(0,0,0,.1)'; g.fill(bandsPath(F, r * .95, .18, 0, 1));
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fill(bandsPath(F, r * .95, .25, r * .5, 1));
  }
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,.26)'; g.lineWidth = r * .62; g.stroke(body);   // затемнение краёв
  g.strokeStyle = 'rgba(0,0,0,.2)';  g.lineWidth = r * .26; g.stroke(body);
  g.fillStyle = 'rgba(255,255,255,.09)'; g.fill(bodyPath(F, .5, 0));          // светлая середина
  g.save(); g.translate(-r * .2, -r * .27);
  g.fillStyle = 'rgba(255,255,255,.14)'; g.fill(bodyPath(F, .3, 0));
  g.fillStyle = 'rgba(255,255,255,.32)'; g.fill(bodyPath(F, .1, 0));           // блик
  g.restore();
}
function skinLayer(g, F, sk, time, r){
  const lighter = () => g.globalCompositeOperation = 'lighter', normal = () => g.globalCompositeOperation = 'source-over';
  switch (sk.type){
    case 'seq': {
      // цветные секции, которые медленно «текут» по телу
      const L = r * (sk.len || 1), per = L * sk.cols.length, ph = -time * 22 * (sk.flow || 1);
      for (let c = 1; c < sk.cols.length; c++){ g.fillStyle = sk.cols[c]; g.fill(bandsPath(F, per, 1 / sk.cols.length + .004, ph + (sk.cols.length - c) * L, 1.002)); }
      // пробегающий блик
      lighter(); g.fillStyle = 'rgba(255,255,255,.1)'; g.fill(bandsPath(F, r * 18, .08, -time * 260, .9)); normal();
      if (sk.fx){ const fx = sk.fx; sk.fx = null; const t0 = sk.type; sk.type = fx; skinLayer(g, F, sk, time, r); sk.type = t0; sk.fx = fx; }
      break; }
    case 'solid': break;
    case 'neon':
      lighter();
      g.fillStyle = 'rgba(255,255,255,.22)'; g.fill(bandsPath(F, r * 4.2, .38, -time * 40, .75));   // светящиеся «капсулы»
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(bodyPath(F, .35, 0));                           // яркая сердцевина
      normal(); break;
    case 'stripes':
      g.fillStyle = sk.stripe; g.fill(bandsPath(F, r * 1.7, .42, 0, .99)); break;
    case 'rainbow': {
      const cols = ['#ff4d6d','#ff9f1c','#ffe14d','#4dff88','#3db8ff','#9b5cff'], L = r * .95;
      cols.forEach((c, k) => { g.fillStyle = c; g.fill(bandsPath(F, L * 6, 1 / 6 + .004, -time * 70 + k * L, 1)); });
      break; }
    case 'shimmer':
      lighter(); g.fillStyle = 'rgba(255,245,200,.22)'; g.fill(bandsPath(F, r * 11, .12, -time * 180, .8)); normal(); break;
    case 'electric': {
      lighter();
      for (let k = 0; k < 3; k++){
        ribbonF(g, F, i => Math.sin(i * .45 + time * 3 + k * 2.1) * .32 + Math.sin(i * 1.25 - time * 5.5 + k * 4.3) * .18 + Math.sin(i * 2.7 + time * 9 + k) * .07);
        const fl = .8 + .2 * Math.sin(time * 17 + k * 2);
        if (!LOW){ g.strokeStyle = `rgba(150,80,255,${.3 * fl})`; g.lineWidth = Math.max(2, r * .6); g.stroke(); }
        g.strokeStyle = sk.bolt; g.globalAlpha = fl; g.lineWidth = Math.max(1.2, r * .24); g.stroke();
        g.strokeStyle = 'rgba(245,232,255,.95)'; g.lineWidth = Math.max(.7, r * .08); g.stroke(); g.globalAlpha = 1;
      }
      normal(); break; }
    case 'fire': {
      lighter();
      const fc = [['rgba(255,70,0,.8)', .5], ['rgba(255,150,0,.75)', .32], ['rgba(255,230,120,.7)', .15]];
      for (let k = 0; k < 3; k++){
        ribbonF(g, F, i => Math.sin(i * .45 - time * 7 + k * 2.1) * .4 + Math.sin(i * 1.3 + time * 3 + k) * .1);
        g.strokeStyle = fc[k][0]; g.lineWidth = Math.max(1, r * fc[k][1] * 1.4); g.stroke();
      }
      normal(); break; }
    case 'galaxy':
      lighter();
      ribbonF(g, F, i => Math.sin(i * .25 + time * 1.2) * .35); g.strokeStyle = 'rgba(120,60,255,.32)'; g.lineWidth = r * .9; g.stroke();
      ribbonF(g, F, i => Math.sin(i * .2 - time + 2) * .4); g.strokeStyle = 'rgba(40,160,255,.24)'; g.lineWidth = r * .6; g.stroke();
      eachSample(F, (i, x, y, nx, ny, w) => {
        const hh = hash(i * 3.1); if (hh > .45) return;
        const a = .45 + .55 * Math.sin(time * 2.4 + hh * 40), o = (hash(i + .5) - .5) * 1.3;
        g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(x + nx * w * o, y + ny * w * o, r * (.06 + hh * .18), 0, TAU); g.fill();
      });
      normal(); break;
    case 'aurora':
      lighter();
      for (let k = 0; k < 3; k++){
        ribbonF(g, F, i => Math.sin(i * .16 - time * 1.4 + k * 2.1) * .42);
        g.strokeStyle = `hsla(${(time * 30 + k * 70 + 120) % 360},95%,60%,.45)`; g.lineWidth = r * (.75 - k * .18); g.stroke();
      }
      normal(); break;
    case 'pulse':
      lighter();
      g.fillStyle = `hsla(${(time * 50) % 360},100%,62%,.5)`; g.fill(bandsPath(F, r * 5.6, .4, -time * 200, .85));
      g.fillStyle = `hsla(${(time * 50 + 160) % 360},100%,62%,.38)`; g.fill(bandsPath(F, r * 5.6, .25, -time * 200 - r * 2.8, .55));
      normal(); break;
    case 'waves':
      lighter();
      for (let k = 0; k < 2; k++){ ribbonF(g, F, i => Math.sin(i * .4 - time * 4.5 + k * Math.PI) * .45); g.strokeStyle = 'rgba(210,240,255,.5)'; g.lineWidth = Math.max(1, r * .13); g.stroke(); }
      normal(); break;
    case 'petals':
      eachSample(F, (i, x, y, nx, ny, w) => {
        if (i % 6 !== 3 && !(F.idx[1] > 1 && i % 6 < 3 && hash(i) < .3)) return;
        const hh = hash(i * 1.3), o = (hh - .5) * .8, cx = x + nx * w * o, cy = y + ny * w * o, pr = r * .2, rot = time * .6 + hh * 6;
        g.fillStyle = 'rgba(255,255,255,.92)';
        for (let k = 0; k < 5; k++){ const a = rot + k * TAU / 5; g.beginPath(); g.arc(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, pr * .72, 0, TAU); g.fill(); }
        g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(cx, cy, pr * .5, 0, TAU); g.fill();
      });
      break;
    case 'cyber':
      lighter();
      for (const side of [-1, 1]){ ribbonF(g, F, () => side * .62); g.strokeStyle = 'rgba(0,255,240,.8)'; g.lineWidth = Math.max(1, r * .1); g.stroke(); }
      g.fillStyle = 'rgba(255,40,200,.6)'; g.fill(bandsPath(F, r * 4, .22, -time * 220, .3));
      normal(); break;
    case 'embers':
      lighter();
      eachSample(F, (i, x, y, nx, ny, w) => {
        const hh = hash(i * 4.7), a = .5 + .5 * Math.sin(time * 2 + hh * 30); if (a < .3 || hh > .5) return;
        const o = (hash(i + .2) - .5) * 1.2;
        g.fillStyle = `rgba(255,${(60 + hh * 120) | 0},40,${a * .8})`;
        g.beginPath(); g.arc(x + nx * w * o, y + ny * w * o, r * (.08 + hh * .14), 0, TAU); g.fill();
      });
      normal(); break;
    case 'bubbles':
      eachSample(F, (i, x, y, nx, ny, w) => {
        const hh = hash(i * 1.7); if (hh > .35) return;
        const br = r * (.12 + hh * .2) * (1 + .2 * Math.sin(time * 3 + hh * 30)), o = Math.sin(time * 1.2 + hh * 20) * .5;
        const cx = x + nx * w * o, cy = y + ny * w * o;
        g.fillStyle = 'rgba(210,255,170,.5)'; g.beginPath(); g.arc(cx, cy, br, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(cx - br * .3, cy - br * .3, br * .3, 0, TAU); g.fill();
      });
      break;
    case 'sparkle':
      eachSample(F, (i, x, y, nx, ny, w) => {
        const hh = hash(i * 2.3), a = Math.sin(time * 2.6 + hh * 50); if (a < .6 || hh > .5) return;
        const z = r * .32 * (a - .6) / .4, o = (hash(i + .3) - .5), cx = x + nx * w * o, cy = y + ny * w * o;
        g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath();
        g.moveTo(cx, cy - z); g.lineTo(cx + z * .2, cy - z * .2); g.lineTo(cx + z, cy); g.lineTo(cx + z * .2, cy + z * .2);
        g.lineTo(cx, cy + z); g.lineTo(cx - z * .2, cy + z * .2); g.lineTo(cx - z, cy); g.lineTo(cx - z * .2, cy - z * .2); g.fill();
      });
      break;
  }
}
// большие «пучеглазые» глаза, как в slither
function drawEyes(g, w, r){
  const h = w.segs[0], ca = Math.cos(w.ang), sa = Math.sin(w.ang);
  const lk = w.look === undefined ? w.target : w.look;
  const look = w.ang + clamp(angDiff(lk, w.ang), -.7, .7), lc = Math.cos(look), ls = Math.sin(look);
  const er = r * .68;
  for (const side of [-1, 1]){
    const ex = h.x + ca * r * .35 - sa * r * .6 * side, ey = h.y + sa * r * .35 + ca * r * .6 * side;
    if (w.blink < 0){
      g.fillStyle = w.skin.base; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
      g.strokeStyle = w.skin.dark; g.lineWidth = Math.max(1.2, r * .12);
      g.beginPath(); g.arc(ex, ey, er * .7, w.ang - 1.2, w.ang + 1.2); g.stroke();
      continue;
    }
    if (SPR.eye){ const hh = SPR.eye.half * er / 10; g.drawImage(SPR.eye.c, ex - hh, ey - hh, hh * 2, hh * 2); }
    const px = ex + lc * er * .36, py = ey + ls * er * .36;
    g.fillStyle = '#0b0b10'; g.beginPath(); g.arc(px, py, er * .52, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(px - er * .17, py - er * .2, er * .14, 0, TAU); g.fill();
  }
}
function drawSkinPreview(cnv, def, time){
  const g = cnv.getContext('2d'), W = cnv.width, H = cnv.height, r = H * .12, n = Math.floor((W - 46) / (r * .55));
  if (!cnv._sk) cnv._sk = makeSkin(def);
  g.clearRect(0, 0, W, H);
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: W - 26 - i * r * .55, y: H / 2 + Math.sin(i * .16 - time * 2.4) * H * .16 });
  drawTube(g, pts, r, cnv._sk, time, time * 60, false);
  const a = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
  drawEyes(g, { segs: pts, ang: a, target: a, blink: 1, skin: cnv._sk }, r);
}
function coinSprite(c){
  const sp = { c: document.createElement('canvas'), half: c.r * 1.6, r: c.r };
  sp.c.width = sp.c.height = 64;
  const img = new Image();
  img.onload = () => { const g = sp.c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 64, 64); g.drawImage(img, 0, 0, 64, 64); };
  img.src = c.img || COIN_IMG[c.id];
  return sp;
}
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function orbCore(col){
  return makeSprite(6, (g, r) => {
    const core = g.createRadialGradient(-r * .3, -r * .35, 0, 0, 0, r);
    core.addColorStop(0, '#ffffff'); core.addColorStop(.3, col); core.addColorStop(1, hexA(col, .9));
    g.fillStyle = core; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  }, 3);
}
function orbSprite(col){
  return makeSprite(5 * 4.2, (g, R0) => {
    const r = 5;
    const gl = g.createRadialGradient(0, 0, 0, 0, 0, R0);
    for (let i = 0; i <= 8; i++){ const t = i / 8; gl.addColorStop(t, col + Math.round(230 * Math.pow(1 - t, 2)).toString(16).padStart(2, '0')); }
    g.fillStyle = gl; g.fillRect(-R0, -R0, R0 * 2, R0 * 2);
    const core = g.createRadialGradient(-r * .3, -r * .35, 0, 0, 0, r);
    core.addColorStop(0, '#ffffff'); core.addColorStop(.35, col); core.addColorStop(1, col);
    g.fillStyle = core; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  }, 2);
}
function buildSprites(){
  if (!SPR.shield) SPR.shield = coinSprite({ id: '_shield', r: 12, img: SHIELD_IMG });
  SPR.shieldG = glowSprite('rgba(80,200,255,.9)', 12 * 3.6);
  for (const c of COINS){ if (!SPR[c.spr]) SPR[c.spr] = coinSprite(c); SPR[c.spr + 'G'] = glowSprite(c.glow, c.r * 3.6); }
  ORB_COLS.forEach((col, i) => {
    const glow = glowSprite(hexA(col, .8), 5 * 3.6), core = orbCore(col);
    SPR['o' + i] = makeSprite(5 * 3.6, g => { g.drawImage(glow.c, -glow.half, -glow.half, glow.half * 2, glow.half * 2); g.drawImage(core.c, -core.half, -core.half, core.half * 2, core.half * 2); }, 2);
    SPR['o' + i + 'C'] = core;
  });
  SPR.mine   = makeSprite(18, mine, 3);
  SPR.eye = makeSprite(10, (g, r) => {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(1, 1.6, r, 0, TAU); g.fill();
    const eg = g.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r); eg.addColorStop(0, '#ffffff'); eg.addColorStop(1, '#d9dde6');
    g.fillStyle = eg; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
  }, 4);
  SPR.portalG = glowSprite('rgba(255,190,60,.85)', 170);
  SPR.rays   = makeSprite(44, (g, r) => {
    for (let k = 0; k < 4; k++){
      g.save(); g.rotate(k * Math.PI / 4);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, r, r * (k % 2 ? .05 : .09), 0, 0, TAU); g.fill(); g.restore();
    }
  }, 1);
  SPR.mineG  = glowSprite('rgba(255,30,60,.7)', 18 * 3.2);
  SPR.sparkG = glowSprite('rgba(255,170,60,.95)', 14);
  SPR.boostG = glowSprite('rgba(255,255,255,.5)', SKIN_R * 1.9);
  SPR.shadow = makeSprite(10,  shadowBlob, 1);
  const blot = col => (g, r) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); };
  SPR.blotD = makeSprite(64, blot('rgba(0,0,0,.28)'), 1);
  SPR.blotL = makeSprite(64, blot('rgba(140,160,190,.05)'), 1);
  SPR.dust   = makeSprite(3,   (g, r) => { g.fillStyle = 'rgba(214,190,150,.7)'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,240,210,.6)'; g.beginPath(); g.arc(-.8, -.8, r * .45, 0, TAU); g.fill(); });
  renderLegend();
}

/* ================== КАРТА ================== */
const MAP = { blots: [] };
let hexPat = null;
function genMap(){
  const rnd = rng(20261009);
  for (let i = 0; i < 180; i++){
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * ARENA;
    MAP.blots.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 220 + rnd() * 480, dark: rnd() < .55 });
  }
}

/* ================== ЕДА ================== */
/* Карта засыпана светящимися шариками — они дают только рост.
   Монеты (деньги) на карте появляются очень редко, основной источник — погибшие черви.

   ТАБЛИЦА ВЫПЛАТ (★ при ставке 100, дальше × ставка/100)
   монета          выплата   на карте   из червя
   money_1            1 ★       70%        62%
   rybin_1            3 ★       22%        22%
   emerald_1          8 ★        8%       9.5%
   FIRE_COIN         20 ★        —        4.2%
   GREEN_COIN        50 ★        —        1.8%
   WIND_COIN        100 ★        —        0.5%
   Червь рассыпается на ~1.5× больше монет (масса / 4), средняя монета из червя ≈ 4.3 ★,
   поэтому общая сумма с червя прежняя (≈ масса × 1.08 ★). Средняя монета на карте ≈ 2 ★. */
const COIN_IMG = {
  money: 'assets/coins/money_1.png',
  ruby: 'assets/coins/rybin_1.png',
  emerald: 'assets/coins/emerald_1.png',
  fire: 'assets/coins/FIRE_COIN.png',
  green: 'assets/coins/GREEN_COIN.png',
  wind: 'assets/coins/WIND_COIN.png',
};
const COINS = [
  { id: 'money',   v: 1,   m: 1.2, r: 10, fieldW: 70, dropW: 62,  glow: 'rgba(255,190,40,.85)', fc: '#ffd25e' },
  { id: 'ruby',    v: 3,   m: 1.6, r: 10, fieldW: 22, dropW: 22,  glow: 'rgba(255,45,60,.9)',   fc: '#ff6b7d' },
  { id: 'emerald', v: 8,   m: 2.2, r: 10, fieldW: 8,  dropW: 9.5,  glow: 'rgba(60,255,90,.9)',   fc: '#7dff9a' },
  { id: 'fire',    v: 20,  m: 3,   r: 11, fieldW: 0,  dropW: 4.2,  glow: 'rgba(255,110,20,1)',   fc: '#ffa040' },
  { id: 'green',   v: 50,  m: 3.5, r: 11, fieldW: 0,  dropW: 1.8, glow: 'rgba(170,255,40,1)',   fc: '#d4ff5e' },
  { id: 'wind',    v: 100, m: 4,   r: 12, fieldW: 0,  dropW: .5,  glow: 'rgba(40,220,255,1)',   fc: '#7fe9ff' },
];
COINS.forEach(c => c.spr = 'c_' + c.id);
const TYPES = COINS;
const ORB_COLS = ['#ff4d6d','#ffb34d','#ffe14d','#5dff8f','#4dd8ff','#6f7dff','#c86bff','#ff6bd6'];
const ORB = { v: 0, m: .8, r: 5, orb: true };
const DUST = { v: 0, m: .6, r: 3, spr: 'dust' };
const BOMB = { v: 0, m: 0, r: 18, spr: 'mine', bomb: true };
const SHIELD = { v: 0, m: 0, r: 12, spr: 'shield', shield: true };
const SHIELD_SEC = 6, SHIELD_FIELD_N = 10;        // защита от мин 6 секунд; щитов на карте
const SHIELD_IMG = 'assets/shield.png';
const ORB_N = 2000, COIN_FIELD_N = 45;
let ORB_CUR = ORB_N;   // шариков на карте / монет на карте (очень мало)
function pickCoin(fromWorm){
  let tot = 0; for (const c of COINS) tot += fromWorm ? c.dropW : c.fieldW;
  let x = Math.random() * tot;
  for (const c of COINS){ x -= fromWorm ? c.dropW : c.fieldW; if (x <= 0) return c; }
  return COINS[0];
}
let foods = [];
function addFood(x, y, t, life){
  if (x * x + y * y > (ARENA - 20) ** 2) return;
  foods.push({ x, y, t, spr: t.orb ? 'o' + ((Math.random() * ORB_COLS.length) | 0) : t.spr, ph: Math.random() * TAU, life: life || 0, born: 0 });
}
function randPoint(margin){ const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (ARENA - margin); return { x: Math.cos(a) * d, y: Math.sin(a) * d }; }

/* ================== ЧЕРВИ ================== */
const NAMES = ['Шнурок','Удав','Лапша','Слизень','Бублик','Пиявка','Мармелад','Анаконда','Червяк Ваня','Гусеница','Кишка','Король ямы','Фартовый','Крупье','Джекпот','Ползун','Макаронина','Сосиска','Корешок','Дождевик','Спагетти','Барон','Ленточка','Хвостик','Полоз','Змей Горыныч','Фортуна','Ставочник','Банкир','Кэшбэк','Мажор','Шустрик','Бонус','Фишка','Рулетка','Тусовщик'];
let worms = [], player = null, floaters = [], parts = [], sucks = [], shake = 0;
const rad = w => Math.min(38, 9 + Math.sqrt(Math.max(0, w.mass)) * 1.1); // толще с ростом, как в slither
const targetLen = w => Math.min(480, INIT_LEN + Math.floor(w.mass * 0.9));

function makeWorm(x, y, o){
  const ang = Math.random() * TAU;
  const w = { ang, target: ang, segs: [], mass: o.mass || 0, boost: false, alive: true, dead: false,
    isPlayer: !!o.player, name: o.name, aggr: !!o.aggr, ai: { t: 0 }, dropAcc: 0, tick: 0, spent: 0,
    kami: 0, deflectT: 0, huntRoll: Math.random(), huntT: 3, blink: 2 + Math.random() * 4,
    av: 0, wt: 0, look: ang, gulps: [], shield: 0, betK: .75 + Math.random() * .6, calm: 1, calmK: 1, seed: Math.random() * 10, wf: .6 + Math.random() * 1.2,
    wobble: o.player ? 0 : .2 + Math.random() * .35, agile: .8 + Math.random() * .45,
    minX: x, minY: y, maxX: x, maxY: y, killer: null };
  w.skin = o.player ? makeSkin(SKINS.find(k => k.id === S.skin) || SKINS[0]) : botSkin();
  w.mapColor = w.skin.map;
  // тело строится от головы назад; боты лежат дугой/спиралью, а не палкой через полкарты
  const n = targetLen(w), r = rad(w), gap = r * .55;
  const curl = o.curl ? (Math.random() < .5 ? 1 : -1) : 0;
  let a = ang + Math.PI, px = x, py = y;
  for (let i = 0; i < n; i++){
    w.segs.push({ x: px, y: py });
    if (curl) a += curl * gap / (110 + i * gap * .16);
    px += Math.cos(a) * gap; py += Math.sin(a) * gap;
  }
  bbox(w);
  return w;
}
function bbox(w){
  const r = rad(w); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of w.segs){ if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x; if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y; }
  w.minX = x0 - r; w.minY = y0 - r; w.maxX = x1 + r; w.maxY = y1 + r;
}
// минимальное расстояние между телами двух червей (с шагом для скорости)
function bodyGapOk(a, b, m){
  if (a.maxX < b.minX - m || a.minX > b.maxX + m || a.maxY < b.minY - m || a.minY > b.maxY + m) return true;
  const lim = (m + rad(a) + rad(b)) ** 2, sa = a.segs, sb = b.segs;
  for (let i = 0; i < sa.length; i += 4){
    const p = sa[i];
    if (p.x < b.minX - m || p.x > b.maxX + m || p.y < b.minY - m || p.y > b.maxY + m) continue;
    for (let j = 0; j < sb.length; j += 4){ const dx = sb[j].x - p.x, dy = sb[j].y - p.y; if (dx * dx + dy * dy < lim) return false; }
  }
  return true;
}
function spawnOk(w){
  const lim = (ARENA - 160) ** 2;
  for (const s of w.segs) if (s.x * s.x + s.y * s.y > lim) return false;
  // не в поле зрения камеры
  const hw = VW / 2 / cam.z + VIEW_MARGIN, hh = VH / 2 / cam.z + VIEW_MARGIN;
  if (w.maxX > cam.x - hw && w.minX < cam.x + hw && w.maxY > cam.y - hh && w.minY < cam.y + hh) return false;
  // не в других червях, особенно в игроке
  for (const o of worms){
    if (!o.alive) continue;
    if (!bodyGapOk(w, o, o.isPlayer ? SPAWN_GAP_PLAYER : SPAWN_GAP)) return false;
  }
  return true;
}
// у каждого «игрока» своя ставка — как будто в комнате люди с разными ставками
function botBet(){
  const r = Math.random();
  return r < .28 ? 100 : r < .48 ? 250 : r < .66 ? 500 : r < .8 ? 1000 : r < .9 ? 2500 : r < .96 ? 5000 : r < .99 ? 10000 : 50000;
}
function spawnBot(){
  const used = new Set(worms.map(w => w.name)), free = NAMES.filter(n => !used.has(n));
  const name = free.length ? free[(Math.random() * free.length) | 0] : NAMES[(Math.random() * NAMES.length) | 0];
  const roll = Math.random();
  const mass = roll < .12 ? 350 + Math.random() * 450      // гигант
             : roll < .4  ? 60 + Math.random() * 180       // средний
             : Math.random() * 50;                         // мелкий
  const hue = (Math.random() * 360) | 0, aggr = Math.random() < .4;
  for (let k = 0; k < 24; k++){
    const p = randPoint(400);
    const w = makeWorm(p.x, p.y, { name, hue, mass, aggr, curl: true });
    if (spawnOk(w)){ worms.push(w); return true; }
  }
  return false; // не нашлось места — попробуем в следующем кадре
}
function angDiff(a, b){ let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

function updateWorm(w, dt){
  const r = rad(w);
  if (w.boost && w.mass < 1) w.boost = false;
  // поворот через угловую скорость с инерцией — без рывков
  const maxTurn = (w.isPlayer ? 5.2 : 3.6 * w.agile) * (w.boost ? .85 : 1);
  let goal = w.target;
  w.wt += dt;
  if (!w.isPlayer){ w.calmK += ((w.calm === 0 ? 0 : 1) - w.calmK) * Math.min(1, dt * 3); goal += (Math.sin(w.wt * w.wf + w.seed) + .45 * Math.sin(w.wt * w.wf * 2.3 + w.seed * 3)) * w.wobble * w.calmK; }   // змеиное покачивание
  const desAv = clamp(angDiff(goal, w.ang) * 6, -maxTurn, maxTurn);
  w.av += (desAv - w.av) * Math.min(1, dt * (w.isPlayer ? 11 : 5));
  w.ang += w.av * dt;
  w.look += angDiff(w.target, w.look) * Math.min(1, dt * 6);
  for (let i = w.gulps.length - 1; i >= 0; i--){ w.gulps[i] += dt * 38; if (w.gulps[i] > w.segs.length * .85) w.gulps.splice(i, 1); }
  if (w.shield > 0) w.shield -= dt;
  const sp = w.isPlayer ? (w.boost ? P_BOOST : P_SPEED) : (w.boost ? B_BOOST : B_SPEED);
  const h = w.segs[0];
  w.px = h.x; w.py = h.y; w.travel = (w.travel || 0) + sp * dt;
  h.x += Math.cos(w.ang) * sp * dt; h.y += Math.sin(w.ang) * sp * dt;
  const gap = r * .55;
  let minX = h.x, maxX = h.x, minY = h.y, maxY = h.y;
  for (let i = 1; i < w.segs.length; i++){
    const p = w.segs[i - 1], s = w.segs[i];
    const dx = s.x - p.x, dy = s.y - p.y, dd = Math.hypot(dx, dy);
    if (dd > gap){ const k = gap / dd; s.x = p.x + dx * k; s.y = p.y + dy * k; }
    if (s.x < minX) minX = s.x; else if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; else if (s.y > maxY) maxY = s.y;
  }
  w.minX = minX - r; w.maxX = maxX + r; w.minY = minY - r; w.maxY = maxY + r;
  const want = targetLen(w);
  while (w.segs.length < want){ const t = w.segs[w.segs.length - 1]; w.segs.push({ x: t.x, y: t.y }); }
  if (w.segs.length > want) w.segs.length = Math.max(INIT_LEN, want);
  if (w.boost){
    w.dropAcc += dt;
    if (w.dropAcc > .1){
      w.dropAcc = 0; w.mass = Math.max(0, w.mass - BOOST_SHRINK);
      const t = w.segs[w.segs.length - 1]; addFood(t.x, t.y, DUST);
      if (w.isPlayer && S.playing && S.round > 0){ const c = Math.min(S.round, BOOST_COST * S.mult); S.round -= c; w.spent += c; }
      if (w.isPlayer && ++w.tick % 4 === 0 && w.spent > 0){ floater(t.x, t.y, '−' + fmt(w.spent), '#ff8a9a', .9); w.spent = 0; }
    }
  }
  w.blink -= dt; if (w.blink < -.12) w.blink = 2 + Math.random() * 4;
  if (w.deflectT > 0) w.deflectT -= dt;
  if (w.kami > 0) w.kami -= dt;
  if (h.x * h.x + h.y * h.y > (ARENA - r) ** 2) w.dead = true;
}

/* ================== СЕТКА ==================
   Сегменты и еда раскладываются по клеткам 64×64 каждый кадр,
   поэтому столкновения, поедание и ИИ проверяют только соседние клетки. */
const CELL = 64, GOFF = ARENA + 300, GW = Math.ceil(GOFF * 2 / CELL);
const segGrid = Array.from({ length: GW * GW }, () => []), foodGrid = Array.from({ length: GW * GW }, () => []);
const segUsed = [], foodUsed = [];
const cellOf = x => ((x + GOFF) / CELL) | 0;
function gridPut(grid, used, x, y, val){
  const cx = cellOf(x), cy = cellOf(y);
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GW) return;
  const a = grid[cy * GW + cx]; if (!a.length) used.push(cy * GW + cx); a.push(val);
}
function gridClear(grid, used){ for (let i = 0; i < used.length; i++) grid[used[i]].length = 0; used.length = 0; }
function buildGrids(){
  gridClear(segGrid, segUsed); gridClear(foodGrid, foodUsed);
  for (let wi = 0; wi < worms.length; wi++){
    const w = worms[wi]; w.gi = wi; if (!w.alive) continue;
    const s = w.segs, n = s.length;
    for (let i = 0; i < n; i += 2) gridPut(segGrid, segUsed, s[i].x, s[i].y, wi * 1024 + i);
    if (!(n & 1)) gridPut(segGrid, segUsed, s[n - 1].x, s[n - 1].y, wi * 1024 + n - 1);
  }
  for (let i = 0; i < foods.length; i++){ const f = foods[i]; if (!f.gone) gridPut(foodGrid, foodUsed, f.x, f.y, i); }
}
function gridEach(grid, x, y, rr, cb){
  const x0 = Math.max(0, cellOf(x - rr)), x1 = Math.min(GW - 1, cellOf(x + rr));
  const y0 = Math.max(0, cellOf(y - rr)), y1 = Math.min(GW - 1, cellOf(y + rr));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++){
    const a = grid[cy * GW + cx];
    for (let i = 0; i < a.length; i++) if (cb(a[i])) return true;
  }
  return false;
}

function eat(w){
  const h = w.segs[0], r = rad(w), grab = r + (w.isPlayer ? 26 : 16);
  gridEach(foodGrid, h.x, h.y, grab + 18, idx => {
    const f = foods[idx]; if (f.gone) return false;
    const t = f.t, dx = h.x - f.x, dy = h.y - f.y, lim = t.bomb ? r + t.r * .7 : grab + t.r;
    if (dx * dx + dy * dy > lim * lim) return false;
    f.gone = true;
    if (t.bomb){ if (w.shield > 0){ burst(f.x, f.y, ['#8fe3ff', '#ffffff'], 18, 220); if (w.isPlayer) floater(f.x, f.y, 'щит', '#8fe3ff', 1); } else explode(w, f); return false; }
    if (t.shield){ w.shield = SHIELD_SEC; burst(f.x, f.y, ['#8fe3ff', '#ffffff'], 16, 160); return false; }
    w.mass += t.m;
    if (w.gulps.length < 3 && (!w.gulps.length || w.gulps[w.gulps.length - 1] > 6)) w.gulps.push(0);
    sucks.push({ x: f.x, y: f.y, spr: f.spr, w, t: .12 });
    if (w.isPlayer && S.playing && t.v > 0){
      const won = t.v * S.mult; S.round += won;
      comboAdd(won, t.v);
    }
    return false;
  });
}
// место свободно от тел червей?
function clearOfWorms(x, y, m){
  return !gridEach(segGrid, x, y, m + 40, code => {
    const o = worms[(code / 1024) | 0]; if (!o || !o.alive) return false;
    const s = o.segs[code & 1023]; if (!s) return false;
    const lim = m + rad(o), dx = s.x - x, dy = s.y - y;
    return dx * dx + dy * dy < lim * lim;
  });
}
function spawnMineNear(x, y, ang, spread, dmin, dmax){
  for (let k = 0; k < 6; k++){
    const a = ang + (Math.random() - .5) * spread, d = dmin + Math.random() * (dmax - dmin);
    const mx = x + Math.cos(a) * d, my = y + Math.sin(a) * d;
    if (mx * mx + my * my > (ARENA - 80) ** 2) continue;
    if (!clearOfWorms(mx, my, 70)) continue;
    addFood(mx, my, BOMB, 18 + Math.random() * 16); return true;
  }
  return false;
}
function explode(w, f){
  burst(f.x, f.y, ['#ffb347', '#e2475c', '#fff1c1'], 30, 320);
  smoke(f.x, f.y, 8);
  w.mass *= .85;
  if (w.isPlayer && S.playing){
    const loss = Math.min(S.round, Math.max(5 * S.mult, S.round * BOMB_LOSS));
    S.round -= loss;
    floater(f.x, f.y, '−' + fmt(loss), '#ff6b7d', 1.3);
    shake = 14;
  }
}

function collide(){
  for (let ai = 0; ai < worms.length; ai++){
    const a = worms[ai]; if (!a.alive || a.dead) continue;
    const h = a.segs[0], ra = rad(a);
    let hb = null, hs = null, hlim = 0;
    gridEach(segGrid, h.x, h.y, ra * .7 + 40, code => {
      const wi = (code / 1024) | 0; if (wi === ai) return false;
      const b = worms[wi]; if (!b || !b.alive) return false;
      const s = b.segs[code & 1023]; if (!s) return false;
      const lim = ra * .7 + rad(b), dx = s.x - h.x, dy = s.y - h.y;
      if (dx * dx + dy * dy < lim * lim){ hb = b; hs = s; hlim = lim; return true; }
      return false;
    });
    if (hb) resolveHit(a, hb, hs, hlim);
  }
}
// Кто врезался головой в чужое тело — тот и погиб. Как в slither: окружил бота кольцом,
// сжал круг — бот обязательно врежется. (Деньги с такого бота всё равно ограничены лимитом RTP:
// сверх лимита вместо монет выпадают только шарики.)
function resolveHit(a, b, s, lim){
  a.dead = true; a.killer = b;
}
function kill(w){
  w.alive = false;
  const r = rad(w), byPlayer = w.killer && w.killer.isPlayer && w.killer.alive && S.playing;
  let budget = byPlayer ? Math.max(0, R.cap - S.round) * .8 : Infinity;
  const n = w.segs.length, coins = clamp(Math.round(w.mass / 4), 5, 135), every = Math.max(1, n / coins);
  for (let i = 0; i < n; i += 1.4){                                 // тело рассыпается шариками
    const s = w.segs[i | 0];
    addFood(s.x + (Math.random() - .5) * r * 1.8, s.y + (Math.random() - .5) * r * 1.8, ORB);
  }
  for (let k = 0; k < coins; k++){                                  // и монетами
    const s = w.segs[Math.min(n - 1, Math.floor(k * every))];
    let t = pickCoin(true);
    if (byPlayer){ const val = t.v * S.mult; if (val <= budget) budget -= val; else t = ORB; }
    addFood(s.x + (Math.random() - .5) * r * 2, s.y + (Math.random() - .5) * r * 2, t);
  }
  burst(w.segs[0].x, w.segs[0].y, [w.skin.base, w.skin.hi], 26, 240);
  if (byPlayer){ S.kills++; if (killAllowed() && S.round > 0 && !R.portal) spawnPortal(w.segs[0].x, w.segs[0].y, 0, 180, 11); }   // за убийство — портал рядом
  if (w.isPlayer) endRound(false);
}

/* ================== ИИ ================== */
/* ИИ: бот «щупает» лучами 9 направлений вокруг курса, учитывает тела, предсказанные позиции чужих голов,
   мины и бортик; из свободных направлений выбирает ближайшее к цели (еда / охота / блуждание).
   Ускоряется, когда убегает, догоняет добычу или перехватывает соперника. */
const RAY_OFFS = [0, -.35, .35, -.7, .7, -1.1, 1.1, -1.6, 1.6], RAY_FAR = [0, -.7, .7, -1.4, 1.4];
function botThink(b, dt){
  b.huntT -= dt; if (b.huntT <= 0){ b.huntT = 2 + Math.random() * 3; b.huntRoll = Math.random(); }
  b.ai.t -= dt; if (b.ai.t > 0) return;
  const h = b.segs[0], r = rad(b), pl = player && player.alive ? player : null;
  const camD = Math.hypot(h.x - cam.x, h.y - cam.y), farBot = camD > 1800;
  b.ai.t = farBot ? .3 + Math.random() * .2 : .1 + Math.random() * .1;
  const reach = r * 6 + 160;
  // соседние головы и их положение через ~0.4 с
  const heads = [];
  for (const o of worms){
    if (o === b || !o.alive) continue;
    const oh = o.segs[0], d = Math.hypot(oh.x - h.x, oh.y - h.y);
    if (d > reach + 250) continue;
    const sp = o.boost ? (o.isPlayer ? P_BOOST : B_BOOST) : (o.isPlayer ? P_SPEED : B_SPEED);
    heads.push({ o, x: oh.x + Math.cos(o.ang) * sp * .4, y: oh.y + Math.sin(o.ang) * sp * .4, r: rad(o), d });
  }
  const blockedAt = (x, y) => {
    if (x * x + y * y > (ARENA - r - 40) ** 2) return true;
    for (const q of heads){ const dx = q.x - x, dy = q.y - y, lim = q.r + r + 30; if (dx * dx + dy * dy < lim * lim) return true; }
    if (gridEach(segGrid, x, y, r + 45, code => {
      const wi = (code / 1024) | 0; if (wi === b.gi) return false;
      const o = worms[wi]; if (!o || !o.alive) return false;
      const s = o.segs[code & 1023]; if (!s) return false;
      const lim = rad(o) + r + 16, dx = s.x - x, dy = s.y - y;
      return dx * dx + dy * dy < lim * lim;
    })) return true;
    if (b.shield <= 0 && gridEach(foodGrid, x, y, r + 30, idx => { const f = foods[idx]; return f && !f.gone && f.t.bomb && Math.hypot(f.x - x, f.y - y) < r + f.t.r + 10; })) return true;
    return false;
  };
  const ray = a => {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const d of [r * 1.6, r * 3.2, r * 5, reach * .7, reach]){ if (blockedAt(h.x + ca * d, h.y + sa * d)) return d; }
    return reach * 1.25;
  };
  // 1. чего хотим
  let goal = b.ang + Math.sin(b.wt * .3 + b.seed * 3) * .7, boost = false, want = 'wander';
  if (Math.hypot(h.x, h.y) > ARENA - 500) goal = Math.atan2(-h.y, -h.x);
  let best = null, bs = 0, bestD = 0;
  gridEach(foodGrid, h.x, h.y, 420, idx => {
    const f = foods[idx]; if (!f || f.gone || f.t.bomb) return false;
    const dx = f.x - h.x, dy = f.y - h.y, d2 = dx * dx + dy * dy; if (d2 > 176400) return false;
    const ang = Math.abs(angDiff(Math.atan2(dy, dx), b.ang));
    const sc = (f.t.v * .5 + f.t.m + (f.t.shield ? 4 : 0) + .2) / (Math.sqrt(d2) + 40) * (1.3 - ang / Math.PI);
    if (sc > bs){ bs = sc; best = f; bestD = Math.sqrt(d2); }
    return false;
  });
  if (best){ goal = Math.atan2(best.y - h.y, best.x - h.x); want = 'food'; if ((best.t.v >= 8 || best.t.shield) && bestD > 120 && b.mass > 25) boost = true; }
  // охота: на игрока — по RTP-давлению, на ботов поменьше — по характеру
  if (pl && S.playing){
    const huntP = R.ratio >= 1 ? 1 : (b.aggr ? clamp((R.ratio - .45) * 2, 0, 1) : 0);
    const ph = pl.segs[0], d = Math.hypot(ph.x - h.x, ph.y - h.y);
    if (huntP > 0 && b.huntRoll < huntP && d < (R.ratio >= 1 ? 1000 : 450)){
      const lead = 90 + d * .35;
      goal = Math.atan2(ph.y + Math.sin(pl.ang) * lead - h.y, ph.x + Math.cos(pl.ang) * lead - h.x);
      boost = d < 360 && b.mass > 10; want = 'hunt';
    }
  }
  if (want !== 'hunt' && b.aggr && b.mass > 40){
    for (const q of heads){
      if (q.o.isPlayer || q.o.mass > b.mass * .8 || q.d > 320) continue;
      const lead = 80 + q.d * .4;
      goal = Math.atan2(q.o.segs[0].y + Math.sin(q.o.ang) * lead - h.y, q.o.segs[0].x + Math.cos(q.o.ang) * lead - h.x);
      boost = q.d < 260; want = 'cut'; break;
    }
  }
  // 2. проверяем направления и выбираем лучшее свободное
  let bestA = goal, bestScore = -1e9, straight = 0;
  for (const off of (farBot ? RAY_FAR : RAY_OFFS)){
    const a = b.ang + off, free = ray(a);
    if (off === 0) straight = free;
    const sc = Math.min(free, reach) / reach * 3 - Math.abs(angDiff(a, goal)) * .55 - Math.abs(off) * .12;
    if (sc > bestScore){ bestScore = sc; bestA = a; }
  }
  // если цель прямо видна и путь свободен — идём точно на цель
  const goalFree = ray(goal);
  if (goalFree >= reach && Math.abs(angDiff(goal, b.ang)) < 1.7) bestA = goal;
  b.target = bestA;
  b.calm = straight < reach * .7 ? 0 : 1;                    // в опасности — без покачиваний
  // 3. ускорение: убегаем, догоняем, перехватываем
  const danger = straight < r * 3.4;
  if (danger && b.mass > 14 && ray(bestA) > r * 5) boost = true;
  b.boost = boost && b.mass > 8 && ray(b.ang) > r * 4;
}

/* ================== ЭФФЕКТЫ ================== */
function floater(x, y, txt, c, s){ floaters.push({ x, y, txt, c, s: s || 1, t: 1 }); }
// Подобранные кристаллы складываются в одну цифру над головой, а не сыплются отдельными надписями
const combo = { sum: 0, t: 0, pop: 0, big: false };
function comboAdd(won, v){
  if (combo.t <= 0){ combo.sum = 0; combo.big = false; }
  combo.sum += won; combo.t = 1.2; combo.pop = v >= 20 ? 1 : Math.max(combo.pop, .35);
  if (v >= 20) combo.big = true;
}
function burst(x, y, cols, n, spd){
  for (let i = 0; i < n; i++){
    const a = Math.random() * TAU, sp = spd * (.3 + Math.random() * .7);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .5 + Math.random() * .4, c: cols[(Math.random() * cols.length) | 0], s: 2 + Math.random() * 3 });
  }
}
function smoke(x, y, n){
  for (let i = 0; i < n; i++){
    const a = Math.random() * TAU, sp = 20 + Math.random() * 60;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + Math.random() * .6, c: 'rgba(60,55,50,.5)', s: 10 + Math.random() * 14, smoke: true });
  }
}

/* ================== ВВОД ================== */
const keys = {};
let touchBoost = false;
const pointer = { active: false, x: 0, y: 0 };
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Backquote' && !(window.AG && AG.on)) $('dev').classList.toggle('hidden');
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchBoost = false; });
cv.addEventListener('pointerdown', e => { pointer.active = true; pointer.x = e.clientX; pointer.y = e.clientY; });
cv.addEventListener('pointermove', e => { if (pointer.active){ pointer.x = e.clientX; pointer.y = e.clientY; } });
addEventListener('pointerup', () => { pointer.active = false; });
addEventListener('pointercancel', () => { pointer.active = false; });
const boostBtn = $('boostBtn');
boostBtn.addEventListener('pointerdown', e => { e.preventDefault(); touchBoost = true; });
boostBtn.addEventListener('pointerup', () => { touchBoost = false; });
boostBtn.addEventListener('pointerleave', () => { touchBoost = false; });

/* ================== РАУНД ================== */
const menuEl = $('menu'), resEl = $('result'), hudEl = $('hud');
async function startRound(){
  if (S.balance < S.bet){ showMenu(); return; }
  // ANGOCK: ставку списывает сервер и он же выбирает скрытую точку краша
  let fateM = null;
  if (window.AG && AG.on){
    if (startRound.busy) return;
    startRound.busy = true;
    try { const r = await AG.begin(S.bet); S.balance = r.balance + S.bet; fateM = r.fate && r.fate.M; }
    catch (e){ startRound.busy = false; AG.err(e); showMenu(); return; }
    startRound.busy = false;
  }
  S.balance -= S.bet; S.mult = S.bet / 100; S.round = 0; S.kills = 0; S.playing = true; combo.t = 0;
  S.stats.rounds++; S.stats.bet += S.bet;
  R.M = fateM != null ? fateM : rollCrash(); R.cap = S.bet * R.M; R.window = 0; R.kamiT = 1e9; R.ratio = 0; R.bombAcc = 0; R.portal = null; R.portalT = 7 + Math.random() * 5;
  for (const w of worms) w.kami = 0;
  save();
  // место для игрока: максимально далеко от всех тел и голов ботов
  let best = null, bestD = -1;
  for (let k = 0; k < 80; k++){
    const p = randPoint(700);
    let d = Infinity;
    for (const w of worms){
      if (!w.alive) continue;
      if (p.x < w.minX - 900 || p.x > w.maxX + 900 || p.y < w.minY - 900 || p.y > w.maxY + 900) continue;
      for (let i = 0; i < w.segs.length; i += 2){
        const s = w.segs[i], dd = Math.hypot(s.x - p.x, s.y - p.y) - (i === 0 ? 250 : 0);
        if (dd < d) d = dd;
      }
    }
    if (d > bestD){ bestD = d; best = p; }
    if (d > 650) break;
  }
  const p = best || { x: 0, y: 0 };
  player = makeWorm(p.x, p.y, { player: true, name: 'Ты', mass: 8 });
  player.ang = player.target = Math.atan2(-p.y, -p.x);
  player.segs.forEach((s, i) => { s.x = p.x - Math.cos(player.ang) * i * rad(player) * .55; s.y = p.y - Math.sin(player.ang) * i * rad(player) * .55; });
  bbox(player);
  worms.push(player);
  cam.x = p.x; cam.y = p.y;
  menuEl.classList.add('hidden'); resEl.classList.add('hidden'); hudEl.classList.remove('hidden');
  $('bal').textContent = fmt(S.balance);
  for (const k in hudCache) delete hudCache[k];
}
const canCash = () => false;   // кнопки больше нет: забрать можно только через портал
function cashOut(){
  if (!S.playing || !player || !player.alive) return;
  burst(player.segs[0].x, player.segs[0].y, ['#f2c14e', '#fff1c1'], 46, 300);
  player.alive = false;
  endRound(true);
}
function endRound(cashed){
  if (!S.playing) return;
  S.playing = false;
  const won = cashed ? S.round : 0, multAt = S.round / S.bet;
  if (cashed){ S.balance += won; S.stats.paid += won; }
  if (window.AG && AG.on){ AG.win(cashed ? won : 0).then(b => { S.balance = b; save(); }).catch(() => {}); }
  for (const w of worms) w.kami = 0;
  save();
  setTimeout(() => {
    hudEl.classList.add('hidden');
    $('rtitle').textContent = cashed ? 'Забрал на ×' + multAt.toFixed(2) : 'Тебя съели';
    $('rsum').textContent = fmt(cashed ? won : S.round);
    $('rsum').classList.toggle('lost', !cashed);
    const net = won - S.bet;
    $('rnet').innerHTML = 'Итог раунда: ' + (net >= 0 ? '+' : '−') + fmt(Math.abs(net)) + '<br>Баланс: ' + fmt(S.balance);
    $('again').disabled = S.balance < S.bet;
    $('again').textContent = S.balance < S.bet ? 'Не хватает' : 'Ещё за ' + fmt(S.bet);
    resEl.classList.remove('hidden');
    $('again').focus();
  }, cashed ? 400 : 1000);
}
$('cash').addEventListener('click', cashOut);
$('play').addEventListener('click', startRound);
$('again').addEventListener('click', startRound);
$('tomenu').addEventListener('click', showMenu);
$('devToggle').addEventListener('click', () => $('dev').classList.toggle('hidden'));
const parseNum = s => Math.floor(+String(s).replace(/[^\d]/g, ''));
function setBalance(v){
  if (window.AG && AG.on) return; // в казино баланс только с сервера
  if (!(v > 0)) return;
  S.balance = Math.min(MAX_BAL, v);
  if (S.bet > S.balance) S.bet = Math.max(MIN_BET, BETS.filter(b => b <= S.balance).pop() || MIN_BET);
  save(); renderMenu();
}
$('balSet').addEventListener('click', () => { setBalance(parseNum($('balInput').value)); $('balInput').value = ''; });
$('balInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('balSet').click(); });
$('betSet').addEventListener('click', () => {
  const v = parseNum($('betInput').value);
  if (v >= MIN_BET && v <= S.balance){ S.bet = v; save(); $('betInput').value = ''; renderMenu(); }
  else { $('betInput').value = ''; $('betInput').placeholder = `от ${MIN_BET} до ${fmt(S.balance)}`; }
});
$('betInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('betSet').click(); });

function showMenu(){ resEl.classList.add('hidden'); hudEl.classList.add('hidden'); menuEl.classList.remove('hidden'); renderMenu(); }
function renderMenu(){
  $('mbal').textContent = fmt(S.balance);
  const bp = $('balPresets'); bp.innerHTML = '';
  BAL_PRESETS.forEach(v => {
    const el = document.createElement('button');
    el.textContent = short(v); el.className = S.balance === v ? 'sel' : '';
    el.onclick = () => setBalance(v);
    bp.appendChild(el);
  });
  const chips = $('chips'); chips.innerHTML = '';
  BETS.forEach(b => {
    const el = document.createElement('button');
    el.className = 'chip' + (b === S.bet ? ' sel' : '');
    el.textContent = short(b);
    el.disabled = b > S.balance;
    el.setAttribute('aria-label', 'Ставка ' + b + ' рублей');
    el.onclick = () => { S.bet = b; save(); renderMenu(); };
    chips.appendChild(el);
  });
  $('betInput').placeholder = BETS.includes(S.bet) ? 'Своя ставка, ★' : 'Своя ставка: ' + fmt(S.bet);
  renderSkins();
  renderLegend();
  $('play').disabled = S.balance < S.bet;
  $('play').textContent = S.balance < S.bet ? 'Не хватает на ставку' : 'Играть за ' + fmt(S.bet);
}
let skinsBuilt = false;
function renderSkins(){
  const box = $('skins');
  if (!skinsBuilt){
    skinsBuilt = true;
    SKINS.forEach(def => {
      const b = document.createElement('button');
      b.className = 'skin'; b.dataset.id = def.id; b.setAttribute('aria-label', 'Скин ' + def.name);
      const c = document.createElement('canvas'); c.width = 160; c.height = 72;
      b.appendChild(c); b.appendChild(document.createTextNode(def.name));
      b.onclick = () => { S.skin = def.id; save(); renderSkins(); };
      box.appendChild(b);
      drawSkinPreview(c, def, 0);
    });
  }
  for (const b of box.children) b.classList.toggle('sel', b.dataset.id === S.skin);
}
function renderLegend(){
  if (!SPR.mine) return;
  const m = S.bet / 100;
  $('legend').innerHTML = COINS.map(t => `<span><img alt="" style="image-rendering:pixelated" src="${COIN_IMG[t.id]}">${fmt(t.v * m)}</span>`).join('') +
    `<span class="bad"><img alt="" src="${SPR.mine.c.toDataURL()}">−${Math.round(BOMB_LOSS * 100)}%</span>` +
    `<span><img alt="" style="image-rendering:pixelated" src="${SHIELD_IMG}">щит ${SHIELD_SEC} с</span>`;
}

/* ================== ОТРИСОВКА ================== */
const cam = { x: 0, y: 0, z: 1 };
let specTarget = null, specTimer = 0;
const inView = (x, y, m, v) => x > v[0] - m && x < v[2] + m && y > v[1] - m && y < v[3] + m;

const HEX_SRC_R = 34 * 2;      // радиус соты в пикселях исходной плитки
const HEX_WORLD_R = 46;        // радиус соты в мире: крупные соты, как в оригинальном slither
function makeHex(){
  // соты slither: «подушечки» с мягким объёмом, тонкие тёмные швы, лёгкое зерно, разные оттенки
  const sz = 34, H = Math.sqrt(3) * sz, W = 3 * sz, res = 2;
  const c = document.createElement('canvas'); c.width = Math.round(W * res * 2); c.height = Math.round(H * res * 2);
  const g = c.getContext('2d'); g.scale(res, res);
  g.fillStyle = '#0b0e13'; g.fillRect(0, 0, W * 2, H * 2);
  const poly = (cx, cy, rr) => { g.beginPath(); for (let i = 0; i < 6; i++){ const a = i * Math.PI / 3; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
  const hex = (cx, cy, key) => {
    const rnd = rng(1000 + key);                 // одинаковый оттенок у копий соты по краям плитки — без швов
    const tone = (rnd() - .5) * 4;
    const gr = g.createRadialGradient(cx - sz * .22, cy - sz * .3, sz * .05, cx, cy, sz);
    gr.addColorStop(0, `hsl(212 16% ${25 + tone}%)`); gr.addColorStop(.5, `hsl(214 18% ${19 + tone * .7}%)`);
    gr.addColorStop(.85, `hsl(216 20% ${14 + tone * .5}%)`); gr.addColorStop(1, `hsl(218 22% ${11}%)`);
    g.fillStyle = gr; poly(cx, cy, sz - 1.3); g.fill();
    g.save(); poly(cx, cy, sz - 1.3); g.clip();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); for (let i = 3; i <= 6; i++){ const a = i * Math.PI / 3; g.lineTo(cx + Math.cos(a) * (sz - 2.4), cy + Math.sin(a) * (sz - 2.4)); } g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.beginPath(); for (let i = 0; i <= 3; i++){ const a = i * Math.PI / 3; g.lineTo(cx + Math.cos(a) * (sz - 2.2), cy + Math.sin(a) * (sz - 2.2)); } g.stroke();
    for (let i = 0; i < 22; i++){ g.fillStyle = rnd() < .5 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.07)'; g.fillRect(cx + (rnd() - .5) * sz * 1.5, cy + (rnd() - .5) * sz * 1.3, 1, 1); }
    g.restore();
  };
  for (let col = -1; col <= 7; col++) for (let row = -1; row <= 4; row++) hex(col * 1.5 * sz, row * H + (col & 1 ? H / 2 : 0), ((col % 4) + 4) % 4 * 2 + (((row % 2) + 2) % 2));
  return c;
}
/* Фон — бесшовный узор с точной (дробной) матрицей: он движется и масштабируется
   ровно вместе с миром, без округлений до пикселя и без перерисовок — поэтому не дёргается. */
let bgPat = null;
function drawBG(shx, shy){
  if (!bgPat) bgPat = ctx.createPattern(hexPat, 'repeat');
  const z = cam.z, s = HEX_WORLD_R / HEX_SRC_R * z * DPR;
  const ox = (VW / 2 - cam.x * z + shx) * DPR, oy = (VH / 2 - cam.y * z + shy) * DPR;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (bgPat.setTransform && typeof DOMMatrix !== 'undefined'){
    bgPat.setTransform(new DOMMatrix([s, 0, 0, s, ox, oy]));
    ctx.fillStyle = bgPat; ctx.fillRect(0, 0, cv.width, cv.height);
  } else {
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.fillStyle = bgPat; ctx.fillRect(-ox / s, -oy / s, cv.width / s, cv.height / s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
function drawMap(v){
  const x0 = v[0] - 10, y0 = v[1] - 10, w = v[2] - v[0] + 20, h = v[3] - v[1] + 20;
  const far = Math.hypot(Math.max(Math.abs(v[0]), Math.abs(v[2])), Math.max(Math.abs(v[1]), Math.abs(v[3])));
  if (far > ARENA - 520){
    const edge = ctx.createRadialGradient(0, 0, ARENA - 500, 0, 0, ARENA);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(150,10,30,.38)');
    ctx.fillStyle = edge; ctx.fillRect(x0, y0, w, h);
    if (far > ARENA){
      ctx.fillStyle = '#12050a';
      ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.arc(0, 0, ARENA, 0, TAU); ctx.fill('evenodd');
    }
    ctx.strokeStyle = 'rgba(255,40,60,.16)'; ctx.lineWidth = 46; ctx.beginPath(); ctx.arc(0, 0, ARENA + 10, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,60,80,.35)'; ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(0, 0, ARENA + 4, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ff3b52'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, ARENA, 0, TAU); ctx.stroke();
  }
}
const visF = [];
const mineFade = f => f.life > 0 && f.life < 1.2 ? f.life / 1.2 : 1;   // мины тают перед исчезновением
function drawFoods(v, time){
  const far = LOW || cam.z < .62;
  visF.length = 0;
  for (let i = 0; i < foods.length; i++){ const f = foods[i]; if (!f.gone && inView(f.x, f.y, 40, v)) visF.push(f); }
  // 1. свечение монет и мин (каждая монета светится своим цветом)
  ctx.globalCompositeOperation = 'lighter';
  for (const f of visF){
    const t = f.t, sc = f.born < 1 ? f.born : 1;
    if (t.bomb){ ctx.globalAlpha = (.45 + .3 * Math.sin(time * 6 + f.ph)) * mineFade(f); drawSpr(SPR.mineG, f.x, f.y, sc * mineFade(f)); }
    else if (t.shield){ const p = .5 + .5 * Math.sin(time * 3 + f.ph); ctx.globalAlpha = .6 + p * .4; drawSpr(SPR.shieldG, f.x, f.y, sc * (1 + p * .3)); }
    else if (t.v > 0){
      const p = .5 + .5 * Math.sin(time * 3 + f.ph);
      ctx.globalAlpha = .55 + p * .45; drawSpr(SPR[f.spr + 'G'], f.x, f.y, sc * (.85 + p * .35));
      // второе, широкое зарево — у всех монет, у дорогих сильнее
      ctx.globalAlpha = (.25 + p * .2) * (t.v >= 20 ? 1.4 : 1); drawSpr(SPR[f.spr + 'G'], f.x, f.y, sc * (1.9 + p * .3));
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // 2. тени монет
  if (!far){
    ctx.globalAlpha = .38;
    for (const f of visF){
      if (!(f.t.v > 0 || f.t.bomb || f.t.shield)) continue;
      const sc = f.born < 1 ? f.born : 1;
      if (f.t.bomb) drawSpr(SPR.shadow, f.x + 3, f.y + 6, 1.7 * sc); else drawSpr(SPR.shadow, f.x + 2, f.y + 6, f.t.r / 10 * .8 * sc);
    }
    ctx.globalAlpha = 1;
  }
  // 3. предметы
  for (const f of visF){
    const t = f.t, sc = f.born < 1 ? f.born : 1;
    if (t.bomb){ drawMine(f, time, sc * mineFade(f)); continue; }
    if (t.shield){ drawSpr(SPR.shield, f.x, f.y - 2 + Math.sin(time * 2.6 + f.ph) * 2, sc); continue; }
    if (t.orb){
      const ox = f.x + Math.sin(time * 1.1 + f.ph) * 2, oy = f.y + Math.cos(time * .9 + f.ph * 1.3) * 2;
      if (far){ drawSpr(SPR[f.spr + 'C'], ox, oy, sc * 1.1); continue; }
      ctx.globalAlpha = .8 + .2 * Math.sin(time * 2 + f.ph); drawSpr(SPR[f.spr], ox, oy, sc * (1 + .1 * Math.sin(time * 2 + f.ph))); ctx.globalAlpha = 1;
      continue;
    }
    if (t === DUST){ drawSpr(SPR.dust, f.x, f.y, sc); continue; }
    const bob = Math.sin(time * 2.6 + f.ph) * 2;
    drawSpr(SPR[f.spr], f.x, f.y - 2 + bob, sc * (1 + .05 * Math.sin(time * 5 + f.ph)));
    const tw = Math.sin(time * 2.2 + f.ph * 3), big = t.v >= 20, thr = big ? .3 : .85;
    if (!far && tw > thr) twinkle(f.x - t.r * .45, f.y - t.r * .6 + bob, (big ? 9 : 6) * (tw - thr) / (1 - thr));
  }
}
function drawMine(f, time, sc){
  const r = f.t.r, ph = (time * .7 + f.ph) % 1;
  ctx.globalAlpha = (1 - ph) * .6 * sc; ctx.strokeStyle = '#ff2e4a'; ctx.lineWidth = 2;   // мягкая волна-предупреждение
  ctx.beginPath(); ctx.arc(f.x, f.y, r * (1.2 + ph * 1.8) * sc, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
  const wob = Math.sin(time * 5 + f.ph) * .05;
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(wob); drawSpr(SPR.mine, 0, 0, sc); ctx.restore();
  // искра на фитиле
  const tx = f.x + (r * .82 * Math.cos(wob) + r * 1.3 * Math.sin(wob)) * sc, ty = f.y + (-r * 1.3 * Math.cos(wob) + r * .82 * Math.sin(wob)) * sc;
  ctx.globalCompositeOperation = 'lighter';
  const fl = .7 + .3 * Math.sin(time * 31 + f.ph * 7);
  ctx.globalAlpha = .9; drawSpr(SPR.sparkG, tx, ty, sc * fl);
  ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(tx, ty, 2.2 * sc * fl, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,90,.9)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++){
    const a = time * 9 + i * 1.7 + f.ph, L = (4 + 5 * hash(i + Math.floor(time * 12) + f.ph)) * sc;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(a) * L, ty + Math.sin(a) * L); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}
function twinkle(x, y, s){
  ctx.fillStyle = 'rgba(255,255,240,.9)';
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * .2, y - s * .2); ctx.lineTo(x + s, y); ctx.lineTo(x + s * .2, y + s * .2);
  ctx.lineTo(x, y + s); ctx.lineTo(x - s * .2, y + s * .2); ctx.lineTo(x - s, y); ctx.lineTo(x - s * .2, y - s * .2); ctx.closePath(); ctx.fill();
}

function drawShieldFx(w, r){
  const h = w.segs[0], t = w.shield, blink = t < 1.5 && Math.sin(gTime * 20) < 0;
  if (blink) return;
  const R0 = r * 2.1 + Math.sin(gTime * 4) * r * .1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .55; drawSpr(SPR.shieldG, h.x, h.y, R0 / 26);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = .9; ctx.strokeStyle = 'rgba(140,220,255,.85)'; ctx.lineWidth = Math.max(1.5, r * .12);
  ctx.beginPath(); ctx.arc(h.x, h.y, R0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, r * .16);       // остаток времени
  ctx.beginPath(); ctx.arc(h.x, h.y, R0, -Math.PI / 2, -Math.PI / 2 + TAU * (t / SHIELD_SEC)); ctx.stroke();
  ctx.globalAlpha = 1;
  drawSpr(SPR.shield, h.x + R0 * .75, h.y - R0 * .75, Math.max(.7, r / 18));
}
function drawWorm(w, v){
  const r = rad(w);
  const m = r * 2.5, view = [v[0] - m, v[1] - m, v[2] + m, v[3] + m];
  drawTube(ctx, w.segs, r, w.skin, gTime, w.travel || 0, w.boost, view, r * cam.z, w.gulps, w.isPlayer);
  const h = w.segs[0];
  if (inView(h.x, h.y, r * 2, v)){ drawEyes(ctx, w, r); if (w.shield > 0) drawShieldFx(w, r); }
}

let gTime = 0;
function render(time){
  gTime = time;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const z = cam.z;
  const shx = shake ? (Math.random() - .5) * shake : 0, shy = shake ? (Math.random() - .5) * shake : 0;
  drawBG(shx, shy);
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (VW / 2 - cam.x * z + shx), DPR * (VH / 2 - cam.y * z + shy));
  const v = [cam.x - VW / 2 / z, cam.y - VH / 2 / z, cam.x + VW / 2 / z, cam.y + VH / 2 / z];
  drawMap(v);
  drawFoods(v, time);
  drawPortal(time);
  for (const s of sucks){
    if (!s.w.alive) continue;
    const h = s.w.segs[0], k = 1 - s.t / .12, sp = SPR[s.spr]; if (!sp) continue;
    drawSpr(sp, s.x + (h.x - s.x) * k, s.y + (h.y - s.y) * k, 1 - k * .8);
  }
  for (const w of worms){
    if (!w.alive || w.isPlayer) continue;
    if (w.maxX < v[0] || w.minX > v[2] || w.maxY < v[1] || w.minY > v[3]) continue;
    drawWorm(w, v);
  }
  if (player && player.alive) drawWorm(player, v);
  for (const p of parts){
    ctx.globalAlpha = clamp(p.life * (p.smoke ? .8 : 2), 0, 1); ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.smoke ? p.s * (1.6 - p.life * .5) : p.s, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = false;
  for (const w of worms){
    if (!w.alive) continue;
    if (w.isPlayer && !S.playing) continue;
    const val = w.isPlayer ? Math.round(S.round) : Math.round(w.mass * 1.08 * (S.playing ? S.mult : S.bet / 100) * w.betK);
    const h = w.segs[0], sx = (h.x - cam.x) * z + VW / 2, sy = (h.y - cam.y) * z + VH / 2 - rad(w) * z - 22;
    if (sx < -80 || sx > VW + 80 || sy < -40 || sy > VH + 40) continue;
    const lab = labelFor(val, w.isPlayer);
    ctx.drawImage(lab.c, Math.round(sx - lab.w / 2), Math.round(sy - lab.h), lab.w, lab.h);
  }
  ctx.imageSmoothingEnabled = true;
  drawPortalArrow(z, time);
  ctx.lineJoin = 'round';
  for (const f of floaters){
    const sx = (f.x - cam.x) * z + VW / 2, sy = (f.y - cam.y) * z + VH / 2 - (1 - f.t) * 34;
    ctx.globalAlpha = Math.min(.6, f.t * 1.2);
    ctx.font = `800 ${Math.round(11 * f.s)}px Unbounded, "Arial Black", sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,8,15,.7)'; ctx.strokeText(f.txt, sx, sy);
    ctx.fillStyle = f.c; ctx.fillText(f.txt, sx, sy);
  }
  ctx.globalAlpha = 1;
}

function drawMini(){
  const W = mini.width, R0 = W / 2 - 8, k = R0 / ARENA;
  mctx.clearRect(0, 0, W, W);
  mctx.fillStyle = 'rgba(22,29,44,.85)'; mctx.beginPath(); mctx.arc(W / 2, W / 2, R0, 0, TAU); mctx.fill();
  mctx.strokeStyle = 'rgba(255,59,82,.8)'; mctx.lineWidth = 5; mctx.stroke();
  mctx.fillStyle = 'rgba(255,70,90,.85)';
  for (const f of foods) if (f.t.bomb && !f.gone) mctx.fillRect(W / 2 + f.x * k - 1.5, W / 2 + f.y * k - 1.5, 3, 3);
  for (const w of worms){
    if (!w.alive) continue;
    const h = w.segs[0];
    mctx.fillStyle = w.isPlayer ? '#f2c14e' : w.mapColor;
    mctx.globalAlpha = w.isPlayer ? 1 : .7;
    mctx.beginPath(); mctx.arc(W / 2 + h.x * k, W / 2 + h.y * k, w.isPlayer ? 8 : 3 + Math.min(6, w.mass / 50), 0, TAU); mctx.fill();
  }
  mctx.globalAlpha = 1;
  if (R.portal && !R.portal.closing){
    mctx.strokeStyle = '#ffd84a'; mctx.lineWidth = 4;
    mctx.beginPath(); mctx.arc(W / 2 + R.portal.x * k, W / 2 + R.portal.y * k, 9 + Math.sin(performance.now() / 150) * 2, 0, TAU); mctx.stroke();
  }
}

/* ================== ПИКСЕЛЬНЫЕ ЦИФРЫ ================== */
const PIX_FONT = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  '.': ['0','0','0','0','0','0','1'],
};
const labelCache = new Map();
const groupDots = v => String(Math.max(0, v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function labelFor(val, mine){
  const text = groupDots(val), key = text + (mine ? '*' : '');
  let L = labelCache.get(key); if (L) return L;
  if (labelCache.size > 400) labelCache.clear();
  const PX = 2, RES = 2, pad = 7, m = 4;
  let cols = 0; for (const ch of text) cols += PIX_FONT[ch][0].length + 1; cols -= 1;
  const w = cols * PX + pad * 2 + m * 2, h = 7 * PX + 10 + m * 2;
  const c = document.createElement('canvas'); c.width = w * RES; c.height = h * RES;
  const g = c.getContext('2d'); g.scale(RES, RES);
  const neon = mine ? '#ffd84a' : '#2bff7a';
  const rr = (x, y, ww, hh, rad) => { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + ww, y, x + ww, y + hh, rad); g.arcTo(x + ww, y + hh, x, y + hh, rad); g.arcTo(x, y + hh, x, y, rad); g.arcTo(x, y, x + ww, y, rad); g.closePath(); };
  g.shadowColor = neon; g.shadowBlur = 5;
  rr(m, m, w - m * 2, h - m * 2, 6); g.fillStyle = 'rgba(2,14,10,.86)'; g.fill();
  g.lineWidth = 2; g.strokeStyle = neon; g.stroke();
  g.shadowBlur = 3; g.fillStyle = mine ? '#ffe680' : '#5dff9b';
  let x = m + pad; const y = m + 5;
  for (const ch of text){
    const rows = PIX_FONT[ch];
    for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < rows[ry].length; rx++) if (rows[ry][rx] === '1') g.fillRect(x + rx * PX, y + ry * PX, PX, PX);
    x += (rows[0].length + 1) * PX;
  }
  L = { c, w, h }; labelCache.set(key, L); return L;
}

/* ================== HUD ================== */
let lbTimer = 0, devTimer = 0, miniTimer = 0;
const hudCache = {};
function setText(id, val){ if (hudCache[id] !== val){ hudCache[id] = val; $(id).textContent = val; } }
function setFlag(id, cls, on){ const k = id + '.' + cls; if (hudCache[k] !== on){ hudCache[k] = on; $(id).classList.toggle(cls, on); } }
function updateHud(dt){
  if (!S.playing) return;
  const m = S.round / S.bet;
  setText('mult', '×' + m.toFixed(2));
  setFlag('mult', 'hot', m >= 1);
  setText('win', fmt(S.round));
  setFlag('win', 'burn', !!(player && player.boost && S.round > 0));
  const open = canCash();
  setFlag('cash', 'hidden', !open);
  if (open){
    setText('cashTxt', 'Забрать ' + fmt(S.round));
    const wd = Math.round(R.window / WINDOW_SEC * 100) + '%';
    if (hudCache.bar !== wd){ hudCache.bar = wd; $('cashBar').style.width = wd; }
  }
  lbTimer -= dt;
  if (lbTimer <= 0){
    lbTimer = .5;
    const top = worms.filter(w => w.alive).sort((a, b) => b.segs.length - a.segs.length).slice(0, 8);
    const html = top.map(w => `<li class="${w.isPlayer ? 'me' : ''}">${w.name} — ${w.segs.length}</li>`).join('');
    if (hudCache.lb !== html){ hudCache.lb = html; $('lb').innerHTML = html; }
  }
  devTimer -= dt;
  if (devTimer <= 0 && !$('dev').classList.contains('hidden')){
    devTimer = .25;
    const st = S.stats, real = st.bet ? (st.paid / st.bet * 100).toFixed(1) + '%' : '—';
    $('dev').textContent =
      `RTP цель      ${(RTP * 100).toFixed(0)}%\nТочка краша   ×${R.M.toFixed(2)}\nЛимит раунда  ${fmt(R.cap)}\n` +
      `Заполнено     ${(R.ratio * 100).toFixed(0)}%\nФаза          ${R.phase}\nПортал        ${R.portal ? (R.portal.closing ? 'закрывается' : R.portal.life.toFixed(1) + ' с') : 'нет (через ' + Math.max(0, R.portalT).toFixed(1) + ' с)'}\n` +
      `────────────────────\nРаундов       ${st.rounds}\nПоставлено    ${fmt(st.bet)}\nВыплачено     ${fmt(st.paid)}\nФакт. RTP     ${real}`;
  }
  miniTimer -= dt;
  if (miniTimer <= 0){ miniTimer = .14; drawMini(); }
}

/* ================== ЦИКЛ ================== */
function spawnPortal(cx, cy, dmin, dmax, life){
  for (let k = 0; k < 30; k++){
    const a = Math.random() * TAU, d = dmin + Math.random() * (dmax - dmin), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (x * x + y * y > (ARENA - 260) ** 2) continue;
    if (!clearOfWorms(x, y, 80)) continue;
    R.portal = { x, y, r: 70, life, maxLife: life, age: 0, k: 1, closing: false }; return true;
  }
  return false;
}
function drawPortal(time){
  const P = R.portal; if (!P) return;
  const k = P.closing ? Math.max(0, P.k) : Math.min(1, P.age * 2.5), rr = P.r * k;
  if (rr <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .75 + .25 * Math.sin(time * 3); drawSpr(SPR.portalG, P.x, P.y, k * (1 + .06 * Math.sin(time * 2)));
  for (let i = 0; i < 5; i++){
    const a0 = time * (1.4 + i * .45) * (i % 2 ? -1 : 1) + i * 1.3;
    ctx.strokeStyle = `rgba(255,${190 + i * 12},${70 + i * 35},${.85 - i * .12})`; ctx.lineWidth = rr * (.11 - i * .014);
    ctx.beginPath(); ctx.arc(P.x, P.y, rr * (.95 - i * .14), a0, a0 + Math.PI * 1.25); ctx.stroke();
    ctx.beginPath(); ctx.arc(P.x, P.y, rr * (.95 - i * .14), a0 + Math.PI, a0 + Math.PI * 1.6); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const core = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr * .5);
  core.addColorStop(0, 'rgba(40,10,0,.85)'); core.addColorStop(1, 'rgba(40,10,0,0)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(P.x, P.y, rr * .5, 0, TAU); ctx.fill();
  drawSpr(SPR.c_money, P.x, P.y + Math.sin(time * 3) * 3, k * 1.5);
  ctx.strokeStyle = 'rgba(255,240,170,.9)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(P.x, P.y, rr * 1.1, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, P.life / P.maxLife)); ctx.stroke();
}
// стрелка к порталу у края экрана
function drawPortalArrow(z, time){
  const P = R.portal; if (!P || P.closing) return;
  const sx = (P.x - cam.x) * z + VW / 2, sy = (P.y - cam.y) * z + VH / 2;
  if (sx > 30 && sx < VW - 30 && sy > 30 && sy < VH - 30) return;
  const a = Math.atan2(sy - VH / 2, sx - VW / 2), m = 46;
  const t = Math.min((VW / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (VH / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
  const x = VW / 2 + Math.cos(a) * t, y = VH / 2 + Math.sin(a) * t, pulse = 1 + .12 * Math.sin(time * 6);
  ctx.save(); ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .8; drawSpr(SPR.portalG, 0, 0, .35 * pulse);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.rotate(a); ctx.fillStyle = '#ffd84a'; ctx.strokeStyle = 'rgba(60,30,0,.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(22 * pulse, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,230,140,.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x - Math.cos(a) * 30, y - Math.sin(a) * 30, 11, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, P.life / P.maxLife)); ctx.stroke();
}
function controller(dt){
  if (!S.playing || !player || !player.alive){ R.phase = '—'; return; }
  R.ratio = R.cap > 0 ? S.round / R.cap : 9;
  R.phase = R.ratio < .6 ? 'спокойно' : R.ratio <= 1 ? 'давление' : 'охота';
  // касса-портал
  const P = R.portal;
  if (P){
    P.age += dt; P.life -= dt;
    if (!P.closing && (S.round > R.cap || P.life <= 0)) P.closing = true;   // лимит пройден или время вышло
    if (P.closing){ P.k -= dt * 2.2; if (P.k <= 0) R.portal = null; }
    else {
      const h = player.segs[0];
      if (Math.hypot(h.x - P.x, h.y - P.y) < P.r * .7 && S.round > 0 && S.round <= R.cap) cashOut();
    }
  } else if (S.round > 0 && S.round <= R.cap){
    R.portalT -= dt;
    if (R.portalT <= 0){ const h = player.segs[0]; spawnPortal(h.x, h.y, 700, 1300, 14); R.portalT = 9 + Math.random() * 9; }
  }
  const rate = R.ratio < .6 ? .04 : R.ratio <= 1 ? (R.ratio - .6) * 2.4 : 1.8;
  R.bombAcc += rate * dt;
  while (R.bombAcc >= 1){
    R.bombAcc -= 1;
    const h = player.segs[0];
    spawnMineNear(h.x, h.y, player.ang, 3.2, 300, 750);   // вокруг игрока, не только прямо перед ним
  }
}

genMap();
hexPat = makeHex();
buildSprites();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildSprites);
for (let i = 0; i < ORB_N; i++){ const p = randPoint(30); addFood(p.x, p.y, ORB); }
for (let i = 0; i < COIN_FIELD_N; i++){ const p = randPoint(60); addFood(p.x, p.y, pickCoin(false)); }
for (let i = 0; i < SHIELD_FIELD_N; i++){ const p = randPoint(100); addFood(p.x, p.y, SHIELD); }
for (let i = 0; i < BOMB_BASE; i++){ const p = randPoint(60); addFood(p.x, p.y, BOMB, 10 + Math.random() * 30); }
for (const f of foods) f.born = 1;
for (let i = 0; i < BOT_N; i++) spawnBot();

let prevTick = 0;
let last = performance.now(), time = 0, ftAvg = 16, perfT = 0;
function frame(t){
  const raw = t - last;
  const dt = Math.min(.033, Math.max(0, raw / 1000)); last = t; time += dt;
  // авто-качество: если кадры стабильно тяжёлые — снижаем плотность пикселей
  ftAvg = ftAvg * .95 + Math.min(100, raw) * .05; perfT += dt;
  if (perfT > 1.2){ perfT = 0; if (ftAvg > 19){ if (MAXDPR > 1){ MAXDPR = Math.max(1, MAXDPR - .25); resize(); } else if (LOW && MAXDPR > .75){ MAXDPR = .75; resize(); } else if (!LOW) LOW = true; else ORB_CUR = Math.max(1200, ORB_CUR - 300); ftAvg = 16; } }
  if (player && player.alive){
    const dx = ((keys.ArrowRight || keys.KeyD) ? 1 : 0) - ((keys.ArrowLeft || keys.KeyA) ? 1 : 0);
    const dy = ((keys.ArrowDown || keys.KeyS) ? 1 : 0) - ((keys.ArrowUp || keys.KeyW) ? 1 : 0);
    if (dx || dy) player.target = Math.atan2(dy, dx);
    else if (pointer.active){
      const h = player.segs[0];
      player.target = Math.atan2(pointer.y - ((h.y - cam.y) * cam.z + VH / 2), pointer.x - ((h.x - cam.x) * cam.z + VW / 2));
    }
    player.boost = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touchBoost);
  }
  controller(dt);
  for (const w of worms) if (w.alive) updateWorm(w, dt);
  buildGrids();
  for (const w of worms) if (w.alive && !w.isPlayer) botThink(w, dt);
  for (const w of worms) if (w.alive) eat(w);
  collide();
  for (const w of worms) if (w.alive && w.dead) kill(w);
  worms = worms.filter(w => w.alive);
  if (player && !player.alive) player = null;

  let bots = 0; for (const w of worms) if (!w.isPlayer) bots++;
  if (bots < BOT_N && Math.random() < .04) spawnBot();
  let coins = 0, orbs = 0, bombs = 0, shields = 0, keep = 0;
  for (let i = 0; i < foods.length; i++){
    const f = foods[i];
    if (f.gone) continue;
    if (f.born < 1) f.born = Math.min(1, f.born + dt * 4);
    if (f.life > 0){ f.life -= dt; if (f.life <= 0) continue; }
    if (f.t.bomb) bombs++; else if (f.t.shield) shields++; else if (f.t.v > 0) coins++; else orbs++;
    foods[keep++] = f;
  }
  foods.length = keep;
  for (let i = 0; i < 10 && orbs < ORB_CUR; i++, orbs++){ const p = randPoint(30); addFood(p.x, p.y, ORB); }
  if (coins < COIN_FIELD_N && Math.random() < .03){ const p = randPoint(60); addFood(p.x, p.y, pickCoin(false)); }  // монеты на карте — редко
  // фоновые мины: появляются возле случайных червей, живут 18–34 с и тают
  if (bombs < BOMB_BASE && Math.random() < .25 && worms.length){
    const o = worms[(Math.random() * worms.length) | 0];
    if (o.alive && !o.isPlayer) spawnMineNear(o.segs[0].x, o.segs[0].y, o.ang, 4, 250, 700);
  }
  if (shields < SHIELD_FIELD_N && Math.random() < .01){ const p = randPoint(100); if (clearOfWorms(p.x, p.y, 40)) addFood(p.x, p.y, SHIELD); }
  let pk = 0;
  for (let i = 0; i < parts.length; i++){
    const p = parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .93; p.vy *= .93; p.life -= dt;
    if (p.life > 0) parts[pk++] = p;
  }
  parts.length = pk;
  for (let i = sucks.length - 1; i >= 0; i--){ sucks[i].t -= dt; if (sucks[i].t <= 0) sucks.splice(i, 1); }
  for (let i = floaters.length - 1; i >= 0; i--){ floaters[i].t -= dt * 1.1; if (floaters[i].t <= 0) floaters.splice(i, 1); }
  combo.t -= dt; combo.pop = Math.max(0, combo.pop - dt * 5);
  shake = Math.max(0, shake - dt * 40);

  const viewScale = clamp(Math.min(VW, VH) / 820, .55, 1.15);
  let tx = cam.x, ty = cam.y, tz = .8 * viewScale;
  if (player){
    tx = player.segs[0].x + Math.cos(player.ang) * 60; ty = player.segs[0].y + Math.sin(player.ang) * 60;
    tz = Math.max(.6, 1 - (player.segs.length - INIT_LEN) * .001) * viewScale;
  } else if (!menuEl.classList.contains('hidden')){
    specTimer -= dt;
    if (!specTarget || !specTarget.alive || specTimer <= 0){
      specTimer = 6;
      specTarget = worms.slice().sort((a, b) => b.mass - a.mass)[(Math.random() * 3) | 0] || null;
    }
    if (specTarget){ tx = specTarget.segs[0].x; ty = specTarget.segs[0].y; }
    tz = .75 * viewScale;
  }
  const k = Math.min(1, dt * 7);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * Math.min(1, dt * 2);

  render(time);
  updateHud(dt);
  if (!menuEl.classList.contains('hidden') && (prevTick = (prevTick + 1) % 2) === 0){
    const box = $('skins'); for (const b of box.children){ const def = SKINS.find(k => k.id === b.dataset.id); if (def) drawSkinPreview(b.firstChild, def, time); }
  }
  requestAnimationFrame(frame);
}
// ANGOCK: внутри казино — реальный баланс в звёздах, ставки поменьше, без демо-баланса
if (window.AG && AG.on){
  document.documentElement.classList.add('casino');
  BETS.splice(0, BETS.length, 10, 25, 50, 100, 250, 500, 1000);
  if (!BETS.includes(S.bet)) S.bet = 10;
  AG.balance().then(b => { S.balance = b; save(); renderMenu(); }).catch(e => AG.err(e));
}
if (location.hash === '#selftest') window.__t = { S, R, cashOut };
renderMenu();
requestAnimationFrame(frame);
})();

