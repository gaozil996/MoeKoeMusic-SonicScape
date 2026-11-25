# 上架记录

## 状态
仓库已备好，等待在 MoeKoeMusic-Plugins 提交上架 Issue。

- 仓库 https://github.com/gaozil996/MoeKoeMusic-SonicScape
- 版本 1.1.0，tag v1.1.0
- commit 29d5857
- 许可证 MIT
- 纯前端插件，不需要编译，不需要本地程序，只申请 storage 权限

## 提交入口
[一键打开上架表单](https://github.com/MoeKoeMusic/MoeKoeMusic-Plugins/issues/new?template=plugin_publish.yml&title=%5BPlugin%5D%20%E5%A3%B0%E5%A2%83%E9%9F%B3%E6%95%88%20SonicScape)

## 表单怎么填

标题已经带好，[Plugin] 声境音效 SonicScape

| 字段 | 填什么 |
|---|---|
| 操作类型 | 新上架 |
| GitHub 仓库地址 | https://github.com/gaozil996/MoeKoeMusic-SonicScape |
| 安装前是否需要编译 | 否，整个仓库可直接作为插件包安装 |

补充说明可以整段粘贴下面这段。

```
MoeKoe Music 的全屏音效调音台，纯前端插件，不需要编译，不需要本地程序，只申请了 storage 权限。

功能概览
- 31 套内置预设，按基础/经典音效/流派/设备/场景/监听分组
- 10 段参数 EQ，曲线用真实 biquad 幅频响应绘制，可拖点改频率和增益
- 三层低音增强，88Hz 静态低架 + 动态量控 + 可选谐波层
- 两段亮度，6.5kHz 高架 + 2.8kHz 轮廓
- 齿音保护，5-9kHz 尖峰过强时自动压制
- 压缩器带自动补偿、真峰限幅
- 卷积混响，7 种空间 + 自定义 wav IR，尺寸 0.5-6
- 耳机交叉馈送，三档 + 混合量
- M/S 声场、EBU R128 响度自动匹配（目标 -14 LUFS）
- 支持 AutoEQ 的 ParametricEQ.txt 导入
- 快捷键 Alt+Shift+S / P / M

实现说明
- 插件入口是播放栏里的 ♪ 按钮，只在主界面创建，歌词页和桌面歌词窗口不注入
- 面板底部按宿主播放栏实际高度留白，窗口缩放自动跟随
- 面板关闭时取消 rAF，停止所有绘制
- 仓库根目录可直接作为插件包使用，manifest.json 在根目录，icons 目录含 48/128/256 三种尺寸

测试环境
MoeKoe Music 1.7.0，Windows 11。已验证预设切换、六个标签页调参、预设保存与导入导出、界面窄屏表现。
```

两个勾都打上。

## 审核通过前自查
- [x] 仓库公开可访问
- [x] 根目录有 manifest.json
- [x] plugin_id 是 sonic-scape，全局唯一
- [x] name 和 description 齐全，描述 81 字符
- [x] moekoe 为 true
- [x] minversion 1.7.0
- [x] 不需要编译
- [x] 无 nativeHost
- [x] 图标齐全
