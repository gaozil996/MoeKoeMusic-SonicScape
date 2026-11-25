/*
 * 声境音效 SonicScape —— 模块化音效引擎（world:MAIN）
 * 全部逻辑在一个 IIFE 内，重复注入直接 return，不会二次包装 play/Audio。
 */
(function () {
'use strict';
if (window.__ss_installed) return;
window.__ss_installed = true;

var STORE_KEY = 'sonicscape_state_v1';
var STORE_PRESETS = 'sonicscape_user_presets_v1';
var LOG = '[声境]';

// 10 段参数 EQ 标准倍频程中心频率
var EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function defaultBands() {
  return EQ_FREQS.map(function (f, i) {
    return { type: i < 2 ? 'lowshelf' : (i > 7 ? 'highshelf' : 'peaking'), freq: f, gain: 0, q: 1.0 };
  });
}
// 语义化 EQ 构造：g 是 10 段增益(按 EQ_FREQS 顺序)，opt 可改 type/freq/q。
// 这样「超重低音」就真的是抬 31/62Hz，「电话」就真的是两端带通，名字和效果对得上。
function EQ(g, opt) {
  opt = opt || {};
  var bands = defaultBands();
  for (var i = 0; i < 10 && i < g.length; i++) bands[i].gain = g[i] || 0;
  if (opt.types) for (var a in opt.types) if (bands[a]) bands[a].type = opt.types[a];
  if (opt.freqs) for (var b in opt.freqs) if (bands[b]) bands[b].freq = opt.freqs[b];
  if (opt.q) for (var c in opt.q) if (bands[c]) bands[c].q = opt.q[c];
  return { bands: bands };
}

function defaultState() {
  return {
    enabled: true,          // 总开关（快捷开关控制）
    preset: 'off',
    intensity: 100,
    open: false,
    view: 'simple',      // simple=四个旋钮；advanced=全部参数
    tab: 'presets',
    ab: null,
    knobs: { bass: 0, air: 0 },   // 顶部旋钮：干净低架/高架提升，不做失真
    modules: {
      input:  { autoLoud: false, gain: 0 },
      bass:   { on: false, freq: 90, amount: 0.6 },
      eq:     { bands: defaultBands() },
      excite: { type: 'off', drive: 0.4, air: 0 },
      comp:   { th: -28, knee: 3, ratio: 6, at: 0.003, rel: 0.15, makeup: 4, limiter: true, ceiling: -1 },
      reverb: { ir: 'room', wet: 0.3, predelay: 18, size: 2.0 },
      stereo: { width: 0.25, mid: 0, side: 0, sideLowcut: 0 },
      crossfeed: { on: false, preset: 'mid', level: 0.35 },
      output: { gain: 0 }
    },
    smart: false
  };
}

var state = defaultState();
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function loadState() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    var o = JSON.parse(raw);
    if (!o || !o.modules) return;
    state.enabled = (typeof o.enabled === 'boolean') ? o.enabled : true;
    state.preset = (typeof o.preset === 'string') ? o.preset : 'off';
    state.intensity = (typeof o.intensity === 'number') ? o.intensity : 100;
    state.open = !!o.open;
    state.view = (o.view === 'advanced') ? 'advanced' : 'simple';
    state.tab = (typeof o.tab === 'string') ? o.tab : 'presets';
    state.smart = !!o.smart;
    if (!state.knobs) state.knobs = { bass: 0, air: 0 };
    if (o.knobs) {
      state.knobs.bass = clamp(+(o.knobs.bass || 0), 0, 100);
      state.knobs.air = clamp(+(o.knobs.air || 0), 0, 100);
    }
    var base = defaultState();
    for (var k in base.modules) {
      if (state.modules[k] && o.modules[k]) {
        for (var j in base.modules[k]) {
          if (o.modules[k][j] !== undefined) state.modules[k][j] = deepClone(o.modules[k][j]);
        }
      }
    }
    if (o.modules.eq && Array.isArray(o.modules.eq.bands) && o.modules.eq.bands.length === 10) {
      state.modules.eq.bands = o.modules.eq.bands;
    }
  } catch (e) {}
}
var _saveT = null;
function saveState() {
  if (_saveT) clearTimeout(_saveT);
  _saveT = setTimeout(function () { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }, 300);
}
function saveStateNow() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
window.addEventListener('beforeunload', saveStateNow);
function loadUserPresets() { try { var r = localStorage.getItem(STORE_PRESETS); if (r) return JSON.parse(r); } catch (e) {} return {}; }
function saveUserPresets(o) { try { localStorage.setItem(STORE_PRESETS, JSON.stringify(o)); } catch (e) {} }

var IR_DEFS = {
  none:   { label: '关闭', decay: 0, pre: 0, len: 0.05 },
  room:   { label: '小房间', decay: 1.8, pre: 0.006, len: 0.35 },
  hall:   { label: '音乐厅', decay: 2.6, pre: 0.012, len: 0.8 },
  stage:  { label: '舞台', decay: 2.4, pre: 0.010, len: 0.7 },
  plate:  { label: '钢板', decay: 3.0, pre: 0.004, len: 0.5 },
  church: { label: '教堂', decay: 3.2, pre: 0.020, len: 0.9 },
  spring: { label: '弹簧', decay: 2.0, pre: 0.003, len: 0.3 }
};

// ---------------- 预设库（10 段语义化，名字与效果一致） ----------------
function P(o) { return o; }
var PRESETS = [
  // 经典音效
  P({ id: 'c_3d', name: '3D丽音', group: '经典音效', modules: {
    eq: EQ([2, 2, 1, 0, -1, 0, 1, 2, 3, 2]), stereo: { width: 0.35 }, reverb: { ir: 'stage', wet: 0.28 } } }),
  P({ id: 'c_bass', name: '超重低音', group: '经典音效', modules: {
    eq: EQ([9, 8, 5, 1, -2, -2, -1, 0, 1, 1]), knobs: { bass: 50 }, comp: { th: -20, ratio: 4, makeup: 1 } } }),
  P({ id: 'c_vocal', name: '纯净人声', group: '经典音效', modules: {
    eq: EQ([-5, -4, -2, 0, 1, 3, 5, 4, 2, 0]), excite: { type: 'tube', drive: 0.25, air: 3 }, stereo: { mid: 2 }, reverb: { ir: 'room', wet: 0.06 } } }),
  P({ id: 'c_hifi', name: 'HiFi现场', group: '经典音效', modules: {
    eq: EQ([3, 2, 1, 0, 0, 1, 2, 2, 2, 1]), reverb: { ir: 'hall', wet: 0.32 }, stereo: { width: 0.25 } } }),

  // 流派
  P({ id: 'g_pop', name: '流行', group: '流派', modules: { eq: EQ([4, 3, 1, 0, 0, 1, 2, 2, 2, 1]), comp: { th: -22, ratio: 3, makeup: 1 } } }),
  P({ id: 'g_rock', name: '摇滚', group: '流派', modules: { eq: EQ([6, 4, 1, -1, 0, 1, 3, 3, 2, 1]), knobs: { bass: 30 }, comp: { th: -18, ratio: 4, makeup: 1 } } }),
  P({ id: 'g_elec', name: '电子', group: '流派', modules: { eq: EQ([8, 6, 2, -2, -3, -1, 1, 3, 4, 3]), knobs: { bass: 25 }, reverb: { ir: 'plate', wet: 0.1 } } }),
  P({ id: 'g_jazz', name: '爵士', group: '流派', modules: { eq: EQ([2, 1, 0, 0, 1, 1, 1, 1, 1, 0]), excite: { type: 'tape', drive: 0.25 } } }),
  P({ id: 'g_class', name: '古典', group: '流派', modules: { eq: EQ([-2, -1, 0, 0, 0, 0, 1, 1, 2, 2]), comp: { th: -28, ratio: 2, makeup: 0 }, reverb: { ir: 'hall', wet: 0.2 } } }),
  P({ id: 'g_hiphop', name: '嘻哈', group: '流派', modules: { eq: EQ([9, 7, 3, 0, -1, -1, 0, 1, 2, 1]), knobs: { bass: 45 }, comp: { th: -16, ratio: 5, makeup: 1 } } }),
  P({ id: 'g_metal', name: '金属', group: '流派', modules: { eq: EQ([6, 3, -1, 1, 3, 0, -2, 3, 4, 2]), comp: { th: -16, ratio: 4, makeup: 1 }, excite: { type: 'tube', drive: 0.3 } } }),
  P({ id: 'g_vocal', name: '清唱人声', group: '流派', modules: { eq: EQ([-3, -2, -1, 0, 2, 3, 4, 3, 1, 0]), stereo: { mid: 3 }, reverb: { ir: 'plate', wet: 0.12 } } }),
  P({ id: 'g_lofi', name: 'Lo-Fi', group: '流派', modules: { eq: EQ([3, 2, 1, 1, 0, -1, -2, -4, -6, -8]), excite: { type: 'tape', drive: 0.4 }, reverb: { ir: 'room', wet: 0.1 } } }),
  P({ id: 'g_anime', name: '二次元', group: '流派', modules: { eq: EQ([2, 1, 0, 0, 1, 2, 3, 3, 4, 4]), excite: { type: 'soft', drive: 0.3, air: 4 }, reverb: { ir: 'hall', wet: 0.22 } } }),

  // 设备
  P({ id: 'h_earbud', name: '半入耳耳机', group: '设备', modules: { eq: EQ([6, 4, 2, 1, 0, 0, 1, 2, 3, 4]), knobs: { bass: 28 }, excite: { type: 'soft', drive: 0.2, air: 5 } } }),
  P({ id: 'h_over', name: '头戴开放式', group: '设备', modules: { eq: EQ([1, 1, 0, 0, 0, 0, 0, 1, 1, 1]), stereo: { width: 0.15 } } }),
  P({ id: 'h_inear', name: '入耳监听', group: '设备', modules: { eq: EQ([-1, -1, 0, 0, 0, 0, 0, -1, -1, -2]), comp: { th: -20, ratio: 2.5, makeup: 0 } } }),
  P({ id: 'h_speaker', name: '小音箱外放', group: '设备', modules: { eq: EQ([6, 5, 3, 1, 0, 0, 1, 2, 3, 3]), knobs: { bass: 30 }, stereo: { sideLowcut: 150 } } }),
  P({ id: 'h_car', name: '车载', group: '设备', modules: { eq: EQ([6, 4, 2, 0, 0, 1, 1, 2, 2, 1]), knobs: { bass: 40 }, reverb: { ir: 'stage', wet: 0.3 }, stereo: { width: 0.4 } } }),

  // 场景（带通/低通用 type 覆盖，效果名副其实）
  P({ id: 's_live', name: '现场演唱会', group: '场景', modules: { eq: EQ([3, 2, 1, 0, 0, 1, 2, 2, 2, 2]), reverb: { ir: 'stage', wet: 0.36 }, stereo: { width: 0.3 } } }),
  P({ id: 's_under', name: '水下', group: '场景', modules: { eq: EQ([2, 3, 1, 0, 0, 0, 0, 0, 0, 0], { types: { 7: 'lowpass' }, freqs: { 7: 700 } }), reverb: { ir: 'hall', wet: 0.4 } } }),
  P({ id: 's_concert', name: '演唱会·人声', group: '场景', modules: { eq: EQ([2, 1, 0, 0, 1, 2, 3, 3, 2, 1]), stereo: { mid: 2, width: 0.2 }, reverb: { ir: 'hall', wet: 0.3 } } }),
  P({ id: 's_immersive', name: '沉浸环绕', group: '场景', modules: { eq: EQ([2, 1, 0, 0, 0, 1, 1, 2, 3, 2]), stereo: { width: 0.45 }, reverb: { ir: 'church', wet: 0.3 } } }),
  P({ id: 's_phone', name: '电话', group: '场景', modules: { eq: EQ([0, 0, -2, 2, 4, 5, 3, 0, 0, 0], { types: { 1: 'highpass', 7: 'lowpass' }, freqs: { 1: 300, 7: 3400 } }), comp: { th: -18, ratio: 8, makeup: 2 } } }),
  P({ id: 's_radio', name: '电台', group: '场景', modules: { eq: EQ([0, 0, -2, 1, 3, 5, 4, 1, -6, -12]), comp: { th: -16, ratio: 8, makeup: 2 } } }),
  P({ id: 's_vinyl', name: '黑胶唱片', group: '场景', modules: { eq: EQ([1, 1, 0, 0, 0, -1, -2, -3, -6, -10]), excite: { type: 'tape', drive: 0.45 }, reverb: { ir: 'room', wet: 0.12 } } }),

  // 监听/母带
  P({ id: 'm_studio', name: '录音棚', group: '监听', modules: { eq: EQ([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), comp: { th: -20, ratio: 4, makeup: 2 } } }),
  P({ id: 'm_hires', name: 'Hi-Res监听', group: '监听', modules: { eq: EQ([0, 0, 0, 0, 0, 0, 0, 0, 1, 2]), comp: { th: -30, ratio: 2, makeup: 0 } } }),
  P({ id: 'm_master', name: '母带微光', group: '监听', modules: { eq: EQ([1, 0, 0, 0, 0, 0, 0, 1, 1, 2]), excite: { type: 'soft', drive: 0.2, air: 3 }, comp: { th: -18, ratio: 2.5, makeup: 2 } } }),
  P({ id: 'm_trans', name: '通透清晰度', group: '监听', modules: { eq: EQ([-1, -1, 0, 0, 0, 1, 2, 3, 4, 5]), excite: { type: 'soft', drive: 0.25, air: 6 } } }),

  P({ id: 'off', name: '关闭(原音)', group: '基础', modules: {
    eq: EQ([0,0,0,0,0,0,0,0,0,0]), comp: { th: 0, knee: 0, ratio: 1, at: 0.01, rel: 0.25, makeup: 0, limiter: false, ceiling: 0 },
    reverb: { ir: 'none', wet: 0 }, stereo: { width: 0, mid: 0, side: 0, sideLowcut: 0 },
    knobs: { bass: 0, air: 0 }, bass: { on: false }, excite: { type: 'off', drive: 0, air: 0 }, input: { autoLoud: false, gain: 0 }, output: { gain: 0 } } })
];
var GROUPS = ['基础', '经典音效', '流派', '设备', '场景', '监听'];
function findPreset(id) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
  return PRESETS[PRESETS.length - 1];
}
loadState();
var USER_PRESETS = loadUserPresets();
var CUSTOM_IR = null, CUSTOM_IR_NAME = '';

