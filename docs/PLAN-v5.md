# SonicScape 深度改进方案（v5）

依据 `docs/research/research-summary.md`，把「拍脑袋调参数」换成「有出处的结构」。

## 一、低音改成三层（参考 V4A + JamesDSP）
| 层 | 做法 | 参数 |
|---|---|---|
| L1 清理 | 24Hz 高通，去掉占余量的次声 | 固定 |
| L2 静态 | 88Hz 低架 | 旋钮 0-100 映射 0-8dB |
| L3 动态 | 取 40-160Hz 能量，按能量额外加 0-6dB，attack 40ms / release 400ms | 内部自动 |
| L4 谐波 | 90Hz 低通 → 非对称整形 → 90-260Hz 带通 → 混入，补小喇叭感知 | 默认关，0-30% |

要点，L2 只抬 88Hz 以下，不碰 200-400Hz，避免浑浊。L4 单独开关，量小。

## 二、清晰度拆两段（参考 V4A Clarity）
| 段 | 频率 | 范围 |
|---|---|---|
| 轮廓 | 2.8kHz peaking Q1.2 | 0-4dB，跟着亮度旋钮 30% 以内联动 |
| 空气感 | 8.5kHz highshelf | 0-9dB |
| 齿音保护 | 6.5kHz peaking，高频过强时 -0..-3dB | 动态，默认开 |

## 三、Crossfeed（参考 bs2b / Bauer）
- 对侧 lowpass 700Hz + 增益 0.53，本侧高补偿，按 mix 混合
- 三档 low / mid / high，对应 bs2b 的 360/500/700Hz
- 声场页独立开关，默认关

## 四、响度与限幅（参考 EasyEffects Autogain）
- K-weighting 两级 biquad，48k 用标准系数，其他采样率按双线性变换重算
- 400ms 滑窗算均方 → LUFS 近似，目标 -14LUFS
- 增益平滑 1s，避免抽吸
- 真峰限幅，lookahead 5ms + 平滑释放

## 五、EQ 曲线与 AutoEQ
- 曲线改用 RBJ cookbook 真实幅频响应，不再用高斯近似
- 支持导入 AutoEQ `ParametricEQ.txt`，解析 Preamp + PK/LSC/HSC
- 10 段映射到现有 EQ，Preamp 落到输入增益

## 六、验收指标
1. 低音拉满，60Hz +7~9dB，8kHz 变化 < 1.5dB
2. 低音拉满（谐波 0），纯音 THD 增量 < 1dB
3. 亮度拉满，8kHz +5~7dB，250Hz 变化 < 1dB
4. 齿音保护，7kHz 强信号时该段自动降 1-3dB
5. crossfeed 开，对侧 700Hz 以下 -6dB 左右串音
6. 响度，输出稳定在 -14LUFS ±2
7. AutoEQ 导入后，10 段参数与文件一致
8. 切预设 < 10ms，关面板停绘

## 七、不做
- 13 段 Crystalizer（浏览器开销大）
- 多分辨率压缩器
- 32 段 EQ
