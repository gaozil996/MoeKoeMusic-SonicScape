# 上架记录

## 当前状态

Issue 已提交，自动校验通过，等维护者人工审核。

- 上架申请 https://github.com/MoeKoeMusic/MoeKoeMusic-Plugins/issues/261
- 自动校验 `check-passed`
- 快照 commit `5e056206e92fac2d734680034aaf0ecd3a86fff8`
- 快照版本 1.1.0
- 仓库 https://github.com/gaozil996/MoeKoeMusic-SonicScape
- 许可证 MIT

审核通过后维护者会 `Close as completed`，仓库的 Action 自动生成 PR 更新 `plugins.json` 和 README，PR 合并后客户端插件市场就能搜到。

## 提交内容

| 字段 | 值 |
|---|---|
| 操作类型 | 新上架 |
| 仓库地址 | https://github.com/gaozil996/MoeKoeMusic-SonicScape |
| 安装前是否需要编译 | 否，整个仓库可直接作为插件包安装 |

## 自动校验结果

- 插件名称 声境音效 SonicScape
- 插件 ID sonic-scape
- 版本 1.1.0
- 网络访问 是（host_permissions）
- 本地文件读写 是（读用户选的 IR 文件）
- 可执行二进制 否
- 存储权限 是（storage）

AI 静态审查给了 medium，三条提示都已在 Issue 里逐条回应，说明只存音效参数、不上传数据、不发网络请求。

## 提交前的自查

- [x] 仓库公开可访问
- [x] 根目录有 manifest.json
- [x] plugin_id 唯一，sonic-scape
- [x] name 和 description 齐全，描述 81 字符
- [x] moekoe 为 true
- [x] minversion 1.7.0
- [x] 不需要编译
- [x] 无 nativeHost
- [x] 图标 48/128/256 齐全
- [x] 截图和 README 完整
- [x] tag v1.1.0 已推