﻿
// ---------------- 运行时 ----------------
var ctx = null, nodes = null, claimed = null, srcNode = null;
var rms = 0, peak = 0, rmsBuf = null, freqBuf = null;
var irCache = {};
var claimedPlayed = false;
var diag = { chain: '-', src: '-', err: '-' };
var smartAccum = null, smartFrames = 0, smartTimer = null;

function dbToGain(db) { return Math.pow(10, db / 20); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mono(n) { try { n.channelCount = 1; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers'; } catch (e) {} return n; }

// 饱和曲线：输入先经前置增益推进弯曲区，曲线用固定强整形，谐波真实可闻
function makeCurve(kind, drive) {
  var n = 2048, c = new Float32Array(n), k = clamp(drive, 0, 1) * 3 + 0.2;
  for (var i = 0; i < n; i++) {
    var x = (i / (n - 1)) * 2 - 1, y;
    if (kind === 'tube') y = Math.tanh(x * (2 + k * 3)) / Math.tanh(2 + k * 3) * (1 - 0.18 * x * x);
    else if (kind === 'tape') y = Math.tanh(x * (2 + k * 2)) / Math.tanh(2 + k * 2) * (1 - 0.08 * x * x);
    else if (kind === 'soft') y = Math.tanh(x * (1 + k)) / Math.tanh(1 + k);
    else y = x;
    c[i] = y;
  }
  return c;
}
// 低音谐波生成曲线：强非线性，专门把低音推出 2/3 次谐波
function bassCurve(amount) {
  var n = 2048, c = new Float32Array(n), k = 2 + clamp(amount, 0, 1) * 10;
  for (var i = 0; i < n; i++) {
    var x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}
// 低音谐波生成曲线：负半波压得比正半波重，产生奇偶混合谐波（全波积分器的近似）
function harmCurve(amount) {
  var n = 2048, c = new Float32Array(n), k = 0.35 + clamp(amount, 0, 1) * 0.65;
  for (var i = 0; i < n; i++) {
    var x = (i / (n - 1)) * 2 - 1;
    var y = Math.tanh(x * 2.2);
    if (x < 0) y *= k;
    c[i] = y;
  }
  return c;
}
// 生成卷积 IR：双声道去相关噪声 + 指数衰减。normalize=false 时手动归一化，
// 保证湿声有明确能量（旧版 normalize=true + 短 IR 导致混响几乎听不见）。
function makeIR(def, size) {
  var rate = ctx.sampleRate;
  var len = Math.max(1, Math.floor(rate * Math.min(6.0, def.len * (size / 2.0))));
  var buf = ctx.createBuffer(2, len, rate);
  var pre = Math.floor(rate * def.pre);
  var energy = 0;
  for (var ch = 0; ch < 2; ch++) {
    var d = buf.getChannelData(ch);
    for (var i = 0; i < len; i++) {
      if (i < pre) { d[i] = 0; continue; }
      var t = (i - pre) / (len - pre);
      // 前段更密（早期反射），后段衰减；加一点点前置脉冲让尾音更实
      var decay = Math.pow(1 - t, def.decay);
      var v = (Math.random() * 2 - 1) * decay;
      d[i] = v;
      energy += v * v;
    }
  }
  // 归一化到总能量 1，卷积后湿声电平可控
  var scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1;
  for (var c2 = 0; c2 < 2; c2++) {
    var dd = buf.getChannelData(c2);
    for (var k = 0; k < len; k++) dd[k] *= scale;
  }
  return buf;
}
function propDesc(proto, name) {
  while (proto) { var d = Object.getOwnPropertyDescriptor(proto, name); if (d) return d; proto = Object.getPrototypeOf(proto); }
  return null;
}
function hookProp(el, name, onChange) {
  var d = propDesc(Object.getPrototypeOf(el), name);
  if (!d || !d.get || !d.set) return false;
  try {
    Object.defineProperty(el, name, { configurable: true, enumerable: d.enumerable,
      get: function () { return d.get.call(this); }, set: function (v) { d.set.call(this, v); onChange(v, this); } });
  } catch (e) { return false; }
  return true;
}

// ---------------- 节点图 ----------------
function buildChain() {
  var N = {}, i;
  N.input = ctx.createGain();                     // 自动响度/输入增益
  // 低音谐波补充（missing fundamental）：低通取超低频 -> 非对称整形 -> 带通留 100-260Hz 谐波 -> 混入
  N.bassSum = ctx.createGain();
  N.bassLP = ctx.createBiquadFilter(); N.bassLP.type = 'lowpass'; N.bassLP.frequency.value = 90; N.bassLP.Q.value = 0.7;
  N.bassDrive = ctx.createGain(); N.bassDrive.gain.value = 2;
  N.bassWS = ctx.createWaveShaper(); N.bassWS.curve = harmCurve(0.5); N.bassWS.oversample = '4x';
  N.bassBP = ctx.createBiquadFilter(); N.bassBP.type = 'bandpass'; N.bassBP.frequency.value = 150; N.bassBP.Q.value = 0.8;
  N.bassGain = ctx.createGain(); N.bassGain.gain.value = 0;
  // 低频能量检测，给动态低音用
  N.dynAn = ctx.createAnalyser(); N.dynAn.fftSize = 1024; N.dynAn.smoothingTimeConstant = 0.5;
  N.dynBuf = new Float32Array(N.dynAn.frequencyBinCount);
  // 10 段参数 EQ
  N.eq = EQ_FREQS.map(function (f, idx) {
    var b = ctx.createBiquadFilter();
    b.type = idx < 2 ? 'lowshelf' : (idx > 7 ? 'highshelf' : 'peaking');
    b.frequency.value = f; b.Q.value = 1.0; b.gain.value = 0;
    return b;
  });
  // 激励/饱和：干湿互补 crossfade，前置增益推进曲线
  N.exciteSum = ctx.createGain();
  N.exciteDrive = ctx.createGain(); N.exciteDrive.gain.value = 3;
  N.exciteWS = ctx.createWaveShaper(); N.exciteWS.curve = makeCurve('off', 0); N.exciteWS.oversample = '4x';
  N.exciteDry = ctx.createGain(); N.exciteDry.gain.value = 1;
  N.exciteWet = ctx.createGain(); N.exciteWet.gain.value = 0;
  N.air = ctx.createBiquadFilter(); N.air.type = 'highshelf'; N.air.frequency.value = 8500; N.air.gain.value = 0;
  // 音色层：24Hz 清理 -> 静态低架 -> 动态低架 -> 高架 -> 中高轮廓 -> 齿音保护 -> 等响补偿
  N.knobHP = ctx.createBiquadFilter(); N.knobHP.type = 'highpass'; N.knobHP.frequency.value = 24; N.knobHP.Q.value = 0;
  N.knobBass = ctx.createBiquadFilter(); N.knobBass.type = 'lowshelf'; N.knobBass.frequency.value = 88; N.knobBass.gain.value = 0;
  N.dynBass = ctx.createBiquadFilter(); N.dynBass.type = 'lowshelf'; N.dynBass.frequency.value = 88; N.dynBass.gain.value = 0;
  N.knobAir = ctx.createBiquadFilter(); N.knobAir.type = 'highshelf'; N.knobAir.frequency.value = 8500; N.knobAir.gain.value = 0;
  N.contour = ctx.createBiquadFilter(); N.contour.type = 'peaking'; N.contour.frequency.value = 2800; N.contour.Q.value = 1.2; N.contour.gain.value = 0;
  N.deess = ctx.createBiquadFilter(); N.deess.type = 'peaking'; N.deess.frequency.value = 6500; N.deess.Q.value = 1.4; N.deess.gain.value = 0;
  N.deessAn = ctx.createAnalyser(); N.deessAn.fftSize = 1024; N.deessAn.smoothingTimeConstant = 0.6;
  N.deessBuf = new Float32Array(N.deessAn.frequencyBinCount);
  N.knobTrim = ctx.createGain(); N.knobTrim.gain.value = 1;
  // 动态：compPre 把信号顶进压缩阈值，comp 后 makeup 补偿（不再是抬峰值）
  N.compPre = ctx.createGain(); N.compPre.gain.value = 1;
  N.comp = ctx.createDynamicsCompressor();
  N.comp.knee.value = 4; N.comp.attack.value = 0.003; N.comp.release.value = 0.18;
  N.makeup = ctx.createGain();
  N.limiter = ctx.createDynamicsCompressor();
  N.limiter.threshold.value = -1; N.limiter.knee.value = 0; N.limiter.ratio.value = 20;
  N.limiter.attack.value = 0.003; N.limiter.release.value = 0.25;
  // 左右声道独立监测，用来验证 crossfeed 和 M/S 真的在动
  N.lrSplit = ctx.createChannelSplitter(2);
  N.lrAnL = ctx.createAnalyser(); N.lrAnL.fftSize = 2048; N.lrAnL.smoothingTimeConstant = 0.5;
  N.lrAnR = ctx.createAnalyser(); N.lrAnR.fftSize = 2048; N.lrAnR.smoothingTimeConstant = 0.5;
  N.lrBufL = new Float32Array(N.lrAnL.frequencyBinCount);
  N.lrBufR = new Float32Array(N.lrAnR.frequencyBinCount);
  // 混响
  N.revSend = ctx.createGain(); N.revSend.gain.value = 0;
  N.predelay = ctx.createDelay(1.0); N.predelay.delayTime.value = 0.02;
  N.conv = ctx.createConvolver(); N.conv.normalize = false;   // IR 已手动归一化
  N.revReturn = ctx.createGain(); N.revReturn.gain.value = 1;
  N.master = ctx.createGain(); N.master.channelCount = 2; N.master.channelCountMode = 'explicit'; N.master.channelInterpretation = 'speakers';
  // M/S 矩阵
  N.msSplit = ctx.createChannelSplitter(2);
  N.l2m = mono(ctx.createGain()); N.l2m.gain.value = 0.7071;
  N.r2m = mono(ctx.createGain()); N.r2m.gain.value = 0.7071;
  N.l2s = mono(ctx.createGain()); N.l2s.gain.value = 0.7071;
  N.r2s = mono(ctx.createGain()); N.r2s.gain.value = -0.7071;
  N.mid = mono(ctx.createGain()); N.mid.gain.value = 1;
  N.side = mono(ctx.createGain()); N.side.gain.value = 1;
  N.sideHP = mono(ctx.createBiquadFilter()); N.sideHP.type = 'highpass'; N.sideHP.frequency.value = 20;
  N.m2l = mono(ctx.createGain()); N.m2l.gain.value = 0.7071;
  N.m2r = mono(ctx.createGain()); N.m2r.gain.value = 0.7071;
  N.s2l = mono(ctx.createGain()); N.s2l.gain.value = 0.7071;
  N.s2r = mono(ctx.createGain()); N.s2r.gain.value = -0.7071;
  N.outMerge = ctx.createChannelMerger(2);
  // Crossfeed（bs2b / Bauer 近似）：对侧信号 700Hz 低通后串入，耳机久听不累
  N.xfSplit = ctx.createChannelSplitter(2);
  N.xfMerge = ctx.createChannelMerger(2);
  N.xfLPr = mono(ctx.createBiquadFilter()); N.xfLPr.type = 'lowpass'; N.xfLPr.frequency.value = 700; N.xfLPr.Q.value = 0;
  N.xfLPl = mono(ctx.createBiquadFilter()); N.xfLPl.type = 'lowpass'; N.xfLPl.frequency.value = 700; N.xfLPl.Q.value = 0;
  N.xfGl = ctx.createGain(); N.xfGl.gain.value = 0;     // R -> L
  N.xfGr = ctx.createGain(); N.xfGr.gain.value = 0;     // L -> R
  N.xfDryL = ctx.createGain(); N.xfDryL.gain.value = 1;
  N.xfDryR = ctx.createGain(); N.xfDryR.gain.value = 1;
  // 输出：output=手动增益, vol=系统音量, enabled=总开关旁路
  N.output = ctx.createGain();
  N.vol = ctx.createGain();
  N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 2048; N.analyser.smoothingTimeConstant = 0.8;
  // K 加权支路（ITU-R BS.1770），只做分析不改声音，用来算 LUFS
  N.kwShelf = ctx.createBiquadFilter(); N.kwShelf.type = 'highshelf'; N.kwShelf.frequency.value = 1682; N.kwShelf.gain.value = 3.9998;
  N.kwHP = ctx.createBiquadFilter(); N.kwHP.type = 'highpass'; N.kwHP.frequency.value = 38.135; N.kwHP.Q.value = -6.02;
  N.kwAn = ctx.createAnalyser(); N.kwAn.fftSize = 2048; N.kwAn.smoothingTimeConstant = 0;
  N.kwBuf = new Float32Array(N.kwAn.fftSize);

  // ---- 连线 ----
  N.input.connect(N.bassSum);
  N.input.connect(N.kwShelf); N.kwShelf.connect(N.kwHP); N.kwHP.connect(N.kwAn);
  N.input.connect(N.bassLP); N.bassLP.connect(N.bassDrive); N.bassDrive.connect(N.bassWS);
  N.bassWS.connect(N.bassBP); N.bassBP.connect(N.bassGain); N.bassGain.connect(N.bassSum);
  N.bassSum.connect(N.dynAn);
  N.bassSum.connect(N.eq[0]);
  for (i = 0; i < N.eq.length - 1; i++) N.eq[i].connect(N.eq[i + 1]);
  var eqEnd = N.eq[N.eq.length - 1];
  // 音色层：清理 -> 静态低架 -> 动态低架 -> 高架 -> 中高轮廓 -> 齿音保护 -> 补偿
  eqEnd.connect(N.knobHP); N.knobHP.connect(N.knobBass); N.knobBass.connect(N.dynBass); N.dynBass.connect(N.knobAir);
  N.knobAir.connect(N.contour); N.contour.connect(N.deess); N.deess.connect(N.knobTrim);
  N.contour.connect(N.deessAn);  // 激励：干路(1-w) 与 饱和湿路(w) 互补汇入 exciteSum
  N.knobTrim.connect(N.exciteDry); N.exciteDry.connect(N.exciteSum);
  N.knobTrim.connect(N.exciteDrive); N.exciteDrive.connect(N.exciteWS); N.exciteWS.connect(N.exciteWet); N.exciteWet.connect(N.exciteSum);
  N.exciteSum.connect(N.air); N.air.connect(N.compPre); N.compPre.connect(N.comp); N.comp.connect(N.makeup);
  // 干湿
  N.makeup.connect(N.master);
  N.makeup.connect(N.revSend); N.revSend.connect(N.predelay); N.predelay.connect(N.conv); N.conv.connect(N.revReturn); N.revReturn.connect(N.master);
  // M/S 编码
  N.master.connect(N.msSplit);
  N.msSplit.connect(N.l2m, 0, 0); N.msSplit.connect(N.r2m, 1, 0);
  N.msSplit.connect(N.l2s, 0, 0); N.msSplit.connect(N.r2s, 1, 0);
  N.l2m.connect(N.mid); N.r2m.connect(N.mid);
  N.l2s.connect(N.side); N.r2s.connect(N.side);
  N.side.connect(N.sideHP);
  // M/S 解码
  N.mid.connect(N.m2l); N.mid.connect(N.m2r);
  N.sideHP.connect(N.s2l); N.sideHP.connect(N.s2r);
  N.m2l.connect(N.outMerge, 0, 0); N.s2l.connect(N.outMerge, 0, 0);
  N.m2r.connect(N.outMerge, 0, 1); N.s2r.connect(N.outMerge, 0, 1);
  // Crossfeed：直通 + 对侧低通串入
  N.outMerge.connect(N.xfSplit);
  N.xfSplit.connect(N.xfDryL, 0); N.xfDryL.connect(N.xfMerge, 0, 0);
  N.xfSplit.connect(N.xfDryR, 1); N.xfDryR.connect(N.xfMerge, 0, 1);
  N.xfSplit.connect(N.xfLPl, 1); N.xfLPl.connect(N.xfGl); N.xfGl.connect(N.xfMerge, 0, 0);
  N.xfSplit.connect(N.xfLPr, 0); N.xfLPr.connect(N.xfGr); N.xfGr.connect(N.xfMerge, 0, 1);
  // 输出
  N.xfMerge.connect(N.output); N.output.connect(N.vol); N.vol.connect(N.limiter);
  N.limiter.connect(N.analyser); N.analyser.connect(ctx.destination);
  N.limiter.connect(N.lrSplit);
  N.lrSplit.connect(N.lrAnL, 0); N.lrSplit.connect(N.lrAnR, 1);

  nodes = N;
  rmsBuf = new Float32Array(N.analyser.fftSize);
  freqBuf = new Float32Array(N.analyser.frequencyBinCount);
  irCache['room:2'] = makeIR(IR_DEFS.room, 2.0); N.conv.buffer = irCache['room:2'];
  diag.chain = 'ok';
}
function syncVolume() {
  if (!nodes || !claimed) return;
  var v = (claimed.muted === true) ? 0 : (claimed.volume || 1);
  try { nodes.vol.gain.value = v; } catch (e) {}
}


// ---------------- 模块应用 ----------------
var kwMs = 0, autoDb = 0;
function applyInput() {
  if (!nodes) return;
  var m = state.modules.input;
  var g = clamp(m.gain || 0, -24, 24);
  var extra = m.autoLoud ? clamp(autoDb, -12, 12) : ((m.autoLoud && typeof m.autoGainDb === 'number') ? clamp(m.autoGainDb, -12, 12) : 0);
  try { nodes.input.gain.setTargetAtTime(dbToGain(g + extra), ctx.currentTime, 0.05); } catch (e) {}
  // K 加权响度，目标 -14 LUFS，替代原来的简单 RMS
}
function lufsTick() {
  if (!nodes || !nodes.kwAn) return;
  if (!state.modules.input.autoLoud) { autoDb = 0; return; }
  var b = nodes.kwBuf;
  try { nodes.kwAn.getFloatTimeDomainData(b); } catch (e) { return; }
  var s = 0;
  for (var i = 0; i < b.length; i++) s += b[i] * b[i];
  var msNow = s / b.length;
  kwMs = kwMs > 0 ? kwMs * 0.92 + msNow * 0.08 : msNow;
  if (!(kwMs > 1e-9)) return;
  var lufs = -0.691 + 10 * Math.log10(kwMs);
  // 减掉已应用的补偿，得到补偿前的节目响度，否则会形成闭环只补偿一半
  var raw = lufs - autoDb;
  var want = clamp(-14 - raw, -12, 12);
  autoDb += (want - autoDb) * 0.12;
  try { nodes.input.gain.setTargetAtTime(dbToGain(clamp((state.modules.input.gain || 0) + autoDb, -30, 24)), ctx.currentTime, 0.25); } catch (e) {}
}
function currentLufs() {
  if (!(kwMs > 1e-9)) return null;
  return +(-0.691 + 10 * Math.log10(kwMs)).toFixed(1);
}
function applyBass() {
  if (!nodes) return;
  var m = state.modules.bass, amt = clamp(m.amount || 0, 0, 1);
  try {
    nodes.bassLP.frequency.setTargetAtTime(clamp(m.freq || 90, 40, 160), ctx.currentTime, 0.05);
    nodes.bassBP.frequency.setTargetAtTime(clamp((m.freq || 90) * 1.7, 90, 400), ctx.currentTime, 0.05);
    nodes.bassDrive.gain.setTargetAtTime(1.2 + amt * 2.2, ctx.currentTime, 0.05);
    if (nodes.bassWS.__amt !== amt) { nodes.bassWS.curve = harmCurve(amt); nodes.bassWS.__amt = amt; }
    // 谐波最多混入 30%，量小才不脏
    nodes.bassGain.gain.setTargetAtTime(m.on ? amt * 0.3 : 0, ctx.currentTime, 0.05);
  } catch (e) {}
}
function applyEQ() {
  if (!nodes) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands)) state.modules.eq = { bands: defaultBands() };
  var bands = state.modules.eq.bands, k = clamp(state.intensity, 0, 100) / 100;
  for (var i = 0; i < nodes.eq.length && i < bands.length; i++) {
    var b = bands[i], f = nodes.eq[i];
    try {
      f.type = b.type || 'peaking';
      f.frequency.value = clamp(b.freq || EQ_FREQS[i], 20, 20000);
      f.Q.value = clamp(b.q || 1, 0.1, 10);
      f.gain.value = (b.gain || 0) * k;
    } catch (e) {}
  }
}
var lastCurveKey = '';
function applyExcite() {
  if (!nodes) return;
  var m = state.modules.excite, k = clamp(state.intensity, 0, 100) / 100;
  var type = m.type || 'off';
  try {
    var ck = type + ':' + (m.drive || 0).toFixed(2);
    if (ck !== lastCurveKey) { nodes.exciteWS.curve = makeCurve(type, m.drive || 0); lastCurveKey = ck; }
    var wet = (type === 'off') ? 0 : clamp(0.25 + (m.drive || 0) * 0.7, 0, 1) * k;
    nodes.exciteDry.gain.value = 1 - wet * 0.5;             // 互补，电平不翻倍
    nodes.exciteWet.gain.value = wet;
    nodes.exciteDrive.gain.value = 2 + (m.drive || 0) * 4;  // 前置增益，小信号也能出谐波
    nodes.air.gain.value = (m.air || 0) * k;
  } catch (e) {}
}
function applyComp() {
  if (!nodes) return;
  var m = state.modules.comp;
  try {
    nodes.comp.threshold.value = clamp(m.th != null ? m.th : -24, -60, 0);
    nodes.comp.knee.value = clamp(m.knee != null ? m.knee : 4, 0, 40);
    nodes.comp.ratio.value = clamp(m.ratio != null ? m.ratio : 4, 1, 20);
    nodes.comp.attack.value = clamp(m.at != null ? m.at : 0.003, 0, 1);
    nodes.comp.release.value = clamp(m.rel != null ? m.rel : 0.18, 0, 1);
    // 压缩前预增益：把信号顶进阈值，压缩才真正发生；补偿只补回一部分，避免抬峰值
    var mk = clamp(m.makeup || 0, -12, 12);
    nodes.compPre.gain.value = dbToGain(clamp(mk * 0.6, -8, 8));
    nodes.makeup.gain.value = dbToGain(clamp(mk * 0.4, -6, 6));
    // 限幅兜住压缩后峰值
    nodes.limiter.threshold.value = m.limiter ? clamp(m.ceiling != null ? m.ceiling : -1, -12, 0) : 0;
    nodes.limiter.ratio.value = m.limiter ? 20 : 1;
    nodes.limiter.attack.value = m.limiter ? 0.001 : 0.01;
    nodes.limiter.release.value = m.limiter ? 0.12 : 0.25;
  } catch (e) {}
}
function applyReverb() {
  if (!nodes) return;
  var m = state.modules.reverb;
  try {
    nodes.revSend.gain.value = (m.ir === 'none') ? 0 : clamp(m.wet != null ? m.wet : 0.2, 0, 1);
    nodes.predelay.delayTime.value = clamp((m.predelay || 0) / 1000, 0, 0.5);
    // 目标 IR：按「空间+尺寸」缓存，同一个只生成一次
    var targetIR = null;
    if (m.ir === 'custom' && CUSTOM_IR) targetIR = CUSTOM_IR;
    else if (m.ir !== 'none') {
      var sz = Math.round(clamp(m.size || 2, 0.5, 4) * 2) / 2;
      var key = (m.ir || 'room') + ':' + sz;
      if (!irCache[key]) irCache[key] = makeIR(IR_DEFS[m.ir] || IR_DEFS.room, sz);
      targetIR = irCache[key];
    }
    // 换 Convolver buffer 会阻塞主线程几十毫秒，放到稍后执行，点击不卡
    if (targetIR && nodes.conv.buffer !== targetIR) scheduleIR(targetIR);
  } catch (e) {}
}
var _irTimer = null, _pendingIR = null;
function scheduleIR(buf) {
  _pendingIR = buf;
  if (_irTimer) return;
  _irTimer = setTimeout(function () {
    _irTimer = null;
    var b = _pendingIR; _pendingIR = null;
    if (b && nodes && nodes.conv && nodes.conv.buffer !== b) { try { nodes.conv.buffer = b; } catch (e) {} }
  }, 90);
}
function applyStereo() {
  if (!nodes) return;
  var m = state.modules.stereo;
  try {
    var w = clamp(m.width || 0, -1, 1);
    var sideDb = clamp(m.side || 0, -12, 12);
    var sideGain = clamp(dbToGain(sideDb) * (1 + w), 0, 4);  // 上限钳位，防过载
    nodes.side.gain.value = sideGain;
    nodes.mid.gain.value = dbToGain(clamp(m.mid || 0, -12, 12));
    nodes.sideHP.frequency.value = (m.sideLowcut && m.sideLowcut > 0) ? clamp(m.sideLowcut, 20, 1000) : 20;
  } catch (e) {}
}
function applyOutput() {
  if (!nodes) return;
  try { nodes.output.gain.value = dbToGain(clamp(state.modules.output.gain || 0, -24, 12)); } catch (e) {}
}
var enabledApplied = null;
function applyEnabled() {
  if (!nodes || !claimed) return;
  syncDyn();
  if (enabledApplied === state.enabled) return;   // 幂等，状态没变不重连
  var on = state.enabled;
  try {
    srcNode.disconnect();
    if (nodes.bypass) { try { nodes.bypass.disconnect(); } catch (e) {} nodes.bypass = null; }
    if (on) srcNode.connect(nodes.input);
    else {
      nodes.bypass = ctx.createGain(); nodes.bypass.gain.value = 1; nodes.bypass.connect(ctx.destination);
      srcNode.connect(nodes.bypass);
    }
    enabledApplied = on;
  } catch (e) {}
}
function applyAll() {
  applyInput(); applyBass(); applyEQ(); applyKnobs(); applyExcite(); applyComp(); applyReverb(); applyStereo(); applyCrossfeed(); applyOutput();
  applyEnabled(); syncVolume();
  updateUI(); if (typeof syncBands === 'function') syncBands(); if (typeof syncCtrls === 'function') syncCtrls(); ui.eqDirty = true;
}

// 顶部旋钮：低音 = 静态低架 + 动态低架 + 可选谐波；亮度 = 高架 + 中高轮廓
function applyKnobs() {
  if (!nodes || !nodes.knobBass) return;
  var k = clamp(state.intensity, 0, 100) / 100;
  var kn = state.knobs || { bass: 0, air: 0 };
  var bassDb = clamp(kn.bass || 0, 0, 100) / 100 * 8 * k;    // 0..+8dB @88Hz 静态低架
  var airDb = clamp(kn.air || 0, 0, 100) / 100 * 9 * k;      // 0..+9dB @8.5kHz 高架
  var contourDb = clamp(kn.air || 0, 0, 100) / 100 * 4 * k;  // 0..+4dB @2.8kHz 轮廓
  try {
    nodes.knobBass.gain.setTargetAtTime(bassDb, ctx.currentTime, 0.03);
    nodes.knobAir.gain.setTargetAtTime(airDb, ctx.currentTime, 0.03);
    nodes.contour.gain.setTargetAtTime(contourDb, ctx.currentTime, 0.03);
    // 等响补偿：提升多的部分预先让出余量，限幅器不猛压，整体音量不跳
    var trimDb = -(bassDb * 0.20 + airDb * 0.12 + contourDb * 0.10);
    nodes.knobTrim.gain.setTargetAtTime(Math.pow(10, trimDb / 20), ctx.currentTime, 0.03);
  } catch (e) {}
  dynWant = bassDb * 0.75;   // 动态低音最多再补 75% 的静态量
  syncDyn();
  applyDeess();
}

// ---------------- 动态低音 + 齿音保护 ----------------
var dynTimer = null, dynCur = 0, dynWant = 0;
function syncDyn() {
  if (state.enabled && nodes && ctx) {
    if (!dynTimer) dynTimer = setInterval(dynTick, 60);
  } else {
    if (dynTimer) { clearInterval(dynTimer); dynTimer = null; }
    if (nodes && nodes.dynBass && ctx) { try { nodes.dynBass.gain.setTargetAtTime(0, ctx.currentTime, 0.08); } catch (e) {} }
    if (nodes && nodes.deess && ctx) { try { nodes.deess.gain.setTargetAtTime(0, ctx.currentTime, 0.08); } catch (e) {} }
    dynCur = 0;
  }
}
function bandAvgDb(buf, fLow, fHigh, an) {
  try {
    var binHz = ctx.sampleRate / an.fftSize;
    var a = Math.max(1, Math.floor(fLow / binHz)), b = Math.min(buf.length - 1, Math.ceil(fHigh / binHz));
    var s = 0, n = 0;
    for (var i = a; i <= b; i++) { var v = buf[i]; if (isFinite(v)) { s += v; n++; } }
    return n ? s / n : -140;
  } catch (e) { return -140; }
}
function dynTick() {
  if (!nodes || !ctx || !nodes.dynAn) return;
  var db = -140;
  try { nodes.dynAn.getFloatFrequencyData(nodes.dynBuf); db = bandAvgDb(nodes.dynBuf, 40, 160, nodes.dynAn); } catch (e) { return; }
  // 低频弱就多补，低频本身很足时只补 35%，避免糊
  var t = clamp((db + 58) / 38, 0, 1);
  var target = dynWant * (0.35 + 0.65 * (1 - t));
  var coef = target > dynCur ? 0.28 : 0.07;   // attack 约 120ms，release 约 500ms
  dynCur += (target - dynCur) * coef;
  try { nodes.dynBass.gain.setTargetAtTime(dynCur, ctx.currentTime, 0.05); } catch (e) {}
  applyDeess();
  lufsTick();
}
function bandMaxDb(buf, fLow, fHigh, an) {
  try {
    var binHz = ctx.sampleRate / an.fftSize;
    var a = Math.max(1, Math.floor(fLow / binHz)), b = Math.min(buf.length - 1, Math.ceil(fHigh / binHz));
    var peak = -140;
    for (var i = a; i <= b; i++) { var v = buf[i]; if (isFinite(v) && v > peak) peak = v; }
    return peak;
  } catch (e) { return -140; }
}
function applyDeess() {
  if (!nodes || !nodes.deess) return;
  if (!dynTimer) { try { nodes.deess.gain.setTargetAtTime(0, ctx.currentTime, 0.05); } catch (e) {} return; }
  var db = -140;
  try { nodes.deessAn.getFloatFrequencyData(nodes.deessBuf); db = bandMaxDb(nodes.deessBuf, 5000, 9000, nodes.deessAn); } catch (e) {}
  // 齿音是尖峰，看峰值。超过 -42dB 开始压，最多 -3.5dB
  var over = clamp((db + 42) / 20, 0, 1);
  try { nodes.deess.gain.setTargetAtTime(-3.5 * over, ctx.currentTime, 0.06); } catch (e) {}
}

function applyCrossfeed() {
  if (!nodes || !nodes.xfGl) return;
  var m = state.modules.crossfeed || { on: false, preset: 'mid', level: 0.35 };
  var pres = { low: { fc: 360, feed: 0.398 }, mid: { fc: 500, feed: 0.46 }, high: { fc: 700, feed: 0.53 } }[m.preset] || { fc: 500, feed: 0.46 };
  var lv = clamp(m.level == null ? 0.35 : m.level, 0, 1);
  try {
    nodes.xfLPl.frequency.setTargetAtTime(pres.fc, ctx.currentTime, 0.04);
    nodes.xfLPr.frequency.setTargetAtTime(pres.fc, ctx.currentTime, 0.04);
    nodes.xfGl.gain.setTargetAtTime(m.on ? pres.feed * lv : 0, ctx.currentTime, 0.04);
    nodes.xfGr.gain.setTargetAtTime(m.on ? pres.feed * lv : 0, ctx.currentTime, 0.04);
    var dry = m.on ? (1 - 0.15 * lv) : 1;
    nodes.xfDryL.gain.setTargetAtTime(dry, ctx.currentTime, 0.04);
    nodes.xfDryR.gain.setTargetAtTime(dry, ctx.currentTime, 0.04);
  } catch (e) {}
}

// ---------------- 预设应用 ----------------
function applyPreset(id) {
  var p = findPreset(id);
  state.preset = p.id;
  var base = defaultState();
  if (p.modules) {
    for (var mk in p.modules) if (p.modules.hasOwnProperty(mk) && base.modules[mk]) {
      var ov = p.modules[mk], dst = base.modules[mk];
      for (var j in ov) if (ov.hasOwnProperty(j)) dst[j] = deepClone(ov[j]);
    }
  }
  if (!Array.isArray(base.modules.eq.bands) || base.modules.eq.bands.length !== 10) base.modules.eq = { bands: defaultBands() };
  // 预设可带旋钮值；不带就保留用户当前的旋钮，像硬件上的 bass/treble
  if (!state.knobs) state.knobs = { bass: 0, air: 0 };
  var pk = p.knobs || (p.modules && p.modules.knobs) || null;
  if (pk) {
    state.knobs.bass = clamp(+(pk.bass || 0), 0, 100);
    state.knobs.air = clamp(+(pk.air || 0), 0, 100);
  }
  base.knobs = state.knobs;
  base.intensity = state.intensity; base.open = state.open; base.tab = state.tab; base.enabled = state.enabled;
  state.modules = base.modules;
  state.smart = false; state.ab = null;
  saveState(); applyAll();
  toast('已切换：' + p.name);
}

// ---------------- 接管 audio ----------------
function resume() { if (ctx && ctx.state !== 'running') { try { ctx.resume().catch(function () {}); } catch (e) {} } }
function onPlay() { claimedPlayed = true; resume(); if (state.smart) startSmart(); }
function claim(el) {
  if (claimed === el) return;
  if (claimed) { try { if (srcNode) srcNode.disconnect(); } catch (e) {} }
  claimed = el; window.__ss_el = el; diag.how = 'ctor';
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { diag.err = 'AudioContext: ' + e.message; return; }
  try { ctx.onstatechange = function () { updateDiag(); }; } catch (e) {}
  buildChain();
  try { srcNode = ctx.createMediaElementSource(el); srcNode.connect(nodes.input); diag.src = 'ok'; }
  catch (e) { diag.src = 'fail'; diag.err = 'capture: ' + e.message; return; }
  hookProp(el, 'volume', function () { syncVolume(); });
  hookProp(el, 'muted', function () { syncVolume(); });
  installSetSinkHook(el);
  el.addEventListener('play', onPlay, true);
  resume(); setTimeout(resume, 300); setTimeout(resume, 1000);
  // 保留用户上次的总开关选择；首次默认开。不强制打开，否则关了重启又自己开
  if (typeof state.enabled !== 'boolean') state.enabled = true;
  enabledApplied = null;   // 让 applyEnabled 按当前状态接线
  applyAll();
}
function installSetSinkHook(el) {
  var orig = el.setSinkId;
  if (typeof orig !== 'function') return;
  el.setSinkId = function () { var r = orig.apply(this, arguments); if (ctx && typeof ctx.setSinkId === 'function') { try { ctx.setSinkId(arguments[0]); } catch (e) {} } return r; };
}
function maybeClaim(el) { if (!claimed && el.preload !== 'metadata') claim(el); }
var origPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (this.tagName === 'AUDIO' && this.crossOrigin === 'anonymous' && this !== claimed && !claimedPlayed) claim(this);
  return origPlay.apply(this, arguments);
};
(function hookAudioCtor() {
  var OrigAudio = window.Audio;
  if (typeof OrigAudio !== 'function') return;
  window.Audio = function Audio() {
    var el = new OrigAudio();
    try {
      hookProp(el, 'crossOrigin', function (v) { if (v === 'anonymous') maybeClaim(el); });
      hookProp(el, 'preload', function (v) {
        if (v === 'metadata' && claimed === el) {
          try { if (srcNode) srcNode.disconnect(); } catch (e) {}
          claimed = null; srcNode = null; claimedPlayed = false; diag.src = 'skip:probe'; diag.chain = '-';
        }
      });
    } catch (e) {}
    return el;
  };
  window.Audio.prototype = OrigAudio.prototype;
  try { Object.setPrototypeOf(window.Audio, OrigAudio); } catch (e) {}
})();


// ---------------- 反馈：toast ----------------
function toast(msg, kind) {
  var t = document.getElementById('ss-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ss-toast'; t.className = 'ss-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'ss-toast ss-show' + (kind ? ' ss-' + kind : '');
  if (toast._t) clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.className = 'ss-toast'; }, 1500);
}

