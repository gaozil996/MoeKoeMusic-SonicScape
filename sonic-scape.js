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
  // 低音谐波增强：前置增益顶进曲线 -> 强非线性 -> 高通留谐波 -> 混合（HP 转角下调让 2 次谐波能过）
  N.bassSum = ctx.createGain();
  N.bassLP = ctx.createBiquadFilter(); N.bassLP.type = 'lowpass'; N.bassLP.frequency.value = 110;
  N.bassDrive = ctx.createGain(); N.bassDrive.gain.value = 4;
  N.bassWS = ctx.createWaveShaper(); N.bassWS.curve = bassCurve(0.6); N.bassWS.oversample = '4x';
  N.bassHP = ctx.createBiquadFilter(); N.bassHP.type = 'highpass'; N.bassHP.frequency.value = 130;
  N.bassGain = ctx.createGain(); N.bassGain.gain.value = 0;
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
  N.air = ctx.createBiquadFilter(); N.air.type = 'highshelf'; N.air.frequency.value = 9000; N.air.gain.value = 0;
  // 旋钮音色层：低频架 / 高频架 + 等响补偿。干净增益，不做失真，低音和亮度互不掩蔽
  N.knobHP = ctx.createBiquadFilter(); N.knobHP.type = 'highpass'; N.knobHP.frequency.value = 28; N.knobHP.Q.value = 0.6;
  N.knobBass = ctx.createBiquadFilter(); N.knobBass.type = 'lowshelf'; N.knobBass.frequency.value = 88; N.knobBass.Q.value = 0.7; N.knobBass.gain.value = 0;
  N.knobAir = ctx.createBiquadFilter(); N.knobAir.type = 'highshelf'; N.knobAir.frequency.value = 8500; N.knobAir.Q.value = 0.7; N.knobAir.gain.value = 0;
  N.knobTrim = ctx.createGain(); N.knobTrim.gain.value = 1;
  // 动态：compPre 把信号顶进压缩阈值，comp 后 makeup 补偿（不再是抬峰值）
  N.compPre = ctx.createGain(); N.compPre.gain.value = 1;
  N.comp = ctx.createDynamicsCompressor();
  N.comp.knee.value = 4; N.comp.attack.value = 0.003; N.comp.release.value = 0.18;
  N.makeup = ctx.createGain();
  N.limiter = ctx.createDynamicsCompressor();
  N.limiter.threshold.value = -1; N.limiter.knee.value = 0; N.limiter.ratio.value = 20;
  N.limiter.attack.value = 0.003; N.limiter.release.value = 0.25;
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
  // 输出：output=手动增益, vol=系统音量, enabled=总开关旁路
  N.output = ctx.createGain();
  N.vol = ctx.createGain();
  N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 2048; N.analyser.smoothingTimeConstant = 0.8;

  // ---- 连线 ----
  N.input.connect(N.bassSum);
  N.input.connect(N.bassLP); N.bassLP.connect(N.bassDrive); N.bassDrive.connect(N.bassWS);
  N.bassWS.connect(N.bassHP); N.bassHP.connect(N.bassGain); N.bassGain.connect(N.bassSum);
  N.bassSum.connect(N.eq[0]);
  for (i = 0; i < N.eq.length - 1; i++) N.eq[i].connect(N.eq[i + 1]);
  var eqEnd = N.eq[N.eq.length - 1];
  // 激励：eq -> 干路(1-w) 与 饱和湿路(w) 互补汇入 exciteSum
  // 旋钮层接在 10 段 EQ 之后：次声清理 -> 低架 -> 高架 -> 补偿
  eqEnd.connect(N.knobHP); N.knobHP.connect(N.knobBass); N.knobBass.connect(N.knobAir); N.knobAir.connect(N.knobTrim);
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
  // 输出
  N.outMerge.connect(N.output); N.output.connect(N.vol); N.vol.connect(N.limiter);
  N.limiter.connect(N.analyser); N.analyser.connect(ctx.destination);

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
function applyInput() {
  if (!nodes) return;
  var m = state.modules.input;
  var g = clamp(m.gain || 0, -24, 24);
  var extra = (m.autoLoud && typeof m.autoGainDb === 'number') ? clamp(m.autoGainDb, -12, 12) : 0;
  try { nodes.input.gain.value = dbToGain(g + extra); } catch (e) {}
}
function applyBass() {
  if (!nodes) return;
  var m = state.modules.bass, amt = clamp(m.amount || 0, 0, 1);
  try {
    nodes.bassLP.frequency.value = clamp(m.freq || 90, 40, 220);
    nodes.bassHP.frequency.value = clamp((m.freq || 90) * 1.5, 90, 400);
    nodes.bassDrive.gain.value = 3 + amt * 5;                 // 顶进曲线弯曲区
    nodes.bassWS.curve = bassCurve(amt);                      // 谐波量真正改曲线
    nodes.bassGain.gain.value = m.on ? (0.35 + amt * 0.9) : 0; // 谐波混合量，明显可闻
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
  applyInput(); applyBass(); applyEQ(); applyKnobs(); applyExcite(); applyComp(); applyReverb(); applyStereo(); applyOutput();
  applyEnabled(); syncVolume();
  updateUI(); if (typeof syncBands === 'function') syncBands(); ui.eqDirty = true;
}

// 顶部旋钮：低音走低架、亮度走高架，都是干净增益，各自独立不互相掩蔽
function applyKnobs() {
  if (!nodes || !nodes.knobBass) return;
  var k = clamp(state.intensity, 0, 100) / 100;
  var kn = state.knobs || { bass: 0, air: 0 };
  var bassDb = clamp(kn.bass || 0, 0, 100) / 100 * 10 * k;   // 0..+10dB @88Hz 低架
  var airDb = clamp(kn.air || 0, 0, 100) / 100 * 9 * k;      // 0..+9dB @8.5kHz 高架
  try {
    nodes.knobBass.gain.value = bassDb;
    nodes.knobAir.gain.value = airDb;
    // 等响补偿：提升多的部分预先让出余量，限幅器不猛压，整体音量不跳
    var trimDb = -(bassDb * 0.20 + airDb * 0.12);
    nodes.knobTrim.gain.value = Math.pow(10, trimDb / 20);
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
  raf: null, tab: 'eq', knobs: null, bandCtl: [], built: false, eqDirty: true, vizOn: false };

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
    rng.title = k === 'bass' ? '低频架 88Hz，最多 +10dB，干净提升不碰中高频'
      : k === 'air' ? '高频架 8.5kHz，最多 +9dB，不碰中低频'
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
  // 只建一次，后续只更新数值
  ui.bandCtl = [];
  state.modules.eq.bands.forEach(function (b, i) {
    var line = el('div', 'ss-band');
    var name = el('span', 'ss-band-n', EQ_FREQS[i] >= 1000 ? (EQ_FREQS[i] / 1000) + 'k' : EQ_FREQS[i]);
    var gs = el('input', 'ss-rng'); gs.type = 'range'; gs.min = -15; gs.max = 15; gs.step = 0.5; gs.value = b.gain;
    var gv = el('span', 'ss-val', num(b.gain, 1) + 'dB');
    gs.addEventListener('input', function () {
      b.gain = parseFloat(gs.value); gv.textContent = num(b.gain, 1) + 'dB';
      applyEQ(); ui.eqDirty = true;
    });
    gs.addEventListener('dblclick', function () { b.gain = 0; gs.value = 0; gv.textContent = '0.0dB'; applyEQ(); ui.eqDirty = true; });
    var more = el('button', 'ss-band-more', '⋯'); more.title = '类型/频率/Q';
    var detail = el('div', 'ss-band-detail'); detail.style.display = 'none';
    var typeSel = select([
      { value: 'peaking', label: '峰值' }, { value: 'lowshelf', label: '低架' }, { value: 'highshelf', label: '高架' },
      { value: 'lowpass', label: '低通' }, { value: 'highpass', label: '高通' }
    ], b.type, function (v) { b.type = v; applyEQ(); ui.eqDirty = true; });
    var fSl = slider(20, 20000, 1, b.freq, function (v) { b.freq = v; applyEQ(); ui.eqDirty = true; },
      function (x) { return x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x); });
    var qSl = slider(0.1, 10, 0.1, b.q, function (v) { b.q = v; applyEQ(); ui.eqDirty = true; }, function (x) { return num(x, 1); });
    detail.appendChild(row('类型', typeSel));
    detail.appendChild(row('频率', fSl.s, fSl.v));
    detail.appendChild(row('Q', qSl.s, qSl.v));
    more.addEventListener('click', function (e) {
      e.preventDefault(); var open = detail.style.display !== 'block';
      detail.style.display = open ? 'block' : 'none'; more.classList.toggle('ss-on', open);
    });
    line.appendChild(name); line.appendChild(gs); line.appendChild(gv); line.appendChild(more);
    box.appendChild(line); box.appendChild(detail);
    ui.bandCtl.push({ gain: gs, gv: gv, typeSel: typeSel, freq: fSl, q: qSl, band: b });
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

﻿
// ---------------- 动态 / 混响 / 声场 / IO / 生态 ----------------
function buildDynPage(p) {
  var g1 = group('激励 / 饱和'); p.appendChild(g1);
  var m = state.modules.excite;
  g1.appendChild(row('类型', select([
    { value: 'off', label: '关闭' }, { value: 'tube', label: '电子管' }, { value: 'tape', label: '磁带' }, { value: 'soft', label: '柔和' }
  ], m.type, function (v) { m.type = v; applyExcite(); })));
  var d = slider(0, 1, 0.05, m.drive, function (v) { m.drive = v; applyExcite(); }, function (x) { return num(x, 1); });
  var a = slider(0, 12, 0.5, m.air, function (v) { m.air = v; applyExcite(); }, function (x) { return num(x, 1); });
  g1.appendChild(row('驱动', d.s, d.v)); g1.appendChild(row('空气感', a.s, a.v));

  var g2 = group('压缩器'); p.appendChild(g2);
  var c = state.modules.comp;
  var cw = el('div', 'ss-cols');
  [['阈值dB', 'th', -60, 0, 1, 0], ['拐点', 'knee', 0, 40, 1, 0], ['比率', 'ratio', 1, 20, 0.5, 0],
   ['启动s', 'at', 0, 1, 0.005, 2], ['释放s', 'rel', 0, 1, 0.01, 2], ['补偿dB', 'makeup', -12, 12, 0.5, 1]].forEach(function (cfg) {
    var s = slider(cfg[2], cfg[3], cfg[4], c[cfg[1]], function (v) { c[cfg[1]] = v; applyComp(); }, function (x) { return num(x, cfg[5]); });
    cw.appendChild(row(cfg[0], s.s, s.v));
  });
  g2.appendChild(cw);
  var lc = check('真峰限幅', c.limiter, function (v) { c.limiter = v; applyComp(); });
  g2.appendChild(lc.wrap);
  var ce = slider(-12, 0, 0.5, c.ceiling == null ? -1 : c.ceiling, function (v) { c.ceiling = v; applyComp(); }, function (x) { return num(x, 1) + 'dB'; });
  g2.appendChild(row('限幅顶', ce.s, ce.v));
}

function buildSpacePage(p) {
  var g = group('卷积混响'); p.appendChild(g);
  var m = state.modules.reverb;
  var opts = Object.keys(IR_DEFS).map(function (k) { return { value: k, label: IR_DEFS[k].label }; });
  opts.push({ value: 'custom', label: '自定义 IR…' });
  g.appendChild(row('空间', select(opts, m.ir, function (v) {
    m.ir = v; if (v === 'custom' && !CUSTOM_IR) openIRPicker(); applyReverb();
    toast('混响：' + (IR_DEFS[v] ? IR_DEFS[v].label : '自定义'));
  })));
  var w = slider(0, 1, 0.01, m.wet, function (v) { m.wet = v; applyReverb(); }, function (x) { return Math.round(x * 100) + '%'; });
  var pd = slider(0, 200, 1, m.predelay, function (v) { m.predelay = v; applyReverb(); }, function (x) { return Math.round(x) + 'ms'; });
  var sz = slider(0.5, 4, 0.1, m.size, function (v) { m.size = v; applyReverb(); }, function (x) { return num(x, 1); });
  g.appendChild(row('湿度', w.s, w.v)); g.appendChild(row('预延时', pd.s, pd.v)); g.appendChild(row('尺寸', sz.s, sz.v));
  var imp = el('button', 'ss-btn', '导入自定义 IR (.wav)');
  imp.addEventListener('click', function (e) { e.preventDefault(); openIRPicker(); });
  g.appendChild(imp);
  g.appendChild(el('p', 'ss-hint', CUSTOM_IR ? ('已载入：' + CUSTOM_IR_NAME) : '可选单/双声道 wav 作为脉冲响应'));
}

function buildStereoPage(p) {
  var g = group('立体声场 / 中侧'); p.appendChild(g);
  var m = state.modules.stereo;
  var w = slider(-1, 1, 0.05, m.width, function (v) { m.width = v; applyStereo(); }, function (x) { return Math.round((x + 1) / 2 * 100); });
  var mid = slider(-12, 12, 0.5, m.mid, function (v) { m.mid = v; applyStereo(); }, function (x) { return num(x, 1) + 'dB'; });
  var side = slider(-12, 12, 0.5, m.side, function (v) { m.side = v; applyStereo(); }, function (x) { return num(x, 1) + 'dB'; });
  var lc = slider(0, 1000, 10, m.sideLowcut, function (v) { m.sideLowcut = v; applyStereo(); }, function (x) { return x > 0 ? Math.round(x) + 'Hz' : '关'; });
  g.appendChild(row('宽度', w.s, w.v)); g.appendChild(row('中央M', mid.s, mid.v));
  g.appendChild(row('侧向S', side.s, side.v)); g.appendChild(row('侧向低切', lc.s, lc.v));

  var g2 = group('低音谐波增强（进阶）'); p.appendChild(g2);
  g2.appendChild(el('p', 'ss-hint', '给超低音补谐波，让手机小喇叭也听得到低频。会产生额外谐波，默认关闭；平时用顶部「低音」旋钮就够，那个是干净的。'));
  var bm = state.modules.bass;
  var on = check('开启', bm.on, function (v) { bm.on = v; applyBass(); });
  g2.appendChild(on.wrap);
  var f = slider(30, 250, 5, bm.freq, function (v) { bm.freq = v; applyBass(); }, function (x) { return Math.round(x) + 'Hz'; });
  var am = slider(0, 1, 0.05, bm.amount, function (v) { bm.amount = v; applyBass(); }, function (x) { return num(x, 1); });
  g2.appendChild(row('中心频率', f.s, f.v)); g2.appendChild(row('谐波量', am.s, am.v));
}

function buildIOPage(p) {
  var g = group('输入'); p.appendChild(g);
  var m = state.modules.input;
  var c = check('响度自动匹配（配合智能）', m.autoLoud, function (v) { m.autoLoud = v; if (!v) m.autoGainDb = 0; applyInput(); });
  g.appendChild(c.wrap);
  var ig = slider(-24, 24, 0.5, m.gain, function (v) { m.gain = v; applyInput(); }, function (x) { return num(x, 1) + 'dB'; });
  g.appendChild(row('输入增益', ig.s, ig.v));

  var g2 = group('输出'); p.appendChild(g2);
  var om = state.modules.output;
  var og = slider(-24, 12, 0.5, om.gain, function (v) { om.gain = v; applyOutput(); }, function (x) { return num(x, 1) + 'dB'; });
  g2.appendChild(row('输出增益', og.s, og.v));
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

function drawEQCurve() {
  if (!ui.eqc || !ui.eqCanvas) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands)) state.modules.eq = { bands: defaultBands() };
  var c = ui.eqc, W = ui.eqCanvas.width, H = ui.eqCanvas.height, mid = H / 2, amp = H / 2 - 10;
  c.clearRect(0, 0, W, H);
  // 网格
  c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
  for (var g = -10; g <= 10; g += 5) { var gy = mid - g / 15 * amp; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  for (var fx = 100; fx <= 10000; fx *= 10) { var gx = Math.log(fx / 20) / Math.log(1000) * W; c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
  // 曲线
  var bands = state.modules.eq.bands, k = clamp(state.intensity, 0, 100) / 100;
  c.strokeStyle = '#5eead4'; c.lineWidth = 2.5; c.beginPath();
  for (var x = 0; x <= W; x += 2) {
    var f = 20 * Math.pow(1000, x / W), sum = 0;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i], gain = (b.gain || 0) * k, cf = clamp(b.freq || EQ_FREQS[i], 20, 20000), q = clamp(b.q || 1, 0.1, 10), type = b.type || 'peaking', contrib;
      if (type === 'lowshelf') contrib = gain / (1 + Math.pow(f / cf, 2));
      else if (type === 'highshelf') contrib = gain / (1 + Math.pow(cf / f, 2));
      else if (type === 'lowpass') contrib = -15 / (1 + Math.pow(f / cf, -4));
      else if (type === 'highpass') contrib = -15 / (1 + Math.pow(f / cf, 4));
      else { var ratio = Math.log(f / cf) / Math.LN2; contrib = gain * Math.exp(-(ratio * ratio) / (2 * q * q * 0.32)); }
      sum += contrib;
    }
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
      knobs: { bassDb: +nodes.knobBass.gain.value.toFixed(2), airDb: +nodes.knobAir.gain.value.toFixed(2), trimDb: +(20 * Math.log10(nodes.knobTrim.gain.value)).toFixed(2), bass: state.knobs.bass, air: state.knobs.air },
      bassOn: +nodes.bassGain.gain.value.toFixed(3), exciteWet: +nodes.exciteWet.gain.value.toFixed(3),
      exciteType: state.modules.excite.type, air: +nodes.air.gain.value.toFixed(2),
      comp: { th: nodes.comp.threshold.value, ratio: nodes.comp.ratio.value },
      reverb: { wet: +nodes.revSend.gain.value.toFixed(3), ir: state.modules.reverb.ir },
      stereo: { width: state.modules.stereo.width, mid: +nodes.mid.gain.value.toFixed(3), side: +nodes.side.gain.value.toFixed(3) },
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
  presets: function () { return PRESETS.map(function (p) { return p.id + ':' + p.group + ':' + p.name; }); },
  userPresets: function () { return Object.keys(USER_PRESETS); },
  saveUserPreset: function (n) { saveUserPreset(n); return Object.keys(USER_PRESETS); },
  applyUserPreset: function (n) { applyUserPreset(n); return window.__ss.diag(); },
  // 调试/性能分析用（只暴露函数引用，不改状态）
  _fn: { applyPreset: function (id) { applyPreset(id); }, applyEQ: function () { applyEQ(); }, applyBass: function () { applyBass(); },
    applyExcite: function () { applyExcite(); }, applyKnobs: function () { applyKnobs(); }, applyComp: function () { applyComp(); }, applyReverb: function () { applyReverb(); },
    applyStereo: function () { applyStereo(); }, updateUI: function () { updateUI(); }, syncBands: function () { syncBands(); },
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

