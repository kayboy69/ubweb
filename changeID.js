// ==UserScript==
// @name         UBWEB 批量设置设备ID (v4.0 艺术美化版)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  顶级 UI 美化，保留点击行选中与动态设备同步，底层拦截极速执行
// @author       Gemini
// @match        *://ubweb.johnnycdn.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kayboy69/ubweb/refs/heads/main/changeID.js
// @downloadURL  https://raw.githubusercontent.com/kayboy69/ubweb/refs/heads/main/changeID.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 【变量定义】 ---
    let taskDataPool = new Map();
    let deviceMap = new Map();
    let capturedToken = localStorage.getItem('captured_auth_token') || '';
    let isProcessing = false;

    // --- 【底层网络拦截】 ---
    function parseResponseData(data) {
        if (!data) return;
        let list = data.data || data.items || data.records || (Array.isArray(data) ? data : []);
        if (!Array.isArray(list)) return;
        list.forEach(item => {
            if (item && item.id) {
                const key = `${(item.webSite||'').trim()}||${(item.chsName||'').trim()}||${(item.season||'').trim()}`;
                taskDataPool.set(key, item);
            }
        });
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const opts = args[1];
        if (opts && opts.headers) {
            const h = opts.headers;
            let auth = (h instanceof Headers) ? h.get('authorization') : (h['authorization'] || h['Authorization']);
            if (auth && auth.length > 20) {
                capturedToken = auth;
                localStorage.setItem('captured_auth_token', auth);
                updateAuthBadge();
            }
        }
        const response = await originalFetch.apply(this, args);
        if (typeof args[0] === 'string' && args[0].includes('/api/')) {
            response.clone().json().then(parseResponseData).catch(() => {});
        }
        return response;
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        this.addEventListener('load', function() {
            if (this.responseURL && this.responseURL.includes('/api/')) {
                try { parseResponseData(JSON.parse(this.responseText)); } catch (e) {}
            }
        });
        return originalXhrOpen.apply(this, arguments);
    };

    const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (header.toLowerCase() === 'authorization') {
            capturedToken = value;
            localStorage.setItem('captured_auth_token', value);
            updateAuthBadge();
        }
        return originalSetHeader.apply(this, arguments);
    };

    // --- 【设备同步逻辑】 ---
    function syncDeviceListFromUI() {
        document.querySelectorAll('.el-select-dropdown__item').forEach(li => processDeviceText(li.innerText.trim()));
        document.querySelectorAll('.el-select').forEach(el => {
            try {
                const key = Object.keys(el).find(k => k.startsWith('__vue') || k.startsWith('__vnode'));
                const options = el[key]?.props?.options || el[key]?.setupState?.options;
                if (Array.isArray(options)) options.forEach(opt => processDeviceText(opt.label || opt.name || opt.value, opt.value));
            } catch (e) {}
        });
    }

    function processDeviceText(text, fallbackId) {
        if (!text || text === "全部" || text.includes("在下(")) return;
        let id = fallbackId || "";
        if (text === "暂不下载") id = "1";
        else {
            const match = text.match(/([a-f0-9-]{30,})/i);
            if (match) id = match[1];
        }
        if (id && !deviceMap.has(id)) {
            deviceMap.set(id, text);
            updateDeviceDropdownUI();
        }
    }

    function updateDeviceDropdownUI() {
        const select = document.getElementById('target-device-id');
        if (!select) return;
        const current = select.value;
        let html = '<option value="" disabled selected>请选择目标设备</option>';
        deviceMap.forEach((name, id) => {
            html += `<option value="${id}">${name}</option>`;
        });
        select.innerHTML = html;
        select.value = current;
    }

    // --- 【UI 极致美化】 ---
    function injectStyles() {
        if (document.getElementById('tm-premium-styles')) return;
        const style = document.createElement('style');
        style.id = 'tm-premium-styles';
        style.innerHTML = `
            #batch-setter-panel {
                margin-left: 20px;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                padding: 6px 12px;
                background: linear-gradient(145deg, #f8faff, #ffffff);
                border: 1px solid #dcdfe6;
                border-radius: 8px;
                box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05);
                vertical-align: middle;
                transition: all 0.3s;
            }
            .batch-select {
                height: 32px;
                border-radius: 6px;
                border: 1px solid #409eff;
                padding: 0 10px;
                font-size: 13px;
                background: white;
                color: #409eff;
                font-weight: 500;
                outline: none;
                cursor: pointer;
            }
            .batch-btn {
                height: 32px;
                padding: 0 15px;
                font-weight: 600 !important;
                border-radius: 6px !important;
                transition: all 0.2s !important;
            }
            .batch-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
            .batch-btn:active { transform: translateY(0); }

            #api-status { font-size: 13px; color: #606266; margin-left: 5px; font-weight: bold; }
            .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
            .dot-red { background: #f56c6c; box-shadow: 0 0 5px #f56c6c; }
            .dot-green { background: #67c23a; box-shadow: 0 0 5px #67c23a; }

            /* 列表交互美化 */
            .el-table__row { cursor: pointer !important; transition: background 0.3s !important; }
            .tm-selected td { background-color: #ecf5ff !important; position: relative; }
            .tm-selected td:first-child::before {
                content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #409eff; border-radius: 0 2px 2px 0; animation: glow 1.5s infinite;
            }
            .tm-success td { background-color: #f0f9eb !important; opacity: 0.6; transition: opacity 1s; }
            .tm-error td { background-color: #fef0f0 !important; border: 1px solid #f56c6c; }

            @keyframes glow { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
            @keyframes pulse-text { 0% { color: #409eff; } 50% { color: #67c23a; } 100% { color: #409eff; } }
            .processing-text { animation: pulse-text 1s infinite; }
        `;
        document.head.appendChild(style);
    }

    function updateAuthBadge() {
        const badge = document.getElementById('auth-badge');
        if (!badge) return;
        const isOk = capturedToken || localStorage.getItem('captured_auth_token');
        badge.className = `status-dot ${isOk ? 'dot-green' : 'dot-red'}`;
        badge.title = isOk ? '鉴权已就绪 (Token OK)' : '等待鉴权 (请刷新或进行搜索)';
    }

    function initUI() {
        const actionBar = document.querySelector('.action-bar');
        if (!actionBar || document.getElementById('batch-setter-panel')) return;

        injectStyles();
        const panel = document.createElement('div');
        panel.id = 'batch-setter-panel';
        panel.innerHTML = `
            <span id="auth-badge" class="status-dot dot-red"></span>
            <select id="target-device-id" class="batch-select"></select>
            <button id="toggle-select-all" class="el-button el-button--default el-button--small batch-btn">全选</button>
            <button id="start-api-batch" class="el-button el-button--primary el-button--small batch-btn">批量闪电执行</button>
            <span id="api-status">点击行选中</span>
        `;
        actionBar.appendChild(panel);

        updateDeviceDropdownUI();
        updateAuthBadge();
        document.getElementById('start-api-batch').onclick = runApiBatch;
        document.getElementById('toggle-select-all').onclick = () => {
            const rows = document.querySelectorAll('tr.el-table__row');
            const allSelected = Array.from(rows).every(r => r.classList.contains('tm-selected'));
            rows.forEach(r => allSelected ? r.classList.remove('tm-selected') : r.classList.add('tm-selected'));
            updateSelectionStatus();
        };
    }

    function updateSelectionStatus() {
        const count = document.querySelectorAll('tr.el-table__row.tm-selected').length;
        const status = document.getElementById('api-status');
        if (status) {
            status.innerHTML = count > 0 ? `已选中 <span style="color:#409eff">${count}</span> 项` : '点击行选中';
            status.classList.remove('processing-text');
        }
    }

    document.addEventListener('click', (e) => {
        const row = e.target.closest('tr.el-table__row');
        if (!row || e.target.closest('button, a, input, select')) return;
        row.classList.toggle('tm-selected');
        updateSelectionStatus();
    }, true);

    // --- 【执行逻辑】 ---
    async function runApiBatch() {
        if (isProcessing) return;
        const targetId = document.getElementById('target-device-id').value;
        if (!targetId) return alert('请先选择一个目标设备');

        let token = capturedToken || localStorage.getItem('captured_auth_token');
        if (!token) {
            token = prompt('🔐 未能截获 Token，请手动输入一次 Authorization：');
            if (token) { capturedToken = token; localStorage.setItem('captured_auth_token', token); updateAuthBadge(); }
            else return;
        }

        const selectedRows = Array.from(document.querySelectorAll('tr.el-table__row.tm-selected'));
        if (selectedRows.length === 0) return alert('請先点击任务行进行勾选');

        isProcessing = true;
        const status = document.getElementById('api-status');
        status.classList.add('processing-text');
        let success = 0;

        for (let i = 0; i < selectedRows.length; i++) {
            const row = selectedRows[i];
            const tds = row.querySelectorAll('td');
            const key = `${tds[0]?.innerText?.trim()}||${tds[1]?.innerText?.trim()}||${tds[2]?.innerText?.trim()}`;
            const rawData = taskDataPool.get(key);

            if (!rawData) { row.classList.add('tm-error'); continue; }

            status.innerText = `处理中: ${i+1}/${selectedRows.length}`;
            try {
                const payload = JSON.parse(JSON.stringify(rawData));
                payload.executorDevice = targetId;
                const response = await fetch(`/api/tasks/${rawData.id}`, {
                    method: "PUT",
                    headers: {
                        "accept": "application/json",
                        "authorization": token.startsWith('Bearer') ? token : `Bearer ${token}`,
                        "content-type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    success++;
                    row.classList.remove('tm-selected');
                    row.classList.add('tm-success');
                } else { row.classList.add('tm-error'); }
            } catch (e) { row.classList.add('tm-error'); }
            await new Promise(r => setTimeout(r, 50));
        }

        status.innerHTML = `🚀 全部完成！成功 ${success} 条`;
        status.classList.remove('processing-text');
        isProcessing = false;
        if (success > 0) setTimeout(() => { if(confirm('批量修改已完成。是否立即刷新同步数据？')) location.reload(); }, 600);
    }

    // 高频扫描
    setInterval(() => {
        if (!isProcessing) {
            initUI();
            syncDeviceListFromUI();
        }
    }, 1000);

})();