// ---------------- 实时分析 ----------------
function readSpectrum() {
  if (!nodes) return null;
  try { nodes.analyser.getFloatFrequencyData(freqBuf); } catch (e) { return null; }
  return freqBuf;
}
function bandDb(spec, lo, hi) {
  if (!spec) return -90;
  var sr = ctx.sampleRate, n = spec.length;
  var a = Math.max(0, Math.floor(lo / (sr / 2) * n)), b = Math.min(n - 1, Math.ceil(hi / (sr / 2) * n));
  var s = 0, c = 0;
  for (var i = a; i <= b; i++) if (spec[i] > -120) { s += Math.pow(10, spec[i] / 10); c++; }
  return c ? 10 * Math.log10(s / c + 1e-12) : -90;
}
function sampleLevels() {
  if (nodes && nodes.analyser) {
    try {
      nodes.analyser.getFloatTimeDomainData(rmsBuf);
      var s = 0, p = 0;
      for (var i = 0; i < rmsBuf.length; i++) { s += rmsBuf[i] * rmsBuf[i]; var av = Math.abs(rmsBuf[i]); if (av > p) p = av; }
      rms = Math.sqrt(s / rmsBuf.length); peak = p;
    } catch (e) { rms = 0; peak = 0; }
  }
}
function dbVal() { return rms > 0 ? (20 * Math.log10(rms + 1e-9)).toFixed(1) : '-∞'; }

