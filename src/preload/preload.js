'use strict';
/**
 * 预加载脚本：在隔离上下文中暴露安全的 API 给渲染进程
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('CM', {
  /* 数据 */
  readDB: () => ipcRenderer.invoke('db:read'),
  writeDB: (db) => ipcRenderer.invoke('db:write', db),
  dbPath: () => ipcRenderer.invoke('db:path'),

  /* Excel */
  openExcel: () => ipcRenderer.invoke('dialog:openExcel'),
  parseExcel: (files) => ipcRenderer.invoke('excel:parse', files),
  buildXlsx: (sheets) => ipcRenderer.invoke('export:buildXlsx', { sheets }),
  saveBuffer: (payload) => ipcRenderer.invoke('export:save', payload),
  exportHtml: (payload) => ipcRenderer.invoke('export:buildSeatHtml', payload),
  printPdf: (payload) => ipcRenderer.invoke('print:html', payload),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),

  /* 授权（客户端仅可校验，签发能力由销售方注册机承担） */
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseActivate: (payload) => ipcRenderer.invoke('license:activate', payload),
  licenseTrial: () => ipcRenderer.invoke('license:trial'),
  licenseApplyCode: (payload) => ipcRenderer.invoke('license:applyCode', payload),
  licenseReset: () => ipcRenderer.invoke('license:reset'),

  /* 系统 */
  sysInfo: () => ipcRenderer.invoke('sys:info'),
  openDataDir: () => ipcRenderer.invoke('sys:openDataDir'),
  openExternal: (url) => ipcRenderer.invoke('sys:openExternal', url),
  saveTextDialog: (payload) => ipcRenderer.invoke('sys:saveDialog', payload),
  openTextDialog: (payload) => ipcRenderer.invoke('sys:openDialog', payload),
  openPath: (p) => ipcRenderer.invoke('sys:openPath', p),

  /* 局域网通信 / 飞鸽传书 */
  lanStart: (payload) => ipcRenderer.invoke('lan:start', payload),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanSetName: (name) => ipcRenderer.invoke('lan:setName', name),
  lanChat: (peerId, text) => ipcRenderer.invoke('lan:chat', peerId, text),
  lanSendFile: (peerId, filePath) => ipcRenderer.invoke('lan:sendFile', peerId, filePath),
  lanSendFolder: (peerId, dirPath) => ipcRenderer.invoke('lan:sendFolder', peerId, dirPath),
  lanPickFile: () => ipcRenderer.invoke('lan:pickFile'),
  lanPickFolder: () => ipcRenderer.invoke('lan:pickFolder'),
  lanAddPeer: (ip) => ipcRenderer.invoke('lan:addPeer', ip),
  lanOpenIncoming: () => ipcRenderer.invoke('lan:openIncoming'),
  lanRescan: () => ipcRenderer.invoke('lan:rescan'),

  /* 飞鸽传书：拖拽发送 —— 取拖入 File 对象的真实磁盘路径（Electron 33 已移除 File.path） */
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; }
  },

  /* 飞鸽传书：新消息提醒（通知 / 窗口置前 / 任务栏闪烁） */
  lanNotify: (payload) => ipcRenderer.invoke('lan:notify', payload),
  lanAlertOff: () => ipcRenderer.invoke('lan:alertOff'),
  lanAutoLaunchGet: () => ipcRenderer.invoke('lan:autoLaunchGet'),
  lanAutoLaunchSet: (on) => ipcRenderer.invoke('lan:autoLaunchSet', on),

  /* 飞鸽传书：聊天记录持久化 + 离线隐藏时长 + 关闭行为 设置 */
  lanLoadChats: () => ipcRenderer.invoke('lan:loadChats'),
  lanSaveChats: (peerId, list) => ipcRenderer.invoke('lan:saveChats', peerId, list),
  lanSetRetention: (value) => ipcRenderer.invoke('lan:setRetention', value),
  lanSetOfflineKeep: (keep) => ipcRenderer.invoke('lan:setOfflineKeep', keep),
  lanSetCloseToTray: (on) => ipcRenderer.invoke('lan:setCloseToTray', on),

  /* 飞鸽传书：文件传输记录持久化 */
  lanLoadFiles: () => ipcRenderer.invoke('lan:loadFiles'),
  lanSaveFiles: (files) => ipcRenderer.invoke('lan:saveFiles', files),
  lanOn: (event, cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  }
});
