# 班级智管 ClassMaster

<div align="center">

**初中班级成绩分析与智能排座系统**

[![Build](https://github.com/fyrs3101/ClassMaster/actions/workflows/build.yml/badge.svg)](https://github.com/fyrs3101/ClassMaster/actions/workflows/build.yml)
![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20macOS-blue)
![Electron](https://img.shields.io/badge/Electron-33.4-47848F)
![Version](https://img.shields.io/badge/版本-1.3.0-brightgreen)
![License](https://img.shields.io/badge/许可-私有商业软件-red)

</div>

## 简介

班级智管（ClassMaster）是一款面向初中班主任的桌面应用，把**成绩分析、智能排座、学生与操行分管理、局域网协作**整合在一个客户端里。基于 Electron 开发，数据全部保存在本机，无需联网、无需服务器，支持 Windows 与 macOS 双平台。

## 功能特性

### 成绩分析
- Excel 一键导入 / 手动录入，自动计算总分、排名、班级升降
- 趋势图、分数分布、分数段对比等多维图表
- 一键导出 Excel / PDF 成绩单

### 智能排座
- 可视化拖拽编排座位表，实时保存
- 按分组规则自动排座，支持身高、视力、成绩搭配等约束
- 教室容量超限自动提醒

### 学生管理
- 学生档案、自定义头像、个性评语
- 操行分（积分）体系：加分扣分、排行榜、积分流水、规则配置

### 飞鸽传书（局域网协作）
- 同一校园网内自动发现同事设备（UDP 广播发现 + TCP 可靠中继）
- 文字消息与文件传输，支持 6GB 大文件、断点续传
- 同一 IP 只显示一个成员，在线 / 离线状态实时同步
- 关闭窗口默认最小化到系统托盘（可在设置中改为直接退出）

### 授权激活
- 一机一码激活制；客户端仅校验激活码，**不具备签发能力**

## 界面截图

| 成绩分析总览 | 学生管理 |
|:---:|:---:|
| ![成绩分析](shots/01-dashboard.png) | ![学生管理](shots/05-students.png) |

| 智能排座 | 飞鸽传书 |
|:---:|:---:|
| ![智能排座](shots/13-seating-grouped.png) | ![飞鸽传书](shots/26-lan.png) |

## 快速开始（开发）

环境要求：**Node.js 20+**、npm 9+

```bash
npm ci        # 安装依赖
npm start     # 启动应用（开发模式）
npm run dev   # 带开发者工具启动
```

## 打包

```bash
npm run build         # Windows：NSIS 安装版 + 便携版（x64）
npm run build:mac     # macOS：arm64 zip
```

也可以交给 CI 自动完成：**push 到 `main` 自动构建双平台产物**（在 Actions 运行页下载），**打 `v*` 标签自动创建正式 Release**。工作流见 [`.github/workflows/build.yml`](.github/workflows/build.yml)。

## 项目结构

```
├── src/
│   ├── main/          # 主进程：窗口管理、激活校验、局域网引擎（lan.js）
│   ├── preload/       # 预加载：渲染进程与主进程之间的安全 IPC 桥
│   └── renderer/      # 渲染进程：界面、图表、排座、飞鸽传书 UI
├── build/             # 应用图标（Windows .ico / macOS .icns）
├── test/              # 引擎、激活流程、托盘行为等测试脚本
├── docs/              # macOS 安装说明
└── .github/workflows/ # CI：自动打包与 Release 发布
```

## 技术栈

- **Electron 33** —— 主进程 / 预加载 / 渲染进程三层架构，contextIsolation 隔离
- 原生 JavaScript + CSS，无前端框架，界面轻量
- **SheetJS (xlsx)** —— Excel 导入导出
- **局域网通信** —— UDP 广播发现 + TCP 可靠中继，同 IP 归一化去重
- **electron-builder** —— Windows NSIS / 便携版、macOS arm64 打包分发

## 文档

- [使用手册](使用手册.md) —— 完整功能使用说明
- [销售方案](销售方案.md) —— 产品定位与授权流程
- [macOS 安装说明](docs/macOS安装说明.md) —— macOS 首次打开权限设置

## 关于注册机

激活码的签发工具（注册机）为销售方内部工具，**不包含在本仓库中**，也不随软件分发。本仓库仅包含客户端源码，客户端只有激活码**校验**能力，无法生成激活码。

## License

`UNLICENSED` —— 私有商业软件，保留所有权利。未经授权不得复制、分发或用于商业用途。