// ---------------- 智能引擎 ----------------
function startSmart() {
  smartAccum = { low: 0, mid: 0, high: 0, vocal: 0, n: 0, loud: 0 }; smartFrames = 0;
  if (smartTimer) clearInterval(smartTimer);
  smartTimer = setInterval(function () {
    var spec = readSpectrum();
    if (!spec) return;
    var lo = bandDb(spec, 30, 160), mid = bandDb(spec, 300, 2000), hi = bandDb(spec, 6000, 16000), voc = bandDb(spec, 800, 3500);
    smartAccum.low += Math.pow(10, lo / 20); smartAccum.mid += Math.pow(10, mid / 20);
    smartAccum.high += Math.pow(10, hi / 20); smartAccum.vocal += Math.pow(10, voc / 20);
    smartAccum.loud += rms; smartAccum.n++; smartFrames++;
    if (smartFrames >= 20) finishSmart();
  }, 150);
}
function finishSmart() {
  if (smartTimer) { clearInterval(smartTimer); smartTimer = null; }
  var a = smartAccum, n = Math.max(1, a.n);
  function lin(v) { return 20 * Math.log10(v / n + 1e-9); }
  var L = lin(a.low), M = lin(a.mid), H = lin(a.high), V = lin(a.vocal), overall = (L + M + H) / 3;
  var bL = clamp((L - overall) / 12, -1, 1), bH = clamp((H - overall) / 12, -1, 1), bV = clamp((V - M) / 10, -1, 1);
  var bands = defaultBands();
  bands[0].gain += -bL * 4; bands[1].gain += -bL * 3;
  bands[8].gain += -bH * 3; bands[9].gain += -bH * 2;
  if (bV < -0.1) { bands[6].gain += 2.5 * Math.abs(bV); bands[7].gain += 3 * Math.abs(bV); }
  state.modules.eq = { bands: bands };
  state.modules.excite = { type: 'off', drive: 0, air: 0 };
  state.modules.stereo.width = clamp((bL + bH) * 0.15, -0.2, 0.35);
  state.modules.bass = { on: false, freq: 90, amount: 0.6 };
  if (!state.knobs) state.knobs = { bass: 0, air: 0 };
  state.knobs.bass = clamp(Math.round(-bL * 40), 0, 55);
  state.knobs.air = clamp(Math.round(-bH * 35), 0, 45);
  var target = 0.126, meas = a.loud / n;
  if (meas > 0.0001) { state.modules.input.autoLoud = true; state.modules.input.autoGainDb = +clamp(20 * Math.log10(target / meas), -12, 12).toFixed(2); }
  state.preset = 'smart'; state.smart = true;
  saveState(); applyAll();
  window.__ss_lastSmart = { L: +L.toFixed(1), M: +M.toFixed(1), H: +H.toFixed(1), V: +V.toFixed(1), autoGainDb: state.modules.input.autoGainDb };
  toast('智能调音完成', 'ok');
}
function toggleSmart(on) {
  state.smart = !!on;
  if (!state.smart) { if (smartTimer) { clearInterval(smartTimer); smartTimer = null; } state.modules.input.autoLoud = false; toast('智能调音已关'); }
  else { if (!claimed) { toast('先播放一首歌再开智能'); state.smart = false; return; } startSmart(); toast('智能分析中…'); }
  saveState(); updateUI();
}

