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
    tab: 'presets',
    ab: null,
    modules: {
      input:  { autoLoud: false, gain: 0 },
      bass:   { on: false, freq: 90, amount: 0.6 },
      eq:     { bands: defaultBands() },
      excite: { type: 'off', drive: 0.4, air: 0 },
      comp:   { th: -24, knee: 8, ratio: 4, at: 0.008, rel: 0.2, makeup: 2, limiter: true, ceiling: -1 },
      reverb: { ir: 'none', wet: 0.2, predelay: 20, size: 2.0 },
      stereo: { width: 0, mid: 0, side: 0, sideLowcut: 0 },
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
    state.tab = (typeof o.tab === 'string') ? o.tab : 'presets';
    state.smart = !!o.smart;
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
function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
function loadUserPresets() { try { var r = localStorage.getItem(STORE_PRESETS); if (r) return JSON.parse(r); } catch (e) {} return {}; }
function saveUserPresets(o) { try { localStorage.setItem(STORE_PRESETS, JSON.stringify(o)); } catch (e) {} }

var IR_DEFS = {
  none:   { label: '关闭', decay: 0, pre: 0, len: 0.05 },
  room:   { label: '小房间', decay: 1.8, pre: 0.006, len: 0.45 },
  hall:   { label: '音乐厅', decay: 2.6, pre: 0.012, len: 2.4 },
  stage:  { label: '舞台', decay: 2.4, pre: 0.010, len: 2.0 },
  plate:  { label: '钢板', decay: 3.0, pre: 0.004, len: 1.6 },
  church: { label: '教堂', decay: 3.2, pre: 0.020, len: 3.2 },
  spring: { label: '弹簧', decay: 2.0, pre: 0.003, len: 0.9 }
};

// ---------------- 预设库（10 段语义化，名字与效果一致） ----------------
function P(o) { return o; }
var PRESETS = [
  // 经典音效
  P({ id: 'c_3d', name: '3D丽音', group: '经典音效', modules: {
    eq: EQ([2, 2, 1, 0, -1, 0, 1, 2, 3, 2]), stereo: { width: 0.35 }, reverb: { ir: 'stage', wet: 0.28 } } }),
  P({ id: 'c_bass', name: '超重低音', group: '经典音效', modules: {
    eq: EQ([9, 8, 5, 1, -2, -2, -1, 0, 1, 1]), bass: { on: true, freq: 70, amount: 0.7 }, comp: { th: -20, ratio: 4, makeup: 1 } } }),
  P({ id: 'c_vocal', name: '纯净人声', group: '经典音效', modules: {
    eq: EQ([-5, -4, -2, 0, 1, 3, 5, 4, 2, 0]), excite: { type: 'tube', drive: 0.25, air: 3 }, stereo: { mid: 2 }, reverb: { ir: 'room', wet: 0.06 } } }),
  P({ id: 'c_hifi', name: 'HiFi现场', group: '经典音效', modules: {
    eq: EQ([3, 2, 1, 0, 0, 1, 2, 2, 2, 1]), reverb: { ir: 'hall', wet: 0.32 }, stereo: { width: 0.25 } } }),

  // 流派
  P({ id: 'g_pop', name: '流行', group: '流派', modules: { eq: EQ([4, 3, 1, 0, 0, 1, 2, 2, 2, 1]), comp: { th: -22, ratio: 3, makeup: 1 } } }),
  P({ id: 'g_rock', name: '摇滚', group: '流派', modules: { eq: EQ([6, 4, 1, -1, 0, 1, 3, 3, 2, 1]), bass: { on: true, freq: 75, amount: 0.5 }, comp: { th: -18, ratio: 4, makeup: 1 } } }),
  P({ id: 'g_elec', name: '电子', group: '流派', modules: { eq: EQ([8, 6, 2, -2, -3, -1, 1, 3, 4, 3]), bass: { on: true, freq: 60, amount: 0.45 }, reverb: { ir: 'plate', wet: 0.1 } } }),
  P({ id: 'g_jazz', name: '爵士', group: '流派', modules: { eq: EQ([2, 1, 0, 0, 1, 1, 1, 1, 1, 0]), excite: { type: 'tape', drive: 0.25 } } }),
  P({ id: 'g_class', name: '古典', group: '流派', modules: { eq: EQ([-2, -1, 0, 0, 0, 0, 1, 1, 2, 2]), comp: { th: -28, ratio: 2, makeup: 0 }, reverb: { ir: 'hall', wet: 0.2 } } }),
  P({ id: 'g_hiphop', name: '嘻哈', group: '流派', modules: { eq: EQ([9, 7, 3, 0, -1, -1, 0, 1, 2, 1]), bass: { on: true, freq: 60, amount: 0.8 }, comp: { th: -16, ratio: 5, makeup: 1 } } }),
  P({ id: 'g_metal', name: '金属', group: '流派', modules: { eq: EQ([6, 3, -1, 1, 3, 0, -2, 3, 4, 2]), comp: { th: -16, ratio: 4, makeup: 1 }, excite: { type: 'tube', drive: 0.3 } } }),
  P({ id: 'g_vocal', name: '清唱人声', group: '流派', modules: { eq: EQ([-3, -2, -1, 0, 2, 3, 4, 3, 1, 0]), stereo: { mid: 3 }, reverb: { ir: 'plate', wet: 0.12 } } }),
  P({ id: 'g_lofi', name: 'Lo-Fi', group: '流派', modules: { eq: EQ([3, 2, 1, 1, 0, -1, -2, -4, -6, -8]), excite: { type: 'tape', drive: 0.4 }, reverb: { ir: 'room', wet: 0.1 } } }),
  P({ id: 'g_anime', name: '二次元', group: '流派', modules: { eq: EQ([2, 1, 0, 0, 1, 2, 3, 3, 4, 4]), excite: { type: 'soft', drive: 0.3, air: 4 }, reverb: { ir: 'hall', wet: 0.22 } } }),

  // 设备
  P({ id: 'h_earbud', name: '半入耳耳机', group: '设备', modules: { eq: EQ([6, 4, 2, 1, 0, 0, 1, 2, 3, 4]), bass: { on: true, freq: 80, amount: 0.5 }, excite: { type: 'soft', drive: 0.2, air: 5 } } }),
  P({ id: 'h_over', name: '头戴开放式', group: '设备', modules: { eq: EQ([1, 1, 0, 0, 0, 0, 0, 1, 1, 1]), stereo: { width: 0.15 } } }),
  P({ id: 'h_inear', name: '入耳监听', group: '设备', modules: { eq: EQ([-1, -1, 0, 0, 0, 0, 0, -1, -1, -2]), comp: { th: -20, ratio: 2.5, makeup: 0 } } }),
  P({ id: 'h_speaker', name: '小音箱外放', group: '设备', modules: { eq: EQ([6, 5, 3, 1, 0, 0, 1, 2, 3, 3]), bass: { on: true, freq: 90, amount: 0.6 }, stereo: { sideLowcut: 150 } } }),
  P({ id: 'h_car', name: '车载', group: '设备', modules: { eq: EQ([6, 4, 2, 0, 0, 1, 1, 2, 2, 1]), bass: { on: true, freq: 65, amount: 0.7 }, reverb: { ir: 'stage', wet: 0.3 }, stereo: { width: 0.4 } } }),

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

  P({ id: 'off', name: '关闭(原音)', group: '基础', modules: {} })
];
var GROUPS = ['基础', '经典音效', '流派', '设备', '场景', '监听'];
function findPreset(id) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
  return PRESETS[PRESETS.length - 1];
}
loadState();
var USER_PRESETS = loadUserPresets();
var CUSTOM_IR = null, CUSTOM_IR_NAME = '';


