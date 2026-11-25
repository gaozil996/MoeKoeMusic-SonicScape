# 调音项目调研摘要

只记能落地的，来源都标了。

## 1 Android 音效系

### ViPER4Android
- **ViPER Bass** 有 modes，Natural Bass / Pure Bass+ / Subwoofer，参数是 cut-off frequency 和 strength。源码级参数换算见 V4A Profile Converter，`ViPERBass-cutOffFrequency = value - 15`，`strength = (value - 50) / 50`，即内部是 ±1 的归一化量。
  来源 https://github.com/Zackptg5/V4A-Profile-Converter
- **Dynamic System** 不是单纯 EQ，它按「设备类型」套一组预设，再做动态低音。`dynamicsystem_bass` 内部换算 `(value - 100) / 20`，`value` 100 对应 0。
- 官方/民间文档都强调动态低音「不会把中频压掉」，这和我上一版的问题正好相反。
  来源 https://doc.loafing.cn/apps/v4a.html
- **ViPER Clarity** 是独立的清晰度模块，Natural / Ozone+ / XHiFi 模式，strength 单独调。默认推荐 10dB 量级。

结论，V4A 把「低音」「清晰度」都拆成静态量 + 动态量两层，不是单一 shelf。

### JamesDSP / RootlessJamesDSP
- **Auto Bass Boost** 只暴露一个参数 `Max Gain`。内部逻辑是检测低频能量，**同时调整 gain、带宽、截止频率**，不是固定 shelf。
  来源 https://deepwiki.com/james34602/JamesDSPManager/3-audio-effects
- **Dynamic Range Compander** 是多段多分辨率动态处理，7 个固定频点 95/200/400/800/1600/3400/7500 Hz，每段有独立增益，时间常数默认 0.22s，有 STFT / CWT / 时域 Gammatone 三种分析方式。
  来源 https://github.com/james34602/JamesDSPManager/blob/master/Main/libjamesdsp/jni/jamesdsp/jdsp/Effects/dynamic.c
- 处理链位置，动态处理在最前面，EQ 在后。

结论，低音要动态，压缩要多段，频率分界可以用 95/200/400/800/1600/3400/7500 这套。

### Wavelet
- 基于 AutoEQ 的图形 EQ，带限幅和混响。核心价值是「导入耳机校正曲线」，不是算法创新。

## 2 桌面音效系

### EasyEffects
- **Bass Enhancer** 用的是 Calf 的 LV2 插件，本质是 missing fundamental 谐波生成。参数 `Amount`（混入量）、`Harmonics`（谐波量）、`Scope`（起始频率）、`Floor`（下限）、`Blend Harmonics`（谐波颜色/八度）。
  来源 https://wwmm.github.io/easyeffects/plugins/bassenhancer.html
- **Exciter** 同理，`Scope` 以上生成谐波，`Ceiling` 以上不再生成，避免刺耳。
  来源 https://wwmm.github.io/easyeffects/plugins/exciter.html
- **Crystalizer** 是 13 段 FIR 带通，每段算 kurtosis、crest factor、spectral flux，用二阶中心差分做瞬态峰值增强，强度可自适应。
  来源 https://deepwiki.com/wwmm/easyeffects/2.3.1-built-in-audio-effects
- **Autogain** 用 libebur128 做 EBU R128 响度归一化。
- **Crossfeed** 用 libbs2b，即 Bauer 算法。
- EQ 是 LSP 的 32 段参数均衡。

结论，桌面系的共识是低音用谐波补充 + 清晰度用瞬态增强，响度用 R128，耳机用 crossfeed。

### Equalizer APO
- Filter 类型齐全，PK / LS / HS / LP / HP / Notch / Bandpass / Allpass，还有 Convolution、Delay、Copy、Channel。
- Filter 按配置顺序串联，Preamp 放在最前。
- AutoEQ 的 `ParametricEQ.txt` 就是它的格式。

## 3 Web Audio 实测要点

- **lowshelf / highshelf 的 Q 参数不生效**，Chrome 实现里固定按 Q=1 的 cookbook 公式。想改 shelf 斜率必须自己算系数走 `IIRFilterNode`。
  来源 https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/Q
- **lowpass / highpass 的 Q 是按 dB 解释的**，不是线性 Q。Butterworth 对应 Q 参数 0 dB。所以 RLB 高通的线性 Q 0.5003 要换算成 `20*log10(0.5003) = -6.02` dB。
  来源 https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/Q