// ---------------- 快捷开关 ----------------
function toggleEnabled(force) {
  state.enabled = (typeof force === 'boolean') ? force : !state.enabled;
  applyEnabled(); saveState(); updateUI();
  toast(state.enabled ? '音效已开启' : '音效已关闭 · 原音直通', state.enabled ? 'ok' : 'off');
}
// 任何调参动作都把总开关打开，避免「关了以后调半天没反应」
function autoEnable(e) {
  var t = e.target;
  if (!t || !t.classList) return;
  // 强度滑块本身不参与兜底，否则拖到 0 会被弹回去
  if (ui.strength && t === ui.strength) return;
  var hit = t.classList.contains('ss-rng') || t.classList.contains('ss-sel') || t.classList.contains('ss-knob-r') ||
    (t.closest && t.closest('.ss-item[data-id]'));
  if (!hit) return;
  // 强度被拖到 0 时调参同样没声音，恢复到 100 再动参数
  if (state.intensity < 5) {
    state.intensity = 100;
    if (ui.strength) ui.strength.value = 100;
    if (ui.strengthV) ui.strengthV.textContent = '100%';
    applyEQ(); applyKnobs(); applyExcite();
    toast('强度已恢复到 100%', 'ok');
    saveState();
    if (state.enabled) return;
  }
  if (state.enabled) return;
  // 只接线和改按钮，不整屏刷新，否则正在拖的滑块会被重置
  state.enabled = true;
  applyEnabled(); saveState();
  if (ui.pw) { ui.pw.textContent = '● 开'; ui.pw.classList.add('ss-on'); ui.pw.classList.remove('ss-off'); }
  toast('已自动开启音效', 'ok');
}
function bindShortcuts() {
  // 桌面歌词窗/歌词页不绑快捷键，只在主界面生效
  if ((location.hash || '').toLowerCase().indexOf('lyrics') >= 0) return;
  // Alt+Shift+S 开关总音效，Alt+Shift+P 开面板，Alt+Shift+M 智能
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || !e.shiftKey) return;
    var k = (e.key || '').toUpperCase();
    if (k === 'S') { e.preventDefault(); toggleEnabled(); }
    else if (k === 'P') { e.preventDefault(); togglePanel(); }
    else if (k === 'M') { e.preventDefault(); toggleSmart(!state.smart); }
  }, true);
}

// ---------------- UI 基础 ----------------
var ui = { btn: null, panel: null, diag: null, canvas: null, cctx: null, eqCanvas: null, eqc: null,
  raf: null, tab: 'eq', knobs: null, bandCtl: [], binds: [], built: false, eqDirty: true, vizOn: false };

function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function num(v, d) { return (+v).toFixed(d == null ? 2 : d); }