// ---------------- 运行时 ----------------
var ctx = null, nodes = null, claimed = null, srcNode = null;
var rms = 0, peak = 0, rmsBuf = null, freqBuf = null;
var claimedPlayed = false;
var diag = { chain: '-', src: '-', err: '-' };
var smartAccum = null, smartFrames = 0, smartTimer = null;
var lastIRKey = '';

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
function makeIR(def, size) {
  var rate = ctx.sampleRate;
  var len = Math.max(1, Math.floor(rate * Math.min(4.0, def.len * (size / 2.0))));
  var buf = ctx.createBuffer(2, len, rate);
  var pre = Math.floor(rate * def.pre);
  for (var ch = 0; ch < 2; ch++) {
    var d = buf.getChannelData(ch);
    for (var i = 0; i < len; i++) {
      if (i < pre) { d[i] = 0; continue; }
      var t = (i - pre) / (len - pre);
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, def.decay) * 0.5;
    }
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
  // 动态
  N.comp = ctx.createDynamicsCompressor();
  N.makeup = ctx.createGain();
  N.limiter = ctx.createDynamicsCompressor();
  N.limiter.threshold.value = -1; N.limiter.knee.value = 0; N.limiter.ratio.value = 20;
  N.limiter.attack.value = 0.003; N.limiter.release.value = 0.25;
  // 混响
  N.revSend = ctx.createGain(); N.revSend.gain.value = 0;
  N.predelay = ctx.createDelay(1.0); N.predelay.delayTime.value = 0.02;
  N.conv = ctx.createConvolver(); N.conv.normalize = true;
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
  eqEnd.connect(N.exciteDry); N.exciteDry.connect(N.exciteSum);
  eqEnd.connect(N.exciteDrive); N.exciteDrive.connect(N.exciteWS); N.exciteWS.connect(N.exciteWet); N.exciteWet.connect(N.exciteSum);
  N.exciteSum.connect(N.air); N.air.connect(N.comp); N.comp.connect(N.makeup);
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
  lastIRKey = 'room:2'; N.conv.buffer = makeIR(IR_DEFS.room, 2.0);
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
    nodes.comp.knee.value = clamp(m.knee != null ? m.knee : 8, 0, 40);
    nodes.comp.ratio.value = clamp(m.ratio != null ? m.ratio : 4, 1, 20);
    nodes.comp.attack.value = clamp(m.at != null ? m.at : 0.008, 0, 1);
    nodes.comp.release.value = clamp(m.rel != null ? m.rel : 0.2, 0, 1);
    nodes.makeup.gain.value = dbToGain(clamp(m.makeup || 0, -12, 12));
    nodes.limiter.threshold.value = m.limiter ? clamp(m.ceiling != null ? m.ceiling : -1, -12, 0) : 0;
    nodes.limiter.ratio.value = m.limiter ? 20 : 1;
  } catch (e) {}
}
function applyReverb() {
  if (!nodes) return;
  var m = state.modules.reverb;
  try {
    nodes.revSend.gain.value = (m.ir === 'none') ? 0 : clamp(m.wet != null ? m.wet : 0.2, 0, 1);
    nodes.predelay.delayTime.value = clamp((m.predelay || 0) / 1000, 0, 0.5);
    var key = (m.ir || 'none') + ':' + (m.size || 2).toFixed(1) + ':' + (CUSTOM_IR ? CUSTOM_IR_NAME : '');
    if (key !== lastIRKey) {                                 // 只在 IR/尺寸变化时重建，拖湿度不爆音
      if (m.ir === 'custom' && CUSTOM_IR) nodes.conv.buffer = CUSTOM_IR;
      else if (m.ir !== 'none') nodes.conv.buffer = makeIR(IR_DEFS[m.ir] || IR_DEFS.room, clamp(m.size || 2, 0.5, 4));
      lastIRKey = key;
    }
  } catch (e) {}
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
function applyEnabled() {
  if (!nodes || !claimed) return;
  // 总开关：关 = 用一条从 input 直通 destination 的旁路，绕过整条 DSP 链
  var on = state.enabled;
  try {
    if (on) {
      if (nodes.bypass) { srcNode.disconnect(nodes.bypass); nodes.bypass.disconnect(); nodes.bypass = null; }
      srcNode.connect(nodes.input);
    } else {
      srcNode.disconnect();
      if (!nodes.bypass) { nodes.bypass = ctx.createGain(); nodes.bypass.gain.value = 1; nodes.bypass.connect(ctx.destination); }
      srcNode.connect(nodes.bypass);
    }
  } catch (e) {}
}
function applyAll() {
  applyInput(); applyBass(); applyEQ(); applyExcite(); applyComp(); applyReverb(); applyStereo(); applyOutput();
  applyEnabled(); syncVolume();
  updateUI(); renderBands(); drawEQCurve();
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
  state.enabled = true;
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
function diagTick() {
  if (nodes && nodes.analyser) {
    try {
      nodes.analyser.getFloatTimeDomainData(rmsBuf);
      var s = 0, p = 0;
      for (var i = 0; i < rmsBuf.length; i++) { s += rmsBuf[i] * rmsBuf[i]; var av = Math.abs(rmsBuf[i]); if (av > p) p = av; }
      rms = Math.sqrt(s / rmsBuf.length); peak = p;
    } catch (e) { rms = 0; peak = 0; }
  }
  updateDiag(); drawViz();
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
  state.modules.excite = { type: bH < -0.15 ? 'soft' : 'off', drive: 0.3, air: bH < -0.15 ? clamp(-bH * 6, 0, 6) : 0 };
  state.modules.stereo.width = clamp((bL + bH) * 0.15, -0.2, 0.35);
  state.modules.bass.on = bL < -0.2; state.modules.bass.amount = clamp(-bL * 0.6, 0, 0.6);
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
function toggleEnabled() {
  state.enabled = !state.enabled;
  applyEnabled(); saveState(); updateUI();
  toast(state.enabled ? '音效已开启' : '音效已关闭 · 原音', state.enabled ? 'ok' : 'off');
}
function bindShortcuts() {
  // Alt+Shift+S 开关总音效，Alt+Shift+P 开面板，Alt+Shift+M 智能
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || !e.shiftKey) return;
    var k = (e.key || '').toUpperCase();
    if (k === 'S') { e.preventDefault(); toggleEnabled(); }
    else if (k === 'P') { e.preventDefault(); togglePanel(); }
    else if (k === 'M') { e.preventDefault(); toggleSmart(!state.smart); }
  }, true);
}


