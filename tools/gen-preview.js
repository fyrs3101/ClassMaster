'use strict';
/**
 * 把 shots/*.png 生成为单文件界面预览页（base64 内嵌，双击即可浏览）。
 * 用法: node tools/gen-preview.js
 */
const fs = require('fs');
const path = require('path');

const SHOTS = path.join(__dirname, '..', 'shots');
const OUT = process.argv[2] || '/workspace/班级智管-ClassMaster/界面预览.html';

const TITLES = {
  '00-dashboard-empty': '首次启动 · 空白工作台',
  '01-dashboard': '工作台 · 班级数据总览',
  '02-import-step1': '导入向导 · 第 1 步 选择数据源',
  '03-import-step2': '导入向导 · 第 2 步 解析确认',
  '04-import-step3': '导入向导 · 第 3 步 导入完成',
  '05-students': '学生管理 · 名单与层次标签',
  '06-settings-avatar': '设置 · 个人资料与自定义头像',
  '06-student-profile': '学生画像 · 个人成绩与雷达图',
  '07-dashboard-avatar': '工作台 · 侧边栏教师头像',
  '07-student-edit': '学生管理 · 编辑学生',
  '08-grades-overview': '成绩分析 · 班级总览',
  '09-grades-subjects': '成绩分析 · 学科详情',
  '10-grades-trend': '成绩分析 · 趋势对比',
  '11-grades-compare': '成绩分析 · 学生对比',
  '12-seating-empty': '智能排座 · 初始状态',
  '13-seating-grouped': '智能排座 · 一键均衡分组（2优2中2困）',
  '14-seating-classroom': '智能排座 · 教室座位图',
  '15-seat-capacity-warn': '智能排座 · 容量预警',
  '16-points-board': '积分管理 · 记分面板',
  '17-points-dialog': '积分管理 · 1-6 分记分弹窗',
  '18-points-rank': '积分管理 · 积分排行榜',
  '19-points-rules': '积分管理 · 规则配置',
  '20-points-records': '积分管理 · 流水记录',
  '21-membership': '会员中心 · 三档定价',
  '22-license-key': '会员中心 · 激活码签发',
  '23-settings': '设置 · 班级信息与备份',
  '24-light-dashboard': '浅色主题 · 工作台',
  '25-light-seating': '浅色主题 · 智能排座'
};

const files = fs.readdirSync(SHOTS).filter(f => f.endsWith('.png')).sort();
if (!files.length) { console.error('shots 目录为空'); process.exit(1); }

const cards = files.map(f => {
  const name = f.replace(/\.png$/, '');
  const title = TITLES[name] || name;
  const b64 = fs.readFileSync(path.join(SHOTS, f)).toString('base64');
  return '<figure class="shot"><img loading="lazy" src="data:image/png;base64,' + b64 + '" alt="' + title + '"><figcaption>' + title + '</figcaption></figure>';
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>班级智管-鸿升周老师 · 界面预览</title>
<style>
:root{--bg:#070b16;--card:#0d1220;--line:#263149;--txt:#cbd5e9;--sub:#8f9db8;--brand:#3b5ce8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding:34px 4vw 60px}
header{text-align:center;margin-bottom:30px}
header h1{font-size:24px;color:#f1f5ff;letter-spacing:.5px}
header p{color:var(--sub);font-size:13.5px;margin-top:8px;line-height:1.9}
.grid{columns:2 640px;column-gap:20px;max-width:1500px;margin:0 auto}
.shot{break-inside:avoid;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:20px;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.shot img{width:100%;display:block}
.shot figcaption{padding:11px 15px;font-size:13px;font-weight:600;color:var(--txt);border-top:1px solid var(--line);letter-spacing:.3px}
.foot{text-align:center;color:var(--sub);font-size:12px;margin-top:26px;line-height:2}
</style>
</head>
<body>
<header>
  <h1>班级智管-鸿升周老师 · 界面预览</h1>
  <p>共 ${files.length} 张截图 · 实际运行画面（深色 / 浅色主题、导入向导、成绩分析、智能排座、积分管理、会员中心、自定义头像）</p>
</header>
<div class="grid">
${cards}
</div>
<div class="foot">班级智管-鸿升周老师（ClassMaster）· 本页面图片已内嵌，可直接发送给客户浏览</div>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log('PREVIEW_OK ' + OUT + ' ' + (fs.statSync(OUT).size / 1048576).toFixed(2) + 'MB, ' + files.length + ' shots');