// 小标题分组
function group(title) {
  var g = el('div', 'ss-group');
  if (title) g.appendChild(el('div', 'ss-group-h', title));
  return g;
}
// 一行：标签 + 控件 + 数值
function row(label, ctrl, valEl) {
  var r = el('div', 'ss-row2');
  if (label) r.appendChild(el('label', 'ss-lab', label));
  r.appendChild(ctrl);
  if (valEl) r.appendChild(valEl);
  return r;
}
// 滑块（返回 {s,v,set,fmt}）
function slider(min, max, step, val, onInput, fmt) {
  var s = el('input', 'ss-rng'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = val;
  var v = el('span', 'ss-val', '');
  var f = fmt || function (x) { return num(x); };
  v.textContent = f(val);
  s.addEventListener('input', function () {
    var x = parseFloat(s.value); v.textContent = f(x); onInput(x);
    s.classList.add('ss-flash'); setTimeout(function () { s.classList.remove('ss-flash'); }, 160);
  });
  // 双击复位到默认值
  s.addEventListener('dblclick', function () {
    var d = parseFloat(s.getAttribute('data-def'));
    if (isFinite(d)) { s.value = d; v.textContent = f(d); onInput(d); toast('已复位'); }
  });
  s.setAttribute('data-def', val);
  return { s: s, v: v, wrap: row('', s, v), set: function (x) { s.value = x; v.textContent = f(x); }, fmt: f };
}
function select(options, val, onChange) {
  var s = el('select', 'ss-sel');
  for (var i = 0; i < options.length; i++) { var o = el('option', null, options[i].label); o.value = options[i].value; s.appendChild(o); }
  s.value = val;
  s.addEventListener('change', function () { onChange(s.value); });
  return s;
}
function check(label, checked, onChange) {
  var w = el('label', 'ss-check');
  var c = el('input'); c.type = 'checkbox'; c.checked = !!checked;
  c.addEventListener('change', function () { onChange(c.checked); });
  w.appendChild(c); w.appendChild(document.createTextNode(' ' + label));
  return { wrap: w, set: function (x) { c.checked = !!x; } };
}

// ---------------- 面板骨架 ----------------
function buildPanel() {
  var panel = el('div', 'ss-panel' + (state.open ? '' : ' ss-hidden'));
  panel.id = 'ss-panel';

  // 顶栏
  var top = el('div', 'ss-top');
  var brand = el('div', 'ss-brand', '声境音效');
  brand.appendChild(el('span', 'ss-brand-sub', 'SonicScape'));
  top.appendChild(brand);
  ui.status = el('div', 'ss-status', '');
  top.appendChild(ui.status);
  var acts = el('div', 'ss-acts');
  var pw = el('button', 'ss-btn ss-power', '');
  pw.title = '总开关 (Alt+Shift+S)';
  pw.addEventListener('click', function (e) { e.preventDefault(); toggleEnabled(); });
  ui.pw = pw;
  var ab = el('button', 'ss-btn', 'A/B'); ab.title = '原音对照';
  ab.addEventListener('click', function (e) { e.preventDefault(); toggleAB(); });
  var smart = el('button', 'ss-btn ss-smart', '智能');
  smart.addEventListener('click', function (e) { e.preventDefault(); toggleSmart(!state.smart); });
  var close = el('button', 'ss-btn ss-close', '×'); close.title = '关闭 (Esc)';
  close.addEventListener('click', function (e) { e.preventDefault(); togglePanel(); });
  acts.appendChild(pw); acts.appendChild(ab); acts.appendChild(smart); acts.appendChild(close);
  top.appendChild(acts);
  panel.appendChild(top);

  // 主体两栏
  var body = el('div', 'ss-body');
  var side = el('div', 'ss-side'); ui.side = side;
  var main = el('div', 'ss-main'); ui.main = main;

  // 右栏：旋钮 + 强度
  var hero = el('div', 'ss-hero');
  ui.hero = hero; main.appendChild(hero);

  // 频谱
  var viz = el('div', 'ss-viz');
  ui.canvas = el('canvas', 'ss-spectrum'); ui.canvas.width = 1040; ui.canvas.height = 96;
  viz.appendChild(ui.canvas); ui.cctx = ui.canvas.getContext('2d');
  var meter = el('div', 'ss-meter'); var bar = el('div', 'ss-meter-bar'); meter.appendChild(bar);
  viz.appendChild(meter); ui.meterBar = bar;
  main.appendChild(viz);

  // 高级标签
  var adv = el('div', 'ss-advanced'); ui.advanced = adv; main.appendChild(adv);
  var tabs = el('div', 'ss-tabs');
  [['eq', '均衡'], ['dyn', '动态'], ['space', '混响'], ['stereo', '声场'], ['io', '输入输出'], ['lib', '预设库']].forEach(function (t) {
    var b = el('button', 'ss-tab', t[1]); b.setAttribute('data-tab', t[0]);
    b.addEventListener('click', function (e) { e.preventDefault(); switchTab(t[0]); });
    tabs.appendChild(b);
  });
  adv.appendChild(tabs);
  var pages = el('div', 'ss-pages'); ui.pages = pages; adv.appendChild(pages);

  body.appendChild(side); body.appendChild(main);
  panel.appendChild(body);
  ui.diag = el('div', 'ss-foot', ''); panel.appendChild(ui.diag);
  return panel;
}

function switchTab(k) {
  ui.tab = k; state.tab = k; saveState();
  var tabs = ui.panel.querySelectorAll('.ss-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('ss-on', tabs[i].getAttribute('data-tab') === k);
  var pg = ui.panel.querySelectorAll('.ss-page');
  for (var j = 0; j < pg.length; j++) pg[j].style.display = (pg[j].getAttribute('data-page') === k) ? 'block' : 'none';
  if (k === 'eq') { ui.eqDirty = true; drawEQCurve(); }
}
function page(parent, key) { var p = el('div', 'ss-page'); p.setAttribute('data-page', key); p.style.display = 'none'; parent.appendChild(p); return p; }

// 控件回读：切预设/导入后把界面数值刷成 state 里的真实值
function bindCtl(getFn, setFn) { ui.binds.push({ g: getFn, s: setFn }); return setFn; }
function syncCtrls() {
  for (var i = 0; i < ui.binds.length; i++) {
    try { var b = ui.binds[i]; b.s(b.g()); } catch (e) {}
  }
}


// ---------------- 左栏：预设库 ----------------
function buildPresetSide(side) {
  side.innerHTML = '';
  GROUPS.forEach(function (g) {
    var items = PRESETS.filter(function (x) { return x.group === g; });
    if (!items.length) return;
    side.appendChild(el('div', 'ss-group-h', g));
    var grid = el('div', 'ss-sgrid');
    items.forEach(function (it) {
      var b = el('button', 'ss-item', it.name); b.setAttribute('data-id', it.id);
      b.addEventListener('click', function (e) { e.preventDefault(); applyPreset(it.id); });
      grid.appendChild(b);
    });
    side.appendChild(grid);
  });
  side.appendChild(el('div', 'ss-group-h', '我的预设'));
  var ug = el('div', 'ss-sgrid'); ug.id = 'ss-user-grid'; side.appendChild(ug);
  var sr = el('div', 'ss-row2 ss-save');
  var nameInp = el('input', 'ss-txt'); nameInp.placeholder = '预设名'; nameInp.id = 'ss-preset-name';
  var saveBtn = el('button', 'ss-btn ss-btn-sm', '保存当前');
  saveBtn.addEventListener('click', function (e) { e.preventDefault(); saveUserPreset(nameInp.value); });
  sr.appendChild(nameInp); sr.appendChild(saveBtn); side.appendChild(sr);
  renderUserPresets();
}

// ---------------- 右栏：旋钮 + 强度 ----------------
function buildHero(hero) {
  hero.innerHTML = '';
  var knobs = el('div', 'ss-knobs');
  [['bass', '低音'], ['air', '亮度'], ['space', '声场'], ['reverb', '混响']].forEach(function (p) {
    var k = p[0], label = p[1];
    var box = el('div', 'ss-knob');
    var val = el('div', 'ss-knob-v', '0');
    box.appendChild(val);
    var rng = el('input', 'ss-knob-r'); rng.type = 'range'; rng.min = 0; rng.max = 100; rng.step = 1;
    rng.setAttribute('data-knob', k);
    rng.setAttribute('data-def', k === 'space' ? 50 : 0);
    rng.value = k === 'space' ? 50 : 0;
    rng.title = k === 'bass' ? '88Hz 低架最多 +8dB，再按音乐低频自动补 0-6dB'
      : k === 'air' ? '8.5kHz 高架 + 2.8kHz 轮廓，最多 +13dB'
      : k === 'space' ? '立体声宽度，50 为原始'
      : '混响湿度';
    rng.addEventListener('input', function () {
      setKnob(k, parseFloat(rng.value)); val.textContent = rng.value;
    });
    rng.addEventListener('dblclick', function () {
      var d = parseInt(rng.getAttribute('data-def'), 10);
      rng.value = d; setKnob(k, d); val.textContent = d; toast(label + ' 已复位');
    });
    box.appendChild(rng);
    box.appendChild(el('div', 'ss-knob-l', label));
    knobs.appendChild(box);
  });
  hero.appendChild(knobs);
  ui.knobs = knobs;

  var sr = el('div', 'ss-row2 ss-strength');
  sr.appendChild(el('label', 'ss-lab', '强度'));
  var s = el('input', 'ss-rng'); s.type = 'range'; s.min = 0; s.max = 100; s.step = 1; s.value = state.intensity;
  var sv = el('span', 'ss-val', state.intensity + '%');
  s.addEventListener('input', function () {
    state.intensity = parseFloat(s.value); sv.textContent = s.value + '%';
    saveState(); applyEQ(); applyKnobs(); applyExcite(); ui.eqDirty = true;
  });
  sr.appendChild(s); sr.appendChild(sv);
  hero.appendChild(sr);
  ui.strength = s; ui.strengthV = sv;
  bindCtl(function () { return state.intensity; }, function (x) { s.value = x; sv.textContent = Math.round(x) + '%'; });
  renderSimple();
}

function setKnob(k, v) {
  var m = state.modules;
  if (!state.knobs) state.knobs = { bass: 0, air: 0 };
  if (k === 'bass') { state.knobs.bass = clamp(v, 0, 100); saveState(); applyKnobs(); return; }
  if (k === 'air') { state.knobs.air = clamp(v, 0, 100); saveState(); applyKnobs(); return; }
  if (k === 'space') { m.stereo.width = (v - 50) / 50 * 0.8; }
  else if (k === 'reverb') {
    m.reverb.wet = v / 100 * 0.9;
    if (v <= 2) m.reverb.ir = 'none';
    else if (m.reverb.ir === 'none') m.reverb.ir = 'room';
  }
  saveState(); applyAll();
}
function knobsFromModules() {
  var m = state.modules, kn = state.knobs || {};
  return {
    bass: Math.round(clamp(kn.bass || 0, 0, 100)),
    air: Math.round(clamp(kn.air || 0, 0, 100)),
    space: Math.round(((m.stereo && m.stereo.width || 0) + 1) / 2 * 100),
    reverb: Math.round(Math.min(1, (m.reverb && m.reverb.wet || 0) / 0.9) * 100)
  };
}
function renderSimple() {
  if (!ui.knobs) return;
  var kv = knobsFromModules();
  var rs = ui.knobs.querySelectorAll('.ss-knob-r');
  for (var i = 0; i < rs.length; i++) {
    var k = rs[i].getAttribute('data-knob');
    rs[i].value = kv[k];
    var v = rs[i].parentNode.querySelector('.ss-knob-v');
    if (v) v.textContent = kv[k];
  }
}

// ---------------- 均衡 ----------------
function buildEQPage(p) {
  p.appendChild(el('p', 'ss-hint', '拖动曲线上的圆点调频率/增益，下方逐段微调。双击数值复位。'));
  ui.eqCanvas = el('canvas', 'ss-eqcurve'); ui.eqCanvas.width = 1040; ui.eqCanvas.height = 150;
  p.appendChild(ui.eqCanvas); ui.eqc = ui.eqCanvas.getContext('2d');
  bindEQDrag();
  var box = el('div', 'ss-bands'); p.appendChild(box); ui.bandsBox = box;
  // 只建一次，后续只更新数值；回调按索引实时读 state，切预设后依然有效
  ui.bandCtl = [];
  state.modules.eq.bands.forEach(function (b0, i) {
    function band() {
      var bands = state.modules.eq && state.modules.eq.bands;
      if (!bands || !bands[i]) { state.modules.eq = { bands: defaultBands() }; bands = state.modules.eq.bands; }
      return bands[i];
    }
    var line = el('div', 'ss-band');
    var name = el('span', 'ss-band-n', EQ_FREQS[i] >= 1000 ? (EQ_FREQS[i] / 1000) + 'k' : EQ_FREQS[i]);
    var gs = el('input', 'ss-rng'); gs.type = 'range'; gs.min = -15; gs.max = 15; gs.step = 0.5; gs.value = b0.gain;
    var gv = el('span', 'ss-val', num(b0.gain, 1) + 'dB');
    gs.addEventListener('input', function () {
      var b = band(); b.gain = parseFloat(gs.value); gv.textContent = num(b.gain, 1) + 'dB';
      applyEQ(); ui.eqDirty = true;
    });
    gs.addEventListener('dblclick', function () { band().gain = 0; gs.value = 0; gv.textContent = '0.0dB'; applyEQ(); ui.eqDirty = true; });
    var more = el('button', 'ss-band-more', '⋯'); more.title = '类型/频率/Q';
    var detail = el('div', 'ss-band-detail'); detail.style.display = 'none';
    var typeSel = select([
      { value: 'peaking', label: '峰值' }, { value: 'lowshelf', label: '低架' }, { value: 'highshelf', label: '高架' },
      { value: 'lowpass', label: '低通' }, { value: 'highpass', label: '高通' }
    ], b0.type, function (v) { band().type = v; applyEQ(); ui.eqDirty = true; });
    var fSl = slider(20, 20000, 1, b0.freq, function (v) { band().freq = v; applyEQ(); ui.eqDirty = true; },
      function (x) { return x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x); });
    var qSl = slider(0.1, 10, 0.1, b0.q, function (v) { band().q = v; applyEQ(); ui.eqDirty = true; }, function (x) { return num(x, 1); });
    detail.appendChild(row('类型', typeSel));
    detail.appendChild(row('频率', fSl.s, fSl.v));
    detail.appendChild(row('Q', qSl.s, qSl.v));
    more.addEventListener('click', function (e) {
      e.preventDefault(); var open = detail.style.display !== 'block';
      detail.style.display = open ? 'block' : 'none'; more.classList.toggle('ss-on', open);
    });
    line.appendChild(name); line.appendChild(gs); line.appendChild(gv); line.appendChild(more);
    box.appendChild(line); box.appendChild(detail);
    ui.bandCtl.push({ gain: gs, gv: gv, typeSel: typeSel, freq: fSl, q: qSl, idx: i });
  });
  var flat = el('button', 'ss-btn', '全部归零');
  flat.addEventListener('click', function (e) {
    e.preventDefault();
    state.modules.eq = { bands: defaultBands() };
    syncBands(); applyEQ(); ui.eqDirty = true; toast('EQ 已归零', 'ok');
  });
  p.appendChild(flat);
}
// 把 state 里的 EQ 值刷到已建好的控件上（不重建 DOM）
function syncBands() {
  for (var i = 0; i < ui.bandCtl.length; i++) {
    var c = ui.bandCtl[i], b = state.modules.eq.bands[i];
    if (!b) continue;
    c.gain.value = b.gain; c.gv.textContent = num(b.gain, 1) + 'dB';
    c.typeSel.value = b.type || 'peaking';
    c.freq.set(b.freq); c.q.set(b.q);
  }
}


// ---------------- 动态 / 混响 / 声场 / IO / 生态 ----------------
// 注意：所有回调都实时从 state.modules 取值，不缓存对象引用，
// 否则切预设（state.modules 整体替换）后控件就写到废弃对象上，表现为「调了没反应」。

function buildDynPage(p) {
  var g1 = group('激励 / 饱和'); p.appendChild(g1);
  var typeSel = select([
    { value: 'off', label: '关闭' }, { value: 'tube', label: '电子管' }, { value: 'tape', label: '磁带' }, { value: 'soft', label: '柔和' }
  ], state.modules.excite.type, function (v) { state.modules.excite.type = v; applyExcite(); });
  g1.appendChild(row('类型', typeSel));
  bindCtl(function () { return state.modules.excite.type; }, function (x) { typeSel.value = x; });

  var d = slider(0, 1, 0.05, state.modules.excite.drive, function (v) { state.modules.excite.drive = v; applyExcite(); }, function (x) { return num(x, 1); });
  var a = slider(0, 12, 0.5, state.modules.excite.air, function (v) { state.modules.excite.air = v; applyExcite(); }, function (x) { return num(x, 1); });
  g1.appendChild(row('驱动', d.s, d.v)); g1.appendChild(row('空气感', a.s, a.v));
  bindCtl(function () { return state.modules.excite.drive; }, d.set);
  bindCtl(function () { return state.modules.excite.air; }, a.set);

  var g2 = group('压缩器'); p.appendChild(g2);
  var cw = el('div', 'ss-cols');
  [['阈值dB', 'th', -60, 0, 1, 0], ['拐点', 'knee', 0, 40, 1, 0], ['比率', 'ratio', 1, 20, 0.5, 0],
   ['启动', 'at', 0, 1, 0.005, 2], ['释放', 'rel', 0, 1, 0.01, 2], ['补偿dB', 'makeup', -12, 12, 0.5, 1]].forEach(function (cfg) {
    var key = cfg[1];
    var fmt = function (x) {
      if (key === 'at' || key === 'rel') return Math.round(x * 1000) + 'ms';
      return num(x, cfg[5]);
    };
    var s = slider(cfg[2], cfg[3], cfg[4], state.modules.comp[key], function (v) { state.modules.comp[key] = v; applyComp(); }, fmt);
    cw.appendChild(row(cfg[0], s.s, s.v));
    bindCtl(function () { return state.modules.comp[key]; }, s.set);
  });
  g2.appendChild(cw);
  var lc = check('真峰限幅', state.modules.comp.limiter, function (v) { state.modules.comp.limiter = v; applyComp(); });
  g2.appendChild(lc.wrap);
  bindCtl(function () { return !!state.modules.comp.limiter; }, lc.set);
  var ce = slider(-12, 0, 0.5, state.modules.comp.ceiling == null ? -1 : state.modules.comp.ceiling, function (v) { state.modules.comp.ceiling = v; applyComp(); }, function (x) { return num(x, 1) + 'dB'; });
  g2.appendChild(row('限幅顶', ce.s, ce.v));
  bindCtl(function () { var c = state.modules.comp; return c.ceiling == null ? -1 : c.ceiling; }, ce.set);
}

function buildSpacePage(p) {
  var g = group('卷积混响'); p.appendChild(g);
  var opts = Object.keys(IR_DEFS).map(function (k) { return { value: k, label: IR_DEFS[k].label }; });
  opts.push({ value: 'custom', label: '自定义 IR…' });
  var irSel = select(opts, state.modules.reverb.ir, function (v) {
    state.modules.reverb.ir = v;
    if (v === 'custom' && !CUSTOM_IR) openIRPicker();
    applyReverb();
    toast('混响：' + (IR_DEFS[v] ? IR_DEFS[v].label : '自定义'));
  });
  g.appendChild(row('空间', irSel));
  bindCtl(function () { return state.modules.reverb.ir; }, function (x) { irSel.value = x; });

  var w = slider(0, 1, 0.01, state.modules.reverb.wet, function (v) { state.modules.reverb.wet = v; applyReverb(); }, function (x) { return Math.round(x * 100) + '%'; });
  var pd = slider(0, 200, 1, state.modules.reverb.predelay, function (v) { state.modules.reverb.predelay = v; applyReverb(); }, function (x) { return Math.round(x) + 'ms'; });
  var sz = slider(0.5, 4, 0.1, state.modules.reverb.size, function (v) { state.modules.reverb.size = v; applyReverb(); }, function (x) { return num(x, 1); });
  g.appendChild(row('湿度', w.s, w.v)); g.appendChild(row('预延时', pd.s, pd.v)); g.appendChild(row('尺寸', sz.s, sz.v));
  bindCtl(function () { return state.modules.reverb.wet; }, w.set);
  bindCtl(function () { return state.modules.reverb.predelay; }, pd.set);
  bindCtl(function () { return state.modules.reverb.size; }, sz.set);

  var imp = el('button', 'ss-btn', '导入自定义 IR (.wav)');
  imp.addEventListener('click', function (e) { e.preventDefault(); openIRPicker(); });
  g.appendChild(imp);
  ui.irHint = el('p', 'ss-hint', CUSTOM_IR ? ('已载入：' + CUSTOM_IR_NAME) : '可选单/双声道 wav 作为脉冲响应');
  g.appendChild(ui.irHint);
}

function buildStereoPage(p) {
  var g = group('立体声场 / 中侧'); p.appendChild(g);
  var w = slider(-1, 1, 0.05, state.modules.stereo.width, function (v) { state.modules.stereo.width = v; applyStereo(); }, function (x) { return Math.round((x + 1) / 2 * 100); });
  var mid = slider(-12, 12, 0.5, state.modules.stereo.mid, function (v) { state.modules.stereo.mid = v; applyStereo(); }, function (x) { return num(x, 1) + 'dB'; });
  var side = slider(-12, 12, 0.5, state.modules.stereo.side, function (v) { state.modules.stereo.side = v; applyStereo(); }, function (x) { return num(x, 1) + 'dB'; });
  var lc = slider(0, 1000, 10, state.modules.stereo.sideLowcut, function (v) { state.modules.stereo.sideLowcut = v; applyStereo(); }, function (x) { return x > 0 ? Math.round(x) + 'Hz' : '关'; });
  g.appendChild(row('宽度', w.s, w.v)); g.appendChild(row('中央M', mid.s, mid.v));
  g.appendChild(row('侧向S', side.s, side.v)); g.appendChild(row('侧向低切', lc.s, lc.v));
  bindCtl(function () { return state.modules.stereo.width; }, w.set);
  bindCtl(function () { return state.modules.stereo.mid; }, mid.set);
  bindCtl(function () { return state.modules.stereo.side; }, side.set);
  bindCtl(function () { return state.modules.stereo.sideLowcut; }, lc.set);

  var g2 = group('低音谐波增强（进阶）'); p.appendChild(g2);
  g2.appendChild(el('p', 'ss-hint', '给超低音补谐波，让手机小喇叭也听得到低频。会产生额外谐波，默认关闭；平时用顶部「低音」旋钮就够，那个是干净的。'));
  var on = check('开启', state.modules.bass.on, function (v) { state.modules.bass.on = v; applyBass(); });
  g2.appendChild(on.wrap);
  bindCtl(function () { return !!state.modules.bass.on; }, on.set);
  var f = slider(30, 250, 5, state.modules.bass.freq, function (v) { state.modules.bass.freq = v; applyBass(); }, function (x) { return Math.round(x) + 'Hz'; });
  var am = slider(0, 1, 0.05, state.modules.bass.amount, function (v) { state.modules.bass.amount = v; applyBass(); }, function (x) { return num(x, 1); });
  g2.appendChild(row('中心频率', f.s, f.v)); g2.appendChild(row('谐波量', am.s, am.v));
  bindCtl(function () { return state.modules.bass.freq; }, f.set);
  bindCtl(function () { return state.modules.bass.amount; }, am.set);

  var g3 = group('耳机交叉馈送（crossfeed）'); p.appendChild(g3);
  g3.appendChild(el('p', 'ss-hint', '把对侧声音串一点过来，模拟两隻音箱的位置，戴耳机久听不累。'));
  var cfOn = check('开启', state.modules.crossfeed.on, function (v) { state.modules.crossfeed.on = v; applyCrossfeed(); });
  g3.appendChild(cfOn.wrap);
  bindCtl(function () { return !!state.modules.crossfeed.on; }, cfOn.set);
  var cfSel = select([{ value: 'low', label: '弱' }, { value: 'mid', label: '中' }, { value: 'high', label: '强' }],
    state.modules.crossfeed.preset, function (v) { state.modules.crossfeed.preset = v; applyCrossfeed(); });
  g3.appendChild(row('强度档', cfSel));
  bindCtl(function () { return state.modules.crossfeed.preset; }, function (x) { cfSel.value = x; });
  var cfLv = slider(0, 1, 0.05, state.modules.crossfeed.level, function (v) { state.modules.crossfeed.level = v; applyCrossfeed(); }, function (x) { return Math.round(x * 100) + '%'; });
  g3.appendChild(row('混合量', cfLv.s, cfLv.v));
  bindCtl(function () { return state.modules.crossfeed.level; }, cfLv.set);
}

function buildIOPage(p) {
  var g = group('输入'); p.appendChild(g);
  var c = check('响度自动匹配（EBU R128）', state.modules.input.autoLoud, function (v) {
    state.modules.input.autoLoud = v; if (!v) { state.modules.input.autoGainDb = 0; autoDb = 0; } applyInput();
  });
  g.appendChild(c.wrap);
  bindCtl(function () { return !!state.modules.input.autoLoud; }, c.set);
  var ig = slider(-24, 24, 0.5, state.modules.input.gain, function (v) { state.modules.input.gain = v; applyInput(); }, function (x) { return num(x, 1) + 'dB'; });
  g.appendChild(row('输入增益', ig.s, ig.v));
  bindCtl(function () { return state.modules.input.gain; }, ig.set);

  var g2 = group('输出'); p.appendChild(g2);
  var og = slider(-24, 12, 0.5, state.modules.output.gain, function (v) { state.modules.output.gain = v; applyOutput(); }, function (x) { return num(x, 1) + 'dB'; });
  g2.appendChild(row('输出增益', og.s, og.v));
  bindCtl(function () { return state.modules.output.gain; }, og.set);
  g2.appendChild(el('p', 'ss-hint', '音量/静音由插件接管补偿，宿主滑块照常有效'));
}

function buildLibPage(p) {
  var g = group('预设分享'); p.appendChild(g);
  g.appendChild(el('p', 'ss-hint', '导出当前配置成 JSON 发给别人，或粘贴别人的 JSON 导入'));
  var r = el('div', 'ss-row2');
  var exp = el('button', 'ss-btn', '导出'); exp.addEventListener('click', function (e) { e.preventDefault(); exportPreset(); });
  var imp = el('button', 'ss-btn', '导入'); imp.addEventListener('click', function (e) { e.preventDefault(); importPreset(); });
  var cp = el('button', 'ss-btn', '复制'); cp.addEventListener('click', function (e) { e.preventDefault(); copyConfig(); });
  r.appendChild(exp); r.appendChild(imp); r.appendChild(cp); g.appendChild(r);
  ui.codeBox = el('textarea', 'ss-code'); ui.codeBox.placeholder = 'JSON'; g.appendChild(ui.codeBox);
  ui.stat = el('div', 'ss-stat', ''); g.appendChild(ui.stat);

  var g2 = group('耳机校正（AutoEQ）'); p.appendChild(g2);
  g2.appendChild(el('p', 'ss-hint', '把 autoeq.app 生成的 ParametricEQ.txt 内容粘进来，自动铺到 10 段，Preamp 落到输入增益。'));
  ui.aeqBox = el('textarea', 'ss-code');
  ui.aeqBox.placeholder = 'Preamp: -6.8 dB\nFilter 1: ON PK Fc 105 Hz Gain 6.9 dB Q 3.000';
  g2.appendChild(ui.aeqBox);
  var r2 = el('div', 'ss-row2');
  var imp2 = el('button', 'ss-btn', '导入 AutoEQ');
  imp2.addEventListener('click', function (e) { e.preventDefault(); importAutoEQ(); });
  var clr = el('button', 'ss-btn', '清空校正');
  clr.addEventListener('click', function (e) {
    e.preventDefault();
    state.modules.eq = { bands: defaultBands() };
    state.modules.input.gain = 0; state.preset = 'off';
    saveState(); applyAll(); ui.eqDirty = true; toast('校已清空', 'ok');
  });
  r2.appendChild(imp2); r2.appendChild(clr); g2.appendChild(r2);
  ui.aeqStat = el('div', 'ss-stat', ''); g2.appendChild(ui.aeqStat);
}

// AutoEQ/EqualizerAPO 的 ParametricEQ 文本，Preamp + PK/LSC/HSC
function parseAutoEQ(txt) {
  var preamp = 0, out = [];
  String(txt || '').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/Preamp\s*[:：]\s*(-?[\d.]+)\s*dB/i);
    if (m) preamp = parseFloat(m[1]);
    var f = line.match(/Filter\s+\d+\s*[:：]\s*ON\s+(PK|PEQ|LS|LSC|HS|HSC)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/i);
    if (f) {
      var t = /PK|PEQ/i.test(f[1]) ? 'peaking' : /LS/i.test(f[1]) ? 'lowshelf' : 'highshelf';
      out.push({ type: t, freq: +f[2], gain: +f[3], q: f[4] ? +f[4] : 1 });
    }
  });
  return { preamp: preamp, filters: out };
}
function importAutoEQ() {
  var r = parseAutoEQ(ui.aeqBox ? ui.aeqBox.value : '');
  if (!r.filters.length) { toast('没解析到 Filter 行', 'off'); return; }
  var bands = defaultBands();
  for (var i = 0; i < 10; i++) {
    var f = r.filters[i];
    if (f) bands[i] = { type: f.type, freq: clamp(f.freq, 20, 20000), gain: clamp(f.gain, -15, 15), q: clamp(f.q, 0.1, 10) };
    else bands[i] = { type: 'peaking', freq: EQ_FREQS[i], gain: 0, q: 1 };
  }
  state.modules.eq = { bands: bands };
  state.modules.input.gain = clamp(r.preamp, -24, 24);
  state.preset = 'imported'; state.smart = false; state.ab = null;
  saveState(); applyAll(); ui.eqDirty = true;
  if (ui.aeqStat) ui.aeqStat.textContent = '已导入 ' + r.filters.length + ' 段，Preamp ' + r.preamp + ' dB';
  toast('AutoEQ 已导入 ' + r.filters.length + ' 段', 'ok');
}
function currentConfig() { return { v: 1, name: state.preset, intensity: state.intensity, modules: state.modules }; }
function exportPreset() {
  var txt = JSON.stringify(currentConfig());
  if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  if (ui.stat) ui.stat.textContent = '已导出 ' + txt.length + ' 字节';
  toast('已导出', 'ok');
}
function importPreset() {
  var txt = ui.codeBox ? ui.codeBox.value.trim() : '';
  if (!txt) { toast('先粘贴 JSON', 'off'); return; }
  try {
    var o = JSON.parse(txt); if (!o.modules) throw new Error('格式不对');
    state.modules = deepClone(o.modules);
    state.intensity = o.intensity != null ? o.intensity : 100;
    if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
    state.preset = 'imported'; state.smart = false; state.ab = null;
    saveState(); applyAll(); syncBands(); ui.eqDirty = true;
    if (ui.stat) ui.stat.textContent = '导入成功';
    toast('导入成功', 'ok');
  } catch (e) { if (ui.stat) ui.stat.textContent = '导入失败：' + e.message; toast('导入失败', 'off'); }
}
function copyConfig() {
  var txt = JSON.stringify(currentConfig());
  if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  toast('已复制', 'ok');
}