// ---------------- UI ----------------
var ui = { btn: null, panel: null, fab: null, diag: null, canvas: null, cctx: null, eqCanvas: null, eqc: null, timer: null, tab: 'presets' };
function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function num(v, d) { return (+v).toFixed(d == null ? 2 : d); }

function sec(title, key) {
  var wrap = el('div', 'ss-sec');
  var head = el('div', 'ss-sec-head');
  head.appendChild(el('span', 'ss-sec-t', title));
  var caret = el('span', 'ss-caret', '▸');
  head.appendChild(caret);
  var body = el('div', 'ss-sec-body');
  body.style.display = 'none';                 // 初始 inline 状态定死，单击即展开
  head.addEventListener('click', function (e) {
    e.preventDefault();
    var open = body.style.display !== 'block';
    body.style.display = open ? 'block' : 'none';
    caret.textContent = open ? '▾' : '▸';
    if (open) toast(null); // 触发一次可见反馈（由 title 提供，见下）
  });
  wrap.appendChild(head); wrap.appendChild(body);
  wrap._body = body;
  if (typeof title === 'string') head.setAttribute('data-t', title);
  return wrap;
}
function row(label, ctrl, valEl) {
  var r = el('div', 'ss-row2');
  r.appendChild(el('label', 'ss-lab', label));
  r.appendChild(ctrl);
  if (valEl) r.appendChild(valEl);
  return r;
}
function slider(min, max, step, val, onInput) {
  var s = el('input', 'ss-rng'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = val;
  var v = el('span', 'ss-val', '');
  s.addEventListener('input', function () { onInput(parseFloat(s.value), v); s.classList.add('ss-flash'); setTimeout(function () { s.classList.remove('ss-flash'); }, 220); });
  return { wrap: row('', s, v), s: s, v: v };
}
function setSlider(sl, val, fmt) { sl.s.value = val; sl.v.textContent = fmt != null ? fmt : num(val); }
function select(options, val, onChange) {
  var s = el('select', 'ss-sel');
  for (var i = 0; i < options.length; i++) { var o = el('option', null, options[i].label); o.value = options[i].value; s.appendChild(o); }
  s.value = val;
  s.addEventListener('change', function () { onChange(s.value); });
  return s;
}

function buildPanel() {
  var panel = el('div', 'ss-panel' + (state.open ? '' : ' ss-hidden'));
  panel.id = 'ss-panel';
  var head = el('div', 'ss-head');
  var t = el('div', 'ss-title', '声境音效');
  t.appendChild(el('small', null, 'SonicScape · 模块化音效引擎'));
  head.appendChild(t);
  var hb = el('div', 'ss-head-btns');
  var pw = el('button', 'ss-mini ss-power', state.enabled ? '● 开' : '○ 关');
  pw.title = '总开关 (Alt+Shift+S)';
  pw.addEventListener('click', function (e) { e.preventDefault(); toggleEnabled(); });
  ui.pw = pw;
  var abBtn = el('button', 'ss-mini', 'A/B'); abBtn.addEventListener('click', function (e) { e.preventDefault(); toggleAB(); });
  var smartBtn = el('button', 'ss-mini ss-smart', '智能'); smartBtn.addEventListener('click', function (e) { e.preventDefault(); toggleSmart(!state.smart); });
  var close = el('button', 'ss-close', '×'); close.addEventListener('click', function (e) { e.preventDefault(); togglePanel(); });
  hb.appendChild(pw); hb.appendChild(abBtn); hb.appendChild(smartBtn); hb.appendChild(close);
  head.appendChild(hb); panel.appendChild(head);

  // 当前状态条（点击/切换都有明确反馈）
  ui.status = el('div', 'ss-status', ''); panel.appendChild(ui.status);

  var tabs = el('div', 'ss-tabs');
  [['presets', '预设'], ['eq', '均衡'], ['dyn', '动态·激励'], ['space', '混响'], ['stereo', '声场'], ['io', '输入·输出'], ['lib', '生态']].forEach(function (pair) {
    var b = el('button', 'ss-tab', pair[1]); b.setAttribute('data-tab', pair[0]);
    b.addEventListener('click', function (e) { e.preventDefault(); switchTab(pair[0]); toast(pair[1]); });
    tabs.appendChild(b);
  });
  panel.appendChild(tabs);
  var pages = el('div', 'ss-pages'); panel.appendChild(pages); ui.pages = pages;
  buildPresetsPage(pages); buildEQPage(pages); buildDynPage(pages); buildSpacePage(pages);
  buildStereoPage(pages); buildIOPage(pages); buildLibPage(pages);

  var vizWrap = el('div', 'ss-viz');
  ui.canvas = el('canvas', 'ss-spectrum'); ui.canvas.width = 320; ui.canvas.height = 56;
  vizWrap.appendChild(ui.canvas); ui.cctx = ui.canvas.getContext('2d');
  var meter = el('div', 'ss-meter2'); var bar = el('div', 'ss-meter2-bar'); meter.appendChild(bar);
  vizWrap.appendChild(meter); ui.meterBar = bar; panel.appendChild(vizWrap);
  ui.diag = el('div', 'ss-diag', ''); panel.appendChild(ui.diag);
  return panel;
}
function switchTab(k) {
  ui.tab = k; state.tab = k; saveState();
  var tabs = ui.panel.querySelectorAll('.ss-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('ss-active', tabs[i].getAttribute('data-tab') === k);
  var pg = ui.panel.querySelectorAll('.ss-page');
  for (var j = 0; j < pg.length; j++) pg[j].style.display = (pg[j].getAttribute('data-page') === k) ? 'block' : 'none';
  if (k === 'eq') { drawEQCurve(); }
}
function page(parent, key) { var p = el('div', 'ss-page'); p.setAttribute('data-page', key); p.style.display = 'none'; parent.appendChild(p); return p; }


// ---------------- 预设页 ----------------
function buildPresetsPage(parent) {
  var p = page(parent, 'presets');
  var inten = sec('全局音效强度', 'intensity');
  var sl = slider(0, 100, 1, state.intensity, function (v, ve) {
    state.intensity = v; ve.textContent = v + '%'; saveState(); applyEQ(); applyExcite(); drawEQCurve();
    toast('强度 ' + v + '%');
  });
  setSlider(sl, state.intensity, state.intensity + '%');
  inten._body.appendChild(sl.wrap);
  inten._body.appendChild(el('p', 'ss-hint', '整体缩放 EQ 提升量与激励，0% 归零方便 A/B 对比。'));
  p.appendChild(inten);
  GROUPS.forEach(function (g) {
    var items = PRESETS.filter(function (x) { return x.group === g; });
    if (!items.length) return;
    var s = sec(g, g);
    var grid = el('div', 'ss-grid');
    items.forEach(function (it) {
      var b = el('button', 'ss-item', it.name); b.setAttribute('data-id', it.id);
      b.addEventListener('click', function (e) { e.preventDefault(); applyPreset(it.id); });
      grid.appendChild(b);
    });
    s._body.appendChild(grid); p.appendChild(s);
  });
  var us = sec('我的预设', 'user');
  var ug = el('div', 'ss-grid'); ug.id = 'ss-user-grid'; us._body.appendChild(ug);
  var saveRow = el('div', 'ss-row2');
  var nameInp = el('input', 'ss-txt'); nameInp.placeholder = '预设名'; nameInp.id = 'ss-preset-name';
  var saveBtn = el('button', 'ss-btn', '保存当前');
  saveBtn.addEventListener('click', function (e) { e.preventDefault(); saveUserPreset(nameInp.value); toast('已保存预设'); });
  saveRow.appendChild(nameInp); saveRow.appendChild(saveBtn); us._body.appendChild(saveRow);
  p.appendChild(us);
}
function saveUserPreset(name) {
  name = (name || '').trim() || ('预设' + (Object.keys(USER_PRESETS).length + 1));
  USER_PRESETS[name] = { modules: deepClone(state.modules), intensity: state.intensity, ts: Date.now() };
  saveUserPresets(USER_PRESETS); renderUserPresets();
}
function delUserPreset(name) { delete USER_PRESETS[name]; saveUserPresets(USER_PRESETS); renderUserPresets(); toast('已删除 ' + name); }
function applyUserPreset(name) {
  var o = USER_PRESETS[name]; if (!o) return;
  state.modules = deepClone(o.modules); state.intensity = o.intensity != null ? o.intensity : 100;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
  state.preset = 'user:' + name; state.smart = false; state.ab = null; saveState(); applyAll(); toast('已应用：' + name);
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

// ---------------- EQ 页：可拖点曲线编辑器 ----------------
function buildEQPage(parent) {
  var p = page(parent, 'eq');
  p.appendChild(el('p', 'ss-hint', '直接拖动曲线上的圆点调频率(左右)与增益(上下)。下方逐段精调类型/频率/增益/Q。'));
  ui.eqCanvas = el('canvas', 'ss-eqcurve'); ui.eqCanvas.width = 320; ui.eqCanvas.height = 150;
  p.appendChild(ui.eqCanvas); ui.eqc = ui.eqCanvas.getContext('2d');
  bindEQDrag();
  var bandsBox = el('div', 'ss-bands'); p.appendChild(bandsBox); ui.bandsBox = bandsBox;
  var flat = el('button', 'ss-btn', '全部归零');
  flat.addEventListener('click', function (e) { e.preventDefault(); state.modules.eq.bands.forEach(function (b) { b.gain = 0; }); applyEQ(); renderBands(); toast('EQ 已归零'); });
  p.appendChild(flat);
}
function eqCanvasPos(b, i) {
  var W = ui.eqCanvas.width, H = ui.eqCanvas.height;
  var f = clamp(b.freq || EQ_FREQS[i], 20, 20000);
  var x = Math.log(f / 20) / Math.log(1000) * W;
  var y = H / 2 - clamp((b.gain || 0), -15, 15) / 15 * (H / 2 - 10);
  return { x: x, y: y };
}
function bindEQDrag() {
  var drag = -1;
  function pt(e) { var r = ui.eqCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * ui.eqCanvas.width / r.width, y: (e.clientY - r.top) * ui.eqCanvas.height / r.height }; }
  ui.eqCanvas.addEventListener('pointerdown', function (e) {
    var q = pt(e), best = -1, bd = 22;
    state.modules.eq.bands.forEach(function (b, i) { var c = eqCanvasPos(b, i), d = Math.hypot(c.x - q.x, c.y - q.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; ui.eqCanvas.setPointerCapture(e.pointerId); }
  });
  ui.eqCanvas.addEventListener('pointermove', function (e) {
    if (drag < 0) return;
    var q = pt(e), W = ui.eqCanvas.width, H = ui.eqCanvas.height;
    var b = state.modules.eq.bands[drag];
    b.freq = Math.round(clamp(20 * Math.pow(1000, q.x / W), 20, 20000));
    b.gain = +clamp((H / 2 - q.y) / (H / 2 - 10) * 15, -15, 15).toFixed(1);
    applyEQ(); drawEQCurve(); renderBands();
  });
  ui.eqCanvas.addEventListener('pointerup', function () { if (drag >= 0) { drag = -1; toast('频段 ' + (drag + 1) + ' 已更新'); } });
}
function renderBands() {
  if (!ui.bandsBox) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
  ui.bandsBox.innerHTML = '';
  state.modules.eq.bands.forEach(function (b, i) {
    var s = sec((EQ_FREQS[i] >= 1000 ? (EQ_FREQS[i] / 1000) + 'k' : EQ_FREQS[i]) + 'Hz · ' + num(b.gain, 1) + 'dB', 'eq' + i);
    var typeSel = select([
      { value: 'peaking', label: '峰值' }, { value: 'lowshelf', label: '低架' }, { value: 'highshelf', label: '高架' },
      { value: 'lowpass', label: '低通' }, { value: 'highpass', label: '高通' }
    ], b.type, function (v) { b.type = v; applyEQ(); drawEQCurve(); toast('频段类型已改'); });
    s._body.appendChild(row('类型', typeSel));
    var fSl = slider(20, 20000, 1, b.freq, function (v, ve) { b.freq = v; ve.textContent = (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) + 'Hz'; applyEQ(); drawEQCurve(); });
    setSlider(fSl, b.freq, (b.freq >= 1000 ? (b.freq / 1000).toFixed(1) + 'k' : b.freq) + 'Hz');
    s._body.appendChild(row('频率', fSl.wrap.querySelector('input'), fSl.v));
    var gSl = slider(-15, 15, 0.5, b.gain, function (v, ve) { b.gain = v; ve.textContent = num(v, 1) + 'dB'; applyEQ(); drawEQCurve(); });
    setSlider(gSl, b.gain, num(b.gain, 1) + 'dB');
    s._body.appendChild(row('增益', gSl.wrap.querySelector('input'), gSl.v));
    var qSl = slider(0.1, 10, 0.1, b.q, function (v, ve) { b.q = v; ve.textContent = num(v, 1); applyEQ(); drawEQCurve(); });
    setSlider(qSl, b.q, num(b.q, 1));
    s._body.appendChild(row('Q', qSl.wrap.querySelector('input'), qSl.v));
    ui.bandsBox.appendChild(s);
  });
}

// ---------------- 动态/激励页 ----------------
function buildDynPage(parent) {
  var p = page(parent, 'dyn');
  var ex = sec('激励 / 饱和', 'ex'), m = state.modules.excite;
  var tSel = select([{ value: 'off', label: '关闭' }, { value: 'tube', label: '电子管' }, { value: 'tape', label: '磁带' }, { value: 'soft', label: '柔和饱和' }],
    m.type, function (v) { m.type = v; applyExcite(); toast('激励：' + v); });
  ex._body.appendChild(row('类型', tSel));
  [['驱动', 'drive', 0, 1, 0.05], ['空气感dB', 'air', 0, 12, 0.5]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 1); applyExcite(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 1)); ex._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(ex);
  var cp = sec('压缩器', 'cp'), c = state.modules.comp;
  [['阈值dB', 'th', -60, 0, 1], ['拐点', 'knee', 0, 40, 1], ['比率', 'ratio', 1, 20, 0.5],
   ['启动s', 'at', 0, 1, 0.005], ['释放s', 'rel', 0, 1, 0.01], ['补偿dB', 'makeup', -12, 12, 0.5],
   ['限幅顶dB', 'ceiling', -12, 0, 0.5]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], c[cfg[1]], function (v, ve) { c[cfg[1]] = v; ve.textContent = num(v, 2); applyComp(); });
    setSlider(sl, c[cfg[1]], num(c[cfg[1]], 2)); cp._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  var lim = el('label', 'ss-check'); var limCb = el('input'); limCb.type = 'checkbox'; limCb.checked = c.limiter;
  limCb.addEventListener('change', function () { c.limiter = limCb.checked; applyComp(); toast(limCb.checked ? '限幅开' : '限幅关'); });
  lim.appendChild(limCb); lim.appendChild(document.createTextNode(' 真峰限幅')); cp._body.appendChild(lim);
  p.appendChild(cp);
}

// ---------------- 混响页 ----------------
function buildSpacePage(parent) {
  var p = page(parent, 'space'), s = sec('卷积混响', 'rev'), m = state.modules.reverb;
  var opts = Object.keys(IR_DEFS).map(function (k) { return { value: k, label: IR_DEFS[k].label }; });
  opts.push({ value: 'custom', label: '自定义 IR…' });
  var irSel = select(opts, m.ir, function (v) { m.ir = v; if (v === 'custom' && !CUSTOM_IR) openIRPicker(); applyReverb(); toast('混响空间：' + (IR_DEFS[v] ? IR_DEFS[v].label : '自定义')); });
  s._body.appendChild(row('空间', irSel));
  [['湿度', 'wet', 0, 1, 0.01], ['预延时ms', 'predelay', 0, 200, 1], ['尺寸', 'size', 0.5, 4, 0.1]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 2); applyReverb(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 2)); s._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  var imp = el('button', 'ss-btn', '导入自定义 IR (.wav)');
  imp.addEventListener('click', function (e) { e.preventDefault(); openIRPicker(); });
  s._body.appendChild(imp);
  s._body.appendChild(el('p', 'ss-hint', CUSTOM_IR ? ('已载入：' + CUSTOM_IR_NAME) : '可选单/双声道 wav 作脉冲响应。'));
  p.appendChild(s);
}
function openIRPicker() {
  var inp = el('input'); inp.type = 'file'; inp.accept = '.wav,audio/wav'; inp.style.display = 'none'; document.body.appendChild(inp);
  inp.addEventListener('change', function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      ctx.decodeAudioData(fr.result.slice(0), function (buf) {
        CUSTOM_IR = buf; CUSTOM_IR_NAME = f.name; state.modules.reverb.ir = 'custom'; lastIRKey = ''; applyReverb();
        toast('已载入 IR：' + f.name, 'ok'); saveState();
      }, function () { toast('IR 解码失败，用 wav', 'off'); });
    };
    fr.readAsArrayBuffer(f); inp.remove();
  });
  inp.click();
}

