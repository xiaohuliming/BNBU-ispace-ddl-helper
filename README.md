<div align="center">

<img src="dist/icons/icon128.svg" width="80" height="80" alt="Moodle DDL Helper">

# Moodle DDL Helper

**Sync Autolab deadlines into your iSpace (Moodle) Dashboard Timeline.**

Never miss an assignment again.

[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](#english) · [中文](#中文)

</div>

---

<a id="english"></a>

## 🇬🇧 English

### The Problem

At BNBU (UIC), assignments for courses like OOP are submitted on **Autolab** (`http://172.31.12.111`), but deadlines are **not shown** on the iSpace (Moodle) Dashboard Timeline. This means you have to manually check Autolab for due dates — and it's easy to miss them.

### The Solution

This Chrome extension automatically fetches deadlines from Autolab and **injects them directly into the native iSpace Timeline**, sorted chronologically alongside your other assignments. It looks and feels like a native Moodle feature.

### Features

- **Auto-detect Autolab URLs** — Visit any iSpace course page that mentions the Autolab server, and the URL is saved automatically
- **Manual URL config** — Add any Autolab course URL in the popup; manage multiple courses
- **One-click sync** — Pink "Sync" button next to the Timeline title on the Dashboard
- **Native Timeline integration** — Injected items match the exact Moodle DOM structure (date headers, event items, styling)
- **Chronological ordering** — Autolab deadlines appear in the correct date group, not appended at the bottom
- **Mark as done** — Green ✓ button on each item; completed items are archived and hidden from the Timeline
- **Course binding** — Each Autolab URL remembers which iSpace course it was detected from
- **iSpace dates too** — Also picks up native Moodle due dates from course pages
- **Overdue highlighting** — Past-due items show a red "Overdue" badge
- **Popup dashboard** — Three tabs: active deadlines, Autolab URL config, completed archive
- **Privacy** — All data stays in your browser (`chrome.storage.local`). Nothing is sent to any server.

### Installation

1. Download or clone this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `dist/` folder

### Usage

#### First time setup

1. **Connect to campus VPN** (required to access `172.31.12.111`)
2. Visit your iSpace course page (e.g. `ispace.uic.edu.cn/course/view.php?id=7983`)
3. The extension auto-detects the Autolab URL from the page and saves it
4. Click the floating **"从 Autolab 同步 DDL"** button to sync

#### Daily use

1. Go to your iSpace Dashboard (`ispace.uic.edu.cn/my/`)
2. Click the pink **Sync** button next to "Timeline"
3. Your Autolab deadlines appear in the Timeline, sorted by date
4. Click **✓** to mark an assignment as done

#### Managing Autolab URLs

- Click the extension icon → **Autolab 配置** tab
- Auto-detected URLs show a blue "自动" badge with the source course name
- Manually add URLs with the input field (e.g. `http://172.31.12.111/courses/comp2013-oop-d`)
- Delete any URL with the × button

### Architecture

```
┌─ iSpace Course Page ──────────────────────────────┐
│  content-course.js                                 │
│  ├── Scrape visible Moodle due dates               │
│  ├── Detect Autolab URLs → save to config          │
│  └── Float button: sync DDLs from Autolab          │
└────────────────────────────────────────────────────┘
        │ chrome.runtime.sendMessage('FETCH_URL')
        ▼
┌─ Background Service Worker ───────────────────────┐
│  background.js                                     │
│  ├── fetch() Autolab pages (bypasses CORS)         │
│  └── Badge count for urgent deadlines              │
└────────────────────────────────────────────────────┘
        │ returns HTML
        ▼
┌─ iSpace Dashboard (/my/) ─────────────────────────┐
│  content-dashboard.js                              │
│  ├── Wait for Moodle AJAX Timeline to render       │
│  ├── Parse native date groups from DOM             │
│  ├── Inject DDL items into correct date positions  │
│  ├── Pink "Sync" button next to Timeline title     │
│  └── ✓ Done button → archive to doneIds            │
└────────────────────────────────────────────────────┘

┌─ Popup ───────────────────────────────────────────┐
│  popup.html / popup.js                             │
│  ├── Tab 1: Active deadlines + mark done           │
│  ├── Tab 2: Autolab URL config (auto + manual)     │
│  └── Tab 3: Completed archive + undo               │
└────────────────────────────────────────────────────┘
```

### Storage Schema

| Key | Type | Description |
|---|---|---|
| `deadlines` | `Array<Deadline>` | All scraped deadline objects |
| `doneIds` | `Array<string>` | IDs of completed deadlines |
| `autolabUrls` | `Array<{url, source, ispaceCourse?, ispaceId?}>` | Configured Autolab URLs |

### Requirements

- Google Chrome (or any Chromium-based browser)
- Campus VPN connection to access Autolab (`172.31.12.111`)
- Logged into iSpace (`ispace.uic.edu.cn`)

### Limitations

- Autolab pages require campus network / VPN access
- Only tested with BNBU's Autolab instance and iSpace (Moodle 4.x Classic theme)
- Moodle's "Sort by courses" view is not supported (only "Sort by dates")

---

<a id="中文"></a>

## 🇨🇳 中文

### 痛点

在北师港浸大 (UIC)，OOP 等课程的作业需要在 **Autolab**（`http://172.31.12.111`）上提交，但截止日期**不会显示**在 iSpace (Moodle) 主页的 Timeline 里。你需要手动去 Autolab 查看 DDL —— 很容易漏掉。

### 解决方案

这个 Chrome 扩展自动从 Autolab 抓取截止日期，**直接注入到 iSpace 原生 Timeline 里**，按时间排序，和其他作业混排在一起。看起来就像 Moodle 自带的功能。

### 功能

- **自动检测 Autolab URL** — 访问 iSpace 课程页面时自动识别页面上的 Autolab 链接并保存
- **手动配置 URL** — 在弹窗里手动添加 Autolab 课程地址，支持多个课程
- **一键同步** — Dashboard 的 Timeline 标题旁有粉色 "Sync" 按钮
- **原生 Timeline 融合** — 注入的条目完全复刻 Moodle 原生 DOM 结构和样式
- **按时间排序** — Autolab DDL 插入到正确的日期分组里，不是堆在底部
- **标记完成** — 每条 DDL 右侧有绿色 ✓ 按钮，完成后归档，不再显示在 Timeline
- **课程绑定** — 每个 Autolab URL 记住是从哪个 iSpace 课程检测到的
- **同时抓取 iSpace 日期** — 也会提取 Moodle 原生显示的 Due 日期
- **过期提醒** — 过期条目显示红色 "Overdue" 标签
- **弹窗管理** — 三个标签页：未完成 DDL、Autolab 地址配置、已完成归档
- **隐私安全** — 所有数据存储在浏览器本地（`chrome.storage.local`），不上传任何服务器

### 安装

1. 下载或 clone 本仓库
2. Chrome 打开 `chrome://extensions/`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择 `dist/` 文件夹

### 使用方法

#### 首次配置

1. **连接校园 VPN**（访问 `172.31.12.111` 需要）
2. 进入 iSpace 课程页面（如 `ispace.uic.edu.cn/course/view.php?id=7983`）
3. 插件自动检测页面上的 Autolab 地址并保存到配置
4. 点击右下角 **"从 Autolab 同步 DDL"** 浮动按钮

#### 日常使用

1. 打开 iSpace 主页（`ispace.uic.edu.cn/my/`）
2. 点击 Timeline 标题旁的粉色 **Sync** 按钮
3. Autolab 的截止日期出现在 Timeline 里，按日期排序
4. 做完作业后点 **✓** 标记完成

#### 管理 Autolab 地址

- 点击扩展图标 → **Autolab 配置** 标签页
- 自动检测到的 URL 显示蓝色 "自动" 标签和来源课程名
- 手动输入框可以添加新地址（如 `http://172.31.12.111/courses/comp2013-oop-d`）
- 点 × 删除不需要的地址

### 技术架构

```
┌─ iSpace 课程页面 ─────────────────────────────────┐
│  content-course.js                                 │
│  ├── 抓取页面上显示的 Moodle Due 日期                │
│  ├── 检测 Autolab URL → 存入配置                    │
│  └── 浮动按钮：同步 Autolab DDL                     │
└────────────────────────────────────────────────────┘
        │ chrome.runtime.sendMessage('FETCH_URL')
        ▼
┌─ Background Service Worker ───────────────────────┐
│  background.js                                     │
│  ├── fetch() Autolab 页面（绕过 CORS）              │
│  └── 图标角标：显示即将到期数量                       │
└────────────────────────────────────────────────────┘
        │ 返回 HTML
        ▼
┌─ iSpace 主页 (/my/) ──────────────────────────────┐
│  content-dashboard.js                              │
│  ├── 等待 Moodle AJAX Timeline 渲染完成             │
│  ├── 解析原生日期分组 DOM 结构                       │
│  ├── 将 DDL 注入到对应日期位置                       │
│  ├── Timeline 标题旁粉色 "Sync" 按钮               │
│  └── ✓ 完成按钮 → 归档到 doneIds                    │
└────────────────────────────────────────────────────┘

┌─ 弹窗 ────────────────────────────────────────────┐
│  popup.html / popup.js                             │
│  ├── 标签页 1：未完成 DDL + 标记完成                 │
│  ├── 标签页 2：Autolab URL 配置（自动 + 手动）       │
│  └── 标签页 3：已完成归档 + 撤销                     │
└────────────────────────────────────────────────────┘
```

### 注意事项

- 访问 Autolab 需要校园网或 VPN
- 仅在北师港浸大的 Autolab 和 iSpace（Moodle 4.x Classic 主题）上测试过
- 目前只支持 Timeline 的 "Sort by dates" 视图

---

<div align="center">
<sub>Built with frustration of missing Autolab deadlines 🕐</sub>
</div>