// ---------------- 我的预设 ----------------
function saveUserPreset(name) {
  name = (name || '').trim() || ('预设' + (Object.keys(USER_PRESETS).length + 1));
  USER_PRESETS[name] = { modules: deepClone(state.modules), intensity: state.intensity, ts: Date.now() };
  saveUserPresets(USER_PRESETS); renderUserPresets();
  toast('已保存：' + name, 'ok');
}
function delUserPreset(name) {
  delete USER_PRESETS[name]; saveUserPresets(USER_PRESETS); renderUserPresets();
  toast('已删除：' + name);
}
function applyUserPreset(name) {
  var o = USER_PRESETS[name]; if (!o) return;
  state.modules = deepClone(o.modules);
  state.intensity = o.intensity != null ? o.intensity : 100;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) {
    state.modules.eq = { bands: defaultBands() };
  }
  state.preset = 'user:' + name; state.smart = false; state.ab = null;
  saveState(); applyAll(); syncBands(); ui.eqDirty = true;
  toast('已应用：' + name, 'ok');
}
function renderUserPresets() {
  var g = ui.panel && ui.panel.querySelector('#ss-user-grid'); if (!g) return;
  g.innerHTML = '';
  Object.keys(USER_PRESETS).forEach(function (name) {
    var r = el('div', 'ss-user-row');
    var b = el('button', 'ss-item', name); b.addEventListener('click', function (e) { e.preventDefault(); applyUserPreset(name); });
    var d = el('button', 'ss-del', '×'); d.addEventListener('click', function (e) { e.preventDefault(); delUserPreset(name); });
    r.appendChild(b); r.appendChild(d); g.appendChild(r);
  });
}

// ---------------- IR 导入 ----------------
function openIRPicker() {
  var inp = el('input'); inp.type = 'file'; inp.accept = '.wav,audio/wav'; inp.style.display = 'none'; document.body.appendChild(inp);
  inp.addEventListener('change', function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        ctx.decodeAudioData(fr.result.slice(0), function (buf) {
          CUSTOM_IR = buf; CUSTOM_IR_NAME = f.name; state.modules.reverb.ir = 'custom'; applyReverb();
          toast('已载入 IR：' + f.name, 'ok'); saveState();
        }, function () { toast('IR 解码失败，用 wav', 'off'); });
      } catch (e) { toast('IR 载入失败', 'off'); }
    };
    fr.readAsArrayBuffer(f); inp.remove();
  });
  inp.click();
}

// ---------------- EQ 拖点 ----------------
function bindEQDrag() {
  var drag = -1;
  function pt(e) { var r = ui.eqCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * ui.eqCanvas.width / r.width, y: (e.clientY - r.top) * ui.eqCanvas.height / r.height }; }
  ui.eqCanvas.addEventListener('pointerdown', function (e) {
    var q = pt(e), best = -1, bd = 26;
    state.modules.eq.bands.forEach(function (b, i) { var c = eqCanvasPos(b, i), d = Math.hypot(c.x - q.x, c.y - q.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; try { ui.eqCanvas.setPointerCapture(e.pointerId); } catch (er) {} }
  });
  ui.eqCanvas.addEventListener('pointermove', function (e) {
    if (drag < 0) return;
    var q = pt(e), W = ui.eqCanvas.width, H = ui.eqCanvas.height, b = state.modules.eq.bands[drag];
    b.freq = Math.round(clamp(20 * Math.pow(1000, q.x / W), 20, 20000));
    b.gain = +clamp((H / 2 - q.y) / (H / 2 - 10) * 15 - knobDbAt(b.freq), -15, 15).toFixed(1);
    applyEQ(); ui.eqDirty = true; drawEQCurve();
    var c = ui.bandCtl[drag];
    if (c) { c.gain.value = b.gain; c.gv.textContent = num(b.gain, 1) + 'dB'; c.freq.set(b.freq); }
  });
  ui.eqCanvas.addEventListener('pointerup', function () { if (drag >= 0) { drag = -1; toast('频段已更新'); } });
}
// 旋钮低架/高架在某个频率上的增益，用于曲线和圆点对齐
function knobDbAt(f) {
  var k = clamp(state.intensity, 0, 100) / 100, kn = state.knobs || {};
  return (clamp(kn.bass || 0, 0, 100) / 100 * 10 * k) / (1 + Math.pow(f / 88, 2))
    + (clamp(kn.air || 0, 0, 100) / 100 * 9 * k) / (1 + Math.pow(8500 / f, 2));
}
function eqCanvasPos(b, i) {
  var W = ui.eqCanvas.width, H = ui.eqCanvas.height;
  var f = clamp(b.freq || EQ_FREQS[i], 20, 20000);
  return { x: Math.log(f / 20) / Math.log(1000) * W, y: H / 2 - clamp((b.gain || 0) + knobDbAt(f), -15, 15) / 15 * (H / 2 - 10) };
}

﻿
// ---------------- A/B ----------------
function toggleAB() {
  if (state.ab) { state.modules = state.ab; state.ab = null; }
  else { state.ab = deepClone(state.modules); state.modules = defaultState().modules; }
  if (!Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
  state.smart = false; saveState(); applyAll();
  toast(state.ab ? 'B · 原音' : 'A · 我的调音', state.ab ? 'off' : 'ok');
}

// ---------------- 装配 ----------------
function isMainUI() {
  var h = (location.hash || '').toLowerCase();
  if (h.indexOf('lyrics') >= 0 || h.indexOf('/mv') >= 0 || h.indexOf('/video') >= 0) return false;
  if (!document.body) return false;
  if (document.querySelector('.lyrics-screen, .lyrics-content-wrapper')) return false;
  return true;
}
function ensureUI() {
  if (ui.panel && ui.panel.parentNode) return;   // 面板已建就不重复
  if (!isMainUI()) return;
  var host = document.querySelector('.extra-controls');
  if (host) {
    var btn = el('button', 'ss-toggle', '♪'); btn.id = 'ss-toggle'; btn.title = '声境音效 (Alt+Shift+P)';
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); });
    var ref = host.querySelector('.playback-speed');
    if (ref) host.insertBefore(btn, ref.nextSibling); else host.appendChild(btn);
    ui.btn = btn;
  }
  // 没有播放栏控件区（某些布局）就不放按钮，但面板照建，快捷键仍能打开

  ui.panel = buildPanel();
  document.body.appendChild(ui.panel);
  buildPresetSide(ui.side);
  buildHero(ui.hero);
  buildEQPage(page(ui.pages, 'eq'));
  buildDynPage(page(ui.pages, 'dyn'));
  buildSpacePage(page(ui.pages, 'space'));
  buildStereoPage(page(ui.pages, 'stereo'));
  buildIOPage(page(ui.pages, 'io'));
  buildLibPage(page(ui.pages, 'lib'));
  switchTab(state.tab === 'presets' ? 'eq' : (state.tab || 'eq'));
  syncBands(); renderUserPresets(); updateUI(); ui.eqDirty = true;
  // 任何调参动作自动开总开关，避免「关了以后调半天没反应」
  ['input', 'change', 'click'].forEach(function (ev) { ui.panel.addEventListener(ev, autoEnable, true); });
}

function togglePanel() {
  state.open = !state.open; saveState();
  if (ui.panel) ui.panel.classList.toggle('ss-hidden', !state.open);
  if (state.open) { fitPlayerGap(); startLoop(); } else { stopLoop(); }
  updateUI();
}

// 按宿主播放栏实际高度留出底部空间
function fitPlayerGap() {
  if (!ui.panel) return;
  try {
    var bar = document.querySelector('.player-container, #player-container');
    var h = bar ? Math.round(bar.getBoundingClientRect().height) : 88;
    ui.panel.style.bottom = Math.max(0, Math.min(200, h)) + 'px';
  } catch (e) { ui.panel.style.bottom = '88px'; }
}