// ---------------- 声场页 ----------------
function buildStereoPage(parent) {
  var p = page(parent, 'stereo'), s = sec('立体声场 / 中侧(M/S)', 'st'), m = state.modules.stereo;
  [['宽度', 'width', -1, 1, 0.05], ['中央M dB', 'mid', -12, 12, 0.5], ['侧向S dB', 'side', -12, 12, 0.5], ['侧向低频切除Hz', 'sideLowcut', 0, 1000, 10]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], m[cfg[1]], function (v, ve) { m[cfg[1]] = v; ve.textContent = num(v, 2); applyStereo(); });
    setSlider(sl, m[cfg[1]], num(m[cfg[1]], 2)); s._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(s);
  var b = sec('低音谐波增强', 'bass'), bm = state.modules.bass;
  var on = el('label', 'ss-check'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = bm.on;
  cb.addEventListener('change', function () { bm.on = cb.checked; applyBass(); toast(cb.checked ? '低音增强开' : '低音增强关'); });
  on.appendChild(cb); on.appendChild(document.createTextNode(' 开启')); b._body.appendChild(on);
  [['中心频率Hz', 'freq', 30, 250, 5], ['谐波量', 'amount', 0, 1, 0.05]].forEach(function (cfg) {
    var sl = slider(cfg[2], cfg[3], cfg[4], bm[cfg[1]], function (v, ve) { bm[cfg[1]] = v; ve.textContent = num(v, 2); applyBass(); });
    setSlider(sl, bm[cfg[1]], num(bm[cfg[1]], 2)); b._body.appendChild(row(cfg[0], sl.wrap.querySelector('input'), sl.v));
  });
  p.appendChild(b);
}