- **K-weighting 标准系数**（48kHz），
  stage1 shelf `b=[1.53512485958697, -2.69169618940638, 1.19839281085285]`，`a=[-1.69065929318241, 0.73248077421585]`
  stage2 highpass `b=[1, -2, 1]`，`a=[-1.99004745483398, 0.99007225036621]`
  非 48kHz 用双线性变换重算，模拟原型是 shelf 1681.974450955533Hz / +3.999843853973347dB / Q 0.7071752369554196，高通 38.13547087602444Hz / Q 0.5003270373238773。
  来源 https://docs.rs/manguebyte-analysis/latest/src/manguebyte_analysis/kweighting.rs.html
- **ConvolverNode 换 buffer 很贵**，实测 2.4s 的 IR 要 250ms，必须延迟换装 + 缓存（上一轮已验证）。
- **BiquadFilter 系数突变会爆音**，参数改动要用 `setTargetAtTime` 或 `linearRampToValueAtTime`。

## 4 心理声学与算法

### 低音增强三条路线
1. **纯 EQ shelf**，简单但大提升会糊，且抬中低频（200-400Hz）造成浑浊。
2. **谐波合成（missing fundamental）**
   - 全波整流只产生偶次谐波，感知音高变成 2f，不对。
   - 全波积分器产生奇偶全谐波，感知音高正确，效果更深。
   - 工程流程，低通（截止=扬声器下限）→ 非线性 → 带通（去掉残余基频、塑形）→ 增益 → 加回原信号的高通部分。
   - 带通上限 300Hz 左右，再高音色会变尖。
   - 经典参数，低通 20-80Hz，谐波带通 80-300Hz。
   来源 https://www.sps.tue.nl/rmaarts/RMA_papers/aar00c.pdf
   来源 https://www.mathworks.com/help/audio/ug/psychoacoustic-bass-enhancement-for-band-limited-signals.html
3. **动态低音**，按低频能量改变提升量，JamesDSP 的 Auto Bass Boost 就是这么干的。

结论，专业做法是 **静态 shelf 打底 + 动态量控 + 小比例谐波补充**，三者叠加，而不是任选一个。

### Crossfeed（bs2b / Bauer）
- 默认参数 700Hz / 4.5dB。三档预设，
  low 360/501Hz 增益 0.398/0.206
  middle 500/711Hz 增益 0.460/0.228
  high 700/1021Hz 增益 0.531/0.250
- 结构，`out_L = gain * (highboost(L) + lowpass(R))`，再和干信号按 mix 混合。
- 一级低通 + 一级高通补偿，不用 FFT，避免梳状滤波。
  来源 https://bs2b.sourceforge.net/bs2b_lib.html
  来源 https://github.com/kcat/openal-soft/blob/master/core/bs2b.cpp

### AutoEQ 参数格式
```
Preamp: -6.8 dB
Filter 1: ON PK Fc 21 Hz Gain 6.7 dB Q 1.100
Filter 2: ON LSC Fc 105 Hz Gain 6.9 dB Q 3.000
Filter 10: ON HSC Fc 10000 Hz Gain 1.1 dB Q 0.70
```
类型只有 PK / LSC / HSC。Preamp 用来防削波。
来源 https://docs.pipewire.org/page_module_parametric_equalizer.html

### 响度
- EBU R128 / ITU-R BS.1770，K 加权后算均方，400ms 窗口，-0.691dB 偏移。
- Integrated LUFS 是门限后的积分，Short-term 是 3s。
- 简单 RMS 和 LUFS 差很多，低频多的歌 RMS 高但 LUFS 不一定高。

## 5 这版要抄什么，不要抄什么

要抄
- 低音三层结构（静态 + 动态 + 谐波），参考 V4A 和 JamesDSP
- 清晰度双段（2.8k 轮廓 + 8.5k 空气感），参考 V4A Clarity
- crossfeed，参考 bs2b
- R128 响度，参考 EasyEffects Autogain
- AutoEQ 参数导入

不抄
- 13 段 Crystalizer（浏览器开销太大，且需要 FIR 设计）
- 多分辨率压缩器（Web Audio 做不了，收益不成比例）
- 32 段 EQ（10 段够用，多了难调）