function updateUI() {
  if (!ui.panel) return;
  var btns = ui.panel.querySelectorAll('.ss-item[data-id]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('ss-on', btns[i].getAttribute('data-id') === state.preset);
  var sb = ui.panel.querySelector('.ss-smart'); if (sb) sb.classList.toggle('ss-on', state.smart);
  renderSimple();
  if (ui.pw) { ui.pw.textContent = state.enabled ? '● 开' : '○ 关'; ui.pw.classList.toggle('ss-on', state.enabled); ui.pw.classList.toggle('ss-off', !state.enabled); }
  if (ui.btn) ui.btn.classList.toggle('ss-on', state.enabled);
  if (ui.status) {
    var nm = state.preset === 'smart' ? '智能调音' : (state.preset.indexOf('user:') === 0 ? state.preset.slice(5) : (state.preset === 'imported' ? '导入配置' : findPreset(state.preset).name));
    ui.status.textContent = (state.enabled ? '● 开启' : '○ 已关闭 · 调参自动开启') + ' · ' + nm + ' · 强度 ' + state.intensity + '%' + (state.smart ? ' · 智能' : '') + (state.ab ? ' · B' : '');
  }
}

// ---------------- 渲染循环（只在面板打开时跑） ----------------
var lastDiag = 0;
function startLoop() {
  if (ui.raf) return;
  var tick = function (t) {
    if (!state.open) { ui.raf = null; return; }
    sampleLevels();
    drawViz();
    if (ui.eqDirty && ui.tab === 'eq') drawEQCurve();
    if (t - lastDiag > 500) { lastDiag = t; updateDiag(); }
    ui.raf = requestAnimationFrame(tick);
  };
  ui.raf = requestAnimationFrame(tick);
  fitPlayerGap();
}
function stopLoop() { if (ui.raf) { cancelAnimationFrame(ui.raf); ui.raf = null; } }

// 空闲时预生成常用混响 IR，避免第一次切到某空间时卡一下
var IR_WARM = ['room', 'hall', 'stage', 'plate', 'church', 'spring'];
function warmIR(i) {
  i = i || 0;
  if (i >= IR_WARM.length) return;
  if (!ctx) { setTimeout(function () { warmIR(i); }, 400); return; }
  var k = IR_WARM[i], key = k + ':2';
  try { if (!irCache[key]) irCache[key] = makeIR(IR_DEFS[k], 2); } catch (e) {}
  setTimeout(function () { warmIR(i + 1); }, 160);
}

function drawViz() {
  if (!ui.cctx || !nodes) return;
  var c = ui.cctx, W = ui.canvas.width, H = ui.canvas.height;
  c.clearRect(0, 0, W, H);
  var spec = readSpectrum();
  if (spec) {
    var bars = 96, step = Math.max(1, Math.floor(spec.length / bars)), bw = W / bars;
    for (var x = 0; x < bars; x++) {
      var v = 0, cc = 0;
      for (var k = 0; k < step; k++) { var idx = x * step + k; if (idx < spec.length && spec[idx] > -100) { v += (spec[idx] + 100); cc++; } }
      var mag = cc ? (v / cc) / 100 : 0, h = Math.max(1, mag * H);
      var g = c.createLinearGradient(0, H - h, 0, H);
      g.addColorStop(0, 'rgba(94,234,212,.95)'); g.addColorStop(1, 'rgba(59,130,246,.35)');
      c.fillStyle = g; c.fillRect(x * bw + 0.5, H - h, bw - 1.2, h);
    }
  }
  if (ui.meterBar) ui.meterBar.style.width = Math.min(100, rms * 260).toFixed(0) + '%';
}

// RBJ cookbook 系数，用于把 EQ 曲线画准（Web Audio shelf 固定 S=1，Q 不参与）
function eqCoefs(b, fs) {
  var type = b.type || 'peaking';
  var f0 = clamp(b.freq || 1000, 10, fs * 0.49);
  var gainDb = b.gain || 0;
  var Q = clamp(b.q || 1, 0.1, 20);
  var A = Math.pow(10, gainDb / 40);
  var w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0);
  var alpha, b0, b1, b2, a0, a1, a2;
  if (type === 'lowshelf' || type === 'highshelf') {
    alpha = sw / 2 * Math.SQRT2;
    var sA = Math.sqrt(A);
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + 2 * sA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - 2 * sA * alpha);
      a0 = (A + 1) + (A - 1) * cw + 2 * sA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - 2 * sA * alpha;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + 2 * sA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - 2 * sA * alpha);
      a0 = (A + 1) - (A - 1) * cw + 2 * sA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - 2 * sA * alpha;
    }
  } else if (type === 'lowpass' || type === 'highpass') {
    alpha = sw / (2 * Q);
    if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    alpha = sw / (2 * Q);
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function coefMagDb(cf, f, fs) {
  var w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  var nr = cf.b0 + cf.b1 * c1 + cf.b2 * c2, ni = -(cf.b1 * s1 + cf.b2 * s2);
  var dr = 1 + cf.a1 * c1 + cf.a2 * c2, di = -(cf.a1 * s1 + cf.a2 * s2);
  var num = nr * nr + ni * ni, den = dr * dr + di * di;
  if (!(den > 1e-14)) return 0;
  return 10 * Math.log10(Math.max(1e-12, num / den));
}

function drawEQCurve() {
  if (!ui.eqc || !ui.eqCanvas) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands)) state.modules.eq = { bands: defaultBands() };
  var c = ui.eqc, W = ui.eqCanvas.width, H = ui.eqCanvas.height, mid = H / 2, amp = H / 2 - 10;
  c.clearRect(0, 0, W, H);
  // 网格
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
  for (var g = -10; g <= 10; g += 5) { var gy = mid - g / 15 * amp; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  for (var fx = 100; fx <= 10000; fx *= 10) { var gx = Math.log(fx / 20) / Math.log(1000) * W; c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
  // 曲线，用真实 biquad 幅频响应
  var bands = state.modules.eq.bands, k = clamp(state.intensity, 0, 100) / 100;
  var fs = (ctx && ctx.sampleRate) || 44100;
  var coefs = bands.map(function (b, i) {
    return eqCoefs({ type: b.type, freq: b.freq || EQ_FREQS[i], gain: (b.gain || 0) * k, q: b.q || 1 }, fs);
  });
  c.strokeStyle = '#5eead4'; c.lineWidth = 2.5; c.beginPath();
  for (var x = 0; x <= W; x += 2) {
    var f = 20 * Math.pow(1000, x / W), sum = 0;
    for (var i = 0; i < coefs.length; i++) sum += coefMagDb(coefs[i], f, fs);
    // 顶部旋钮的低架/高架也算进曲线，看到的和听到的一致
    sum += knobDbAt(f);
    var y = mid - clamp(sum, -16, 16) / 15 * amp;
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  // 圆点
  for (var j = 0; j < bands.length; j++) {
    var pt = eqCanvasPos(bands[j], j);
    c.beginPath(); c.arc(pt.x, pt.y, 6, 0, 6.2832);
    c.fillStyle = '#0f172a'; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = '#5eead4'; c.stroke();
  }
  ui.eqDirty = false;
}

function diagText() {
  return (claimed ? '已接管' : '等待播放') + ' · ' + (ctx ? ctx.state : '-') + ' · 链' + diag.chain +
    ' · ' + dbVal() + 'dB · ' + state.preset + (diag.err !== '-' ? ' · ' + diag.err : '');
}
function updateDiag() { if (ui.diag) ui.diag.textContent = diagText(); }
// ---------------- 调试句柄 ----------------
window.__ss = {
  diag: function () { return { installed: true, audio: claimed ? 'captured' : 'none', src: diag.src, ctx: ctx ? ctx.state : 'none',
    chain: diag.chain, rms: +rms.toFixed(4), peak: +peak.toFixed(4), preset: state.preset, intensity: state.intensity,
    enabled: state.enabled, smart: state.smart, ab: !!state.ab, tab: state.tab, err: diag.err, open: state.open,
    lastSmart: window.__ss_lastSmart || null }; },
  params: function () {
    if (!nodes) return null;
    return { eq: nodes.eq.map(function (f) { return +f.gain.value.toFixed(2); }), eqTypes: nodes.eq.map(function (f) { return f.type; }),
      excitationWet: +nodes.exciteWet.gain.value.toFixed(3),
      knobs: { bassDb: +nodes.knobBass.gain.value.toFixed(2), dynDb: +nodes.dynBass.gain.value.toFixed(2), airDb: +nodes.knobAir.gain.value.toFixed(2), contourDb: +nodes.contour.gain.value.toFixed(2), deessDb: +nodes.deess.gain.value.toFixed(2), trimDb: +(20 * Math.log10(nodes.knobTrim.gain.value)).toFixed(2), bass: state.knobs.bass, air: state.knobs.air },
      bassOn: +nodes.bassGain.gain.value.toFixed(3), exciteWet: +nodes.exciteWet.gain.value.toFixed(3),
      exciteType: state.modules.excite.type, air: +nodes.air.gain.value.toFixed(2),
      comp: { th: nodes.comp.threshold.value, ratio: nodes.comp.ratio.value },
      reverb: { wet: +nodes.revSend.gain.value.toFixed(3), ir: state.modules.reverb.ir },
      stereo: { width: state.modules.stereo.width, mid: +nodes.mid.gain.value.toFixed(3), side: +nodes.side.gain.value.toFixed(3) },
      crossfeed: { on: !!state.modules.crossfeed.on, preset: state.modules.crossfeed.preset, l: +nodes.xfGl.gain.value.toFixed(3), r: +nodes.xfGr.gain.value.toFixed(3) },
      input: +nodes.input.gain.value.toFixed(3), output: +nodes.output.gain.value.toFixed(3), vol: +nodes.vol.gain.value.toFixed(3) };
  },
  state: function () { return deepClone(state.modules); },
  apply: function (id) { applyPreset(id); return window.__ss.diag(); },
  set: function (mod, key, val) { if (!state.modules[mod]) return null; state.modules[mod][key] = val; applyAll(); return window.__ss.params(); },
  setEQ: function (i, obj) { if (!state.modules.eq.bands[i]) return null; for (var k in obj) state.modules.eq.bands[i][k] = obj[k]; applyEQ(); syncBands(); ui.eqDirty = true; drawEQCurve(); return window.__ss.params().eq; },
  setIntensity: function (v) { state.intensity = clamp(v, 0, 100) | 0; saveState(); applyEQ(); applyKnobs(); applyExcite(); ui.eqDirty = true; return window.__ss.params().eq; },
  setKnobs: function (b, a) { if (!state.knobs) state.knobs = { bass: 0, air: 0 }; state.knobs.bass = clamp(b || 0, 0, 100); state.knobs.air = clamp(a || 0, 0, 100); saveState(); applyKnobs(); renderSimple(); return window.__ss.params().knobs; },
  smart: function (on) { toggleSmart(on !== false); return window.__ss.diag(); },
  ab: function () { toggleAB(); return window.__ss.diag(); },
  enabled: function () { toggleEnabled(); return window.__ss.diag(); },
  open: function () { if (!state.open) togglePanel(); return window.__ss.diag(); },
  close: function () { if (state.open) togglePanel(); return window.__ss.diag(); },
  tab: function (k) { switchTab(k); return window.__ss.diag().tab; },
  exportCfg: function () { return JSON.stringify(currentConfig()); },
  importCfg: function (txt) { if (ui.codeBox) ui.codeBox.value = txt; importPreset(); return window.__ss.state(); },
  spectrum: function () { var s = readSpectrum(); return s ? Array.from(s) : null; },
  lufs: function () { return { on: !!state.modules.input.autoLoud, now: currentLufs(), autoDb: +autoDb.toFixed(2), gainDb: +(20 * Math.log10(nodes ? nodes.input.gain.value : 1)).toFixed(2) }; },
  kwRaw: function () {
    if (!nodes || !nodes.kwAn) return null;
    var b = nodes.kwBuf;
    try { nodes.kwAn.getFloatTimeDomainData(b); } catch (e) { return null; }
    var s = 0; for (var i = 0; i < b.length; i++) s += b[i] * b[i];
    return { kwRms: +Math.sqrt(s / b.length).toFixed(5), inGain: +nodes.input.gain.value.toFixed(3), kwMs: +kwMs.toExponential(3) };
  },
  lr: function (fA, fB) {
    if (!nodes || !nodes.lrAnL) return null;
    fA = fA || 200; fB = fB || 3000;
    try { nodes.lrAnL.getFloatFrequencyData(nodes.lrBufL); nodes.lrAnR.getFloatFrequencyData(nodes.lrBufR); }
    catch (e) { return null; }
    function pk(buf, f, an) { return +bandMaxDb(buf, f * 0.9, f * 1.1, an).toFixed(1); }
    return { L: { a: pk(nodes.lrBufL, fA, nodes.lrAnL), b: pk(nodes.lrBufL, fB, nodes.lrAnL) },
             R: { a: pk(nodes.lrBufR, fA, nodes.lrAnR), b: pk(nodes.lrBufR, fB, nodes.lrAnR) } };
  },
  presets: function () { return PRESETS.map(function (p) { return p.id + ':' + p.group + ':' + p.name; }); },
  userPresets: function () { return Object.keys(USER_PRESETS); },
  saveUserPreset: function (n) { saveUserPreset(n); return Object.keys(USER_PRESETS); },
  applyUserPreset: function (n) { applyUserPreset(n); return window.__ss.diag(); },
  // 调试/性能分析用（只暴露函数引用，不改状态）
  _fn: { applyPreset: function (id) { applyPreset(id); }, applyEQ: function () { applyEQ(); }, applyBass: function () { applyBass(); },
    applyExcite: function () { applyExcite(); }, applyKnobs: function () { applyKnobs(); }, applyComp: function () { applyComp(); }, applyReverb: function () { applyReverb(); },
    applyStereo: function () { applyStereo(); }, applyCrossfeed: function () { applyCrossfeed(); }, updateUI: function () { updateUI(); }, syncBands: function () { syncBands(); },
    renderSimple: function () { renderSimple(); }, makeIR: function (ir, s) { return makeIR(IR_DEFS[ir] || IR_DEFS.room, s); },
    bassCurve: function (a) { return bassCurve(a); }, makeCurve: function (k, d) { return makeCurve(k, d); } }
};

// ---------------- 启动 ----------------
bindShortcuts();
if (document.body) ensureUI();
else document.addEventListener('DOMContentLoaded', function () { ensureUI(); });
setTimeout(function () { warmIR(0); }, 800);
var _iv = setInterval(function () {
  if (!document.body) return;
  if (isMainUI() && !ui.panel) ensureUI();
  if (ui.panel) clearInterval(_iv);
}, 400);
window.addEventListener('hashchange', function () {
  if (!isMainUI()) { if (state.open) { state.open = false; saveState(); if (ui.panel) ui.panel.classList.add('ss-hidden'); stopLoop(); } }
  else if (!ui.panel) ensureUI();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) { e.preventDefault(); togglePanel(); } }, true);
window.addEventListener('resize', function () { if (state.open) fitPlayerGap(); });
if (console && console.log) console.log(LOG + ' SonicScape 已加载');
})();