// ---------------- 输入/输出页 ----------------
function buildIOPage(parent) {
  var p = page(parent, 'io'), i = sec('输入 / 自动响度', 'in'), m = state.modules.input;
  var au = el('label', 'ss-check'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = m.autoLoud;
  cb.addEventListener('change', function () { m.autoLoud = cb.checked; if (!cb.checked) m.autoGainDb = 0; applyInput(); });
  au.appendChild(cb); au.appendChild(document.createTextNode(' 响度自动匹配')); i._body.appendChild(au);
  var sl = slider(-24, 24, 0.5, m.gain, function (v, ve) { m.gain = v; ve.textContent = num(v, 1) + 'dB'; applyInput(); });
  setSlider(sl, m.gain, num(m.gain, 1) + 'dB'); i._body.appendChild(row('输入增益', sl.wrap.querySelector('input'), sl.v));
  p.appendChild(i);
  var o = sec('输出', 'out'), om = state.modules.output;
  var sl2 = slider(-24, 12, 0.5, om.gain, function (v, ve) { om.gain = v; ve.textContent = num(v, 1) + 'dB'; applyOutput(); });
  setSlider(sl2, om.gain, num(om.gain, 1) + 'dB'); o._body.appendChild(row('输出增益', sl2.wrap.querySelector('input'), sl2.v));
  p.appendChild(o);
}

// ---------------- 生态页 ----------------
function buildLibPage(parent) {
  var p = page(parent, 'lib');
  p.appendChild(el('p', 'ss-hint', '预设导出为 JSON 分享、导入他人预设、自定义 IR 扩展空间。'));
  var exp = el('button', 'ss-btn', '导出当前为 JSON'); exp.addEventListener('click', function (e) { e.preventDefault(); exportPreset(); });
  var imp = el('button', 'ss-btn', '导入 JSON 预设'); imp.addEventListener('click', function (e) { e.preventDefault(); importPreset(); });
  var r1 = el('div', 'ss-row2'); r1.appendChild(exp); r1.appendChild(imp); p.appendChild(r1);
  var pkg = el('button', 'ss-btn ss-btn-wide', '复制当前配置'); pkg.addEventListener('click', function (e) { e.preventDefault(); copyConfig(); });
  p.appendChild(pkg);
  ui.codeBox = el('textarea', 'ss-code'); ui.codeBox.placeholder = '导入/导出内容'; p.appendChild(ui.codeBox);
  ui.stat = el('div', 'ss-stat', ''); p.appendChild(ui.stat);
}
function currentConfig() { return { v: 1, name: state.preset, intensity: state.intensity, modules: state.modules }; }
function exportPreset() {
  var txt = JSON.stringify(currentConfig()); if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  if (ui.stat) ui.stat.textContent = '已导出 ' + txt.length + ' 字节'; toast('已导出', 'ok');
}
function importPreset() {
  var txt = ui.codeBox ? ui.codeBox.value.trim() : '';
  if (!txt) { if (ui.stat) ui.stat.textContent = '先粘贴 JSON'; toast('先粘贴 JSON', 'off'); return; }
  try {
    var o = JSON.parse(txt); if (!o.modules) throw new Error('缺 modules');
    state.modules = deepClone(o.modules); state.intensity = o.intensity != null ? o.intensity : 100;
    if (!state.modules.eq || !Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
    state.preset = 'imported'; state.smart = false; state.ab = null; saveState(); applyAll();
    if (ui.stat) ui.stat.textContent = '导入成功'; toast('导入成功', 'ok');
  } catch (e) { if (ui.stat) ui.stat.textContent = '导入失败：' + e.message; toast('导入失败', 'off'); }
}
function copyConfig() {
  var txt = JSON.stringify(currentConfig()); if (ui.codeBox) ui.codeBox.value = txt;
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  if (ui.stat) ui.stat.textContent = '已复制'; toast('已复制', 'ok');
}


// ---------------- A/B ----------------
function toggleAB() {
  if (state.ab) { state.modules = state.ab; state.ab = null; }
  else { state.ab = deepClone(state.modules); state.modules = defaultState().modules; }
  if (!Array.isArray(state.modules.eq.bands) || state.modules.eq.bands.length !== 10) state.modules.eq = { bands: defaultBands() };
  state.smart = false; saveState(); applyAll();
  toast(state.ab ? 'B · 原音对照' : 'A · 我的调音', state.ab ? 'off' : 'ok');
}

// ---------------- 装配 UI ----------------
function ensureUI() {
  if (ui.btn && ui.btn.parentNode) return;
  var btn = el('button', 'ss-toggle', '♪'); btn.id = 'ss-toggle'; btn.title = '声境音效 (Alt+Shift+P)';
  btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); });
  var host = document.querySelector('.extra-controls');
  if (host) { var ref = host.querySelector('.playback-speed'); if (ref) host.insertBefore(btn, ref.nextSibling); else host.appendChild(btn); }
  else document.body.appendChild(btn);
  ui.btn = btn;
  // 悬浮快捷开关（一键总开关，不依赖面板）
  var fab = el('button', 'ss-fab', state.enabled ? '♪' : '✕'); fab.id = 'ss-fab';
  fab.title = '一键开关音效 (Alt+Shift+S)';
  fab.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleEnabled(); });
  document.body.appendChild(fab); ui.fab = fab;

  ui.panel = buildPanel(); document.body.appendChild(ui.panel);
  renderBands(); renderUserPresets();
  switchTab(state.tab || 'presets');
  if (ui.timer) clearInterval(ui.timer);
  ui.timer = setInterval(diagTick, 100);
  updateUI(); drawEQCurve();
}
function togglePanel() { state.open = !state.open; saveState(); if (ui.panel) ui.panel.classList.toggle('ss-hidden', !state.open); updateUI(); }
function updateUI() {
  if (!ui.panel) return;
  var btns = ui.panel.querySelectorAll('.ss-item[data-id]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('ss-active', btns[i].getAttribute('data-id') === state.preset);
  var sb = ui.panel.querySelector('.ss-smart'); if (sb) sb.classList.toggle('ss-on', state.smart);
  if (ui.pw) { ui.pw.textContent = state.enabled ? '● 开' : '○ 关'; ui.pw.classList.toggle('ss-on', state.enabled); }
  if (ui.fab) { ui.fab.textContent = state.enabled ? '♪' : '✕'; ui.fab.classList.toggle('ss-off', !state.enabled); }
  if (ui.btn) ui.btn.classList.toggle('ss-on', state.enabled);
  if (ui.status) {
    var p = findPreset(state.preset);
    var label = state.preset === 'smart' ? '智能调音' : (state.preset.indexOf('user:') === 0 ? state.preset.slice(5) : (state.preset === 'imported' ? '导入配置' : p.name));
    ui.status.textContent = (state.enabled ? '● 音效开启' : '○ 原音') + '　|　' + label + '　|　强度 ' + state.intensity + '%' + (state.smart ? '　[智能]' : '') + (state.ab ? '　[A/B:B]' : '');
  }
}

// ---------------- 可视化 ----------------
function drawViz() {
  if (!ui.cctx || !nodes) return;
  var c = ui.cctx, W = ui.canvas.width, H = ui.canvas.height;
  c.clearRect(0, 0, W, H);
  var spec = readSpectrum();
  if (spec) {
    var step = Math.max(1, Math.floor(spec.length / 64));
    for (var x = 0; x < 64; x++) {
      var v = 0, cc = 0;
      for (var k = 0; k < step; k++) { var idx = x * step + k; if (idx < spec.length && spec[idx] > -100) { v += (spec[idx] + 100); cc++; } }
      var mag = cc ? (v / cc) / 100 : 0;
      c.fillStyle = 'rgba(94,234,212,' + (0.3 + mag * 0.7) + ')';
      c.fillRect(x * (W / 64), H - Math.max(1, mag * H), (W / 64) - 1, Math.max(1, mag * H));
    }
  }
  if (ui.meterBar) ui.meterBar.style.width = Math.min(100, rms * 260).toFixed(0) + '%';
}
// 曲线只依赖 state，不依赖 nodes；按 type 画 shelf / pass，量程 ±15dB 放大到可见
function drawEQCurve() {
  if (!ui.eqc || !ui.eqCanvas) return;
  if (!state.modules.eq || !Array.isArray(state.modules.eq.bands)) state.modules.eq = { bands: defaultBands() };
  var c = ui.eqc, W = ui.eqCanvas.width, H = ui.eqCanvas.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,.10)';
  for (var g = -10; g <= 10; g += 5) { var gy = H / 2 - g / 15 * (H / 2 - 10); c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  c.strokeStyle = 'rgba(94,234,212,.85)'; c.lineWidth = 2; c.beginPath();
  var bands = state.modules.eq.bands, k = clamp(state.intensity, 0, 100) / 100;
  for (var x = 0; x <= W; x++) {
    var f = 20 * Math.pow(1000, x / W), sum = 0;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i], gain = (b.gain || 0) * k, cf = clamp(b.freq || EQ_FREQS[i], 20, 20000), q = clamp(b.q || 1, 0.1, 10);
      var type = b.type || 'peaking';
      var contrib;
      if (type === 'lowshelf') contrib = gain * (1 / (1 + Math.pow(f / cf, 2)));
      else if (type === 'highshelf') contrib = gain * (1 / (1 + Math.pow(cf / f, 2)));
      else if (type === 'lowpass') contrib = -15 * (1 / (1 + Math.pow(f / cf, -4)));
      else if (type === 'highpass') contrib = -15 * (1 / (1 + Math.pow(f / cf, 4)));
      else { var ratio = Math.log(f / cf) / Math.log(2); contrib = gain * Math.exp(-(ratio * ratio) / (2 * q * q * 0.32)); }
      sum += contrib;
    }
    var y = H / 2 - clamp(sum, -16, 16) / 15 * (H / 2 - 10);
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  // 可拖点
  for (var j = 0; j < bands.length; j++) {
    var pt = eqCanvasPos(bands[j], j);
    c.beginPath(); c.arc(pt.x, pt.y, 5, 0, 6.28); c.fillStyle = '#5eead4'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#0f172a'; c.stroke();
  }
}
function diagText() {
  return 'hook:' + (claimed ? 'cap' : 'wait') + ' ctx:' + (ctx ? ctx.state : '-') + ' chain:' + diag.chain +
    ' rms:' + rms.toFixed(3) + '(' + dbVal() + 'dB) pk:' + peak.toFixed(2) +
    ' on:' + state.enabled + ' preset:' + state.preset + (state.smart ? ' [智能]' : '') + (diag.err !== '-' ? ' err:' + diag.err : '');
}
function updateDiag() { if (ui.diag) ui.diag.textContent = diagText(); }

// ---------------- 调试句柄 ----------------
window.__ss = {
  diag: function () { return { installed: true, audio: claimed ? 'captured' : 'none', src: diag.src, ctx: ctx ? ctx.state : 'none',
    chain: diag.chain, rms: +rms.toFixed(4), peak: +peak.toFixed(4), preset: state.preset, intensity: state.intensity,
    enabled: state.enabled, smart: state.smart, ab: !!state.ab, tab: state.tab, err: diag.err, lastSmart: window.__ss_lastSmart || null }; },
  params: function () {
    if (!nodes) return null;
    return { eq: nodes.eq.map(function (f) { return +f.gain.value.toFixed(2); }), eqTypes: nodes.eq.map(function (f) { return f.type; }),
      bassOn: +nodes.bassGain.gain.value.toFixed(3), bassCurve: state.modules.bass.amount,
      exciteWet: +nodes.exciteWet.gain.value.toFixed(3), exciteDry: +nodes.exciteDry.gain.value.toFixed(3),
      exciteType: state.modules.excite.type, air: +nodes.air.gain.value.toFixed(2),
      comp: { th: nodes.comp.threshold.value, ratio: nodes.comp.ratio.value, knee: nodes.comp.knee.value },
      limiter: { th: nodes.limiter.threshold.value, ratio: nodes.limiter.ratio.value },
      reverb: { wet: +nodes.revSend.gain.value.toFixed(3), ir: state.modules.reverb.ir },
      stereo: { width: state.modules.stereo.width, mid: +nodes.mid.gain.value.toFixed(3), side: +nodes.side.gain.value.toFixed(3) },
      input: +nodes.input.gain.value.toFixed(3), output: +nodes.output.gain.value.toFixed(3), vol: +nodes.vol.gain.value.toFixed(3), bypass: !!nodes.bypass };
  },
  state: function () { return deepClone(state.modules); },
  apply: function (id) { applyPreset(id); return window.__ss.diag(); },
  set: function (mod, key, val) { if (!state.modules[mod]) return null; state.modules[mod][key] = val; applyAll(); return window.__ss.params(); },
  setEQ: function (i, obj) { if (!state.modules.eq.bands[i]) return null; for (var k in obj) state.modules.eq.bands[i][k] = obj[k]; applyEQ(); renderBands(); drawEQCurve(); return window.__ss.params().eq; },
  setIntensity: function (v) { state.intensity = clamp(v, 0, 100) | 0; saveState(); applyEQ(); applyExcite(); drawEQCurve(); return window.__ss.params().eq; },
  smart: function (on) { toggleSmart(on !== false); return window.__ss.diag(); },
  ab: function () { toggleAB(); return window.__ss.diag(); },
  enabled: function () { toggleEnabled(); return window.__ss.diag(); },
  tab: function (k) { switchTab(k); return window.__ss.diag().tab; },
  exportCfg: function () { return JSON.stringify(currentConfig()); },
  importCfg: function (txt) { if (ui.codeBox) ui.codeBox.value = txt; importPreset(); return window.__ss.state(); },
  spectrum: function () { var s = readSpectrum(); return s ? Array.from(s) : null; },
  presets: function () { return PRESETS.map(function (p) { return p.id + ':' + p.group + ':' + p.name; }); },
  userPresets: function () { return Object.keys(USER_PRESETS); },
  saveUserPreset: function (n) { saveUserPreset(n); return Object.keys(USER_PRESETS); },
  applyUserPreset: function (n) { applyUserPreset(n); return window.__ss.diag(); },
  eqCurve: function () { drawEQCurve(); return true; }
};

// ---------------- 启动 ----------------
bindShortcuts();
if (document.body) ensureUI();
else document.addEventListener('DOMContentLoaded', function () { ensureUI(); });
var _iv = setInterval(function () { if (document.body && !ui.btn) ensureUI(); if (ui.btn) clearInterval(_iv); }, 300);
if (console && console.log) console.log(LOG + ' SonicScape 引擎已加载');
})();

