// ==UserScript==
// @name         全能流媒体 ID & 链接提取工具 (Ultimate v3.5)
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  支持全平台 ID 提取，修复芒果TV粘滞。新增启动时版本更新检测功能。
// @author       Gemini
// @match        https://www.netflix.com/*
// @match        https://www.disneyplus.com/*
// @match        https://hamivideo.hinet.net/*
// @match        https://video.friday.tw/*
// @match        https://v.qq.com/*
// @match        https://v.youku.com/*
// @match        https://www.iqiyi.com/*
// @match        https://www.mgtv.com/*
// @match        https://nowplayer.now.com/*
// @match        https://www.iq.com/*
// @match        https://www.myvideo.net.tw/*
// @match        https://www.mewatch.sg/*
// @match        https://www.viu.com/*
// @match        https://www.linetv.tw/*
// @match        https://www.mytvsuper.com/*
// @match        https://www.bilibili.com/*
// @match        https://www.bilibili.tv/*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // 【配置：更新检查链接】
    // 如果你将脚本托管在 GitHub 或 Gitee，可以将此处替换为 Raw 文件的 URL
    const UPDATE_URL = ""; 
    const CURRENT_VERSION = GM_info.script.version;

    let lastUrl = location.href;
    let currentContent = '';

    // 1. 创建悬浮窗
    const btn = document.createElement('div');
    btn.id = 'media-id-fetcher';
    btn.innerHTML = '正在扫描...';

    const savedTop = GM_getValue('btn_top', '150px');
    const savedLeft = GM_getValue('btn_left', null);

    Object.assign(btn.style, {
        position: 'fixed',
        top: savedTop,
        left: savedLeft,
        right: savedLeft ? 'auto' : '20px',
        zIndex: '2147483647',
        padding: '12px',
        backgroundColor: 'rgba(34, 34, 34, 0.95)',
        color: '#fff',
        cursor: 'grab',
        borderRadius: '12px',
        fontWeight: 'bold',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontSize: '13px',
        border: '1px solid #555',
        userSelect: 'none',
        textAlign: 'center',
        minWidth: '145px',
        backdropFilter: 'blur(8px)',
        touchAction: 'none'
    });
    document.body.appendChild(btn);

    // 2. 自动检查更新逻辑
    function checkUpdate() {
        if (!UPDATE_URL) return; // 如果没有填地址则跳过

        GM_xmlhttpRequest({
            method: "GET",
            url: UPDATE_URL,
            onload: function(response) {
                // 假设远程返回的内容中包含 "@version 3.6" 这样的字样
                const remoteVersionMatch = response.responseText.match(/@version\s+([\d\.]+)/);
                if (remoteVersionMatch) {
                    const remoteVersion = remoteVersionMatch[1];
                    if (compareVersions(CURRENT_VERSION, remoteVersion) < 0) {
                        showUpdateNotify(remoteVersion);
                    }
                }
            }
        });
    }

    // 版本对比函数
    function compareVersions(v1, v2) {
        const a = v1.split('.').map(Number);
        const b = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((a[i] || 0) < (b[i] || 0)) return -1;
            if ((a[i] || 0) > (b[i] || 0)) return 1;
        }
        return 0;
    }

    // 显示更新提示
    function showUpdateNotify(newVer) {
        const notify = document.createElement('div');
        notify.innerHTML = `🚀 发现新版本 v${newVer}<br><span style="font-size:10px;text-decoration:underline;cursor:pointer;">点击前往更新</span>`;
        notify.style.cssText = "font-size:11px; color:#00ffcc; margin-top:8px; border-top:1px solid #444; padding-top:4px;";
        notify.onclick = (e) => {
            e.stopPropagation();
            window.open(UPDATE_URL, '_blank');
        };
        btn.appendChild(notify);
    }

    // 3. 增强型拖拽逻辑 (防止芒果TV粘滞)
    let isDragging = false;
    let startX, startY, initialX, initialY;

    const startDrag = (e) => {
        isDragging = true;
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
        startX = e.clientX;
        startY = e.clientY;
        const rect = btn.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        window.addEventListener('pointermove', doDrag, true);
        window.addEventListener('pointerup', stopDrag, true);
    };

    const doDrag = (e) => {
        if (!isDragging) return;
        e.stopImmediatePropagation();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newX = initialX + dx, newY = initialY + dy;
        newX = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newX));
        newY = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newY));
        btn.style.left = newX + 'px';
        btn.style.top = newY + 'px';
        btn.style.right = 'auto';
    };

    const stopDrag = (e) => {
        if (!isDragging) return;
        const moveDist = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));
        isDragging = false;
        btn.style.cursor = 'grab';
        GM_setValue('btn_top', btn.style.top);
        GM_setValue('btn_left', btn.style.left);
        window.removeEventListener('pointermove', doDrag, true);
        window.removeEventListener('pointerup', stopDrag, true);
        if (moveDist < 6) handleCopy();
    };

    btn.addEventListener('pointerdown', startDrag);

    // 4. 平台 ID 提取逻辑
    function getIdentifier() {
        const url = new URL(window.location.href);
        const path = url.pathname, search = url.searchParams;

        if (url.hostname.includes('bilibili.tv')) return path.match(/\/play\/\d+\/(\d+)/) ? 'ep' + path.match(/\/play\/\d+\/(\d+)/)[1] : null;
        if (url.hostname.includes('bilibili.com')) return path.match(/\/(ep\d+)/)?.[1] ? path.match(/\/(ep\d+)/)[1] + '_tv' : null;
        if (url.hostname.includes('mgtv.com')) return path.match(/\/b\/(\d+)/)?.[1];
        if (url.hostname.includes('iqiyi.com')) return path.match(/\/(v_[^\.]+)\.html/)?.[1];
        if (url.hostname.includes('iq.com')) return path.match(/-([a-z0-9]+)$/i)?.[1];
        if (url.hostname.includes('v.qq.com')) return path.match(/\/cover\/([^\/]+)/)?.[1];
        if (url.hostname.includes('v.youku.com')) return path.match(/\/id_([^\.]+)\.html/)?.[1];
        if (url.hostname.includes('netflix.com')) return search.get('jbv');
        if (url.hostname.includes('disneyplus.com')) return path.match(/entity-[a-f0-9-]+/)?.[0];
        if (url.hostname.includes('linetv.tw')) return path.match(/\/drama\/(\d+)/)?.[1];
        if (url.hostname.includes('mytvsuper.com')) return path.match(/_(\d+)\//)?.[1];
        if (url.hostname.includes('now.com')) return (search.get('id') && search.get('type')) ? `${url.origin}${url.pathname}?id=${search.get('id')}&type=${search.get('type')}` : null;
        if (url.hostname.includes('mewatch.sg')) return path.match(/-(\d+)$/)?.[1];

        // 完整链接模式
        const fullLinkSites = ['viu.com/ott/my/en/vod/', 'myvideo.net.tw/details', 'hamivideo.hinet.net/product', 'video.friday.tw/detail'];
        if (fullLinkSites.some(site => (url.hostname + path).includes(site))) return window.location.href;

        return null;
    }

    function refreshUI() {
        const content = getIdentifier();
        if (content) {
            currentContent = content;
            const isUrl = content.startsWith('http');
            let displayCode = isUrl ? (content.split('?')[0].split('/').filter(Boolean).pop()) : content;
            if (displayCode && displayCode.length > 15) displayCode = displayCode.substring(0, 12) + '...';
            btn.querySelector('div:first-child')?.remove();
            btn.querySelector('code')?.remove();
            btn.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:4px; font-size:11px; color:#aaa;">${isUrl ? '复制链接' : '复制 ID'}</div><code style="color:#ffd700; background:#000; padding:2px 4px; border-radius:4px; font-size:10px; display:block;">${displayCode || 'LINK'}</code>`);
            btn.style.borderLeft = '4px solid #E50914';
        } else {
            currentContent = '';
            btn.innerHTML = '<span style="color:#666;">未检测到目标</span>';
            btn.style.borderLeft = '4px solid #444';
        }
    }

    function handleCopy() {
        if (currentContent) {
            GM_setClipboard(currentContent);
            const oldInner = btn.innerHTML;
            btn.innerHTML = '<div style="color:#28a745; margin-top:5px;">✅ 已复制</div>';
            setTimeout(() => { 
                btn.innerHTML = '';
                refreshUI(); 
                // 如果有更新提示，重新触发检查或手动保持显示
                checkUpdate();
            }, 1200);
        }
    }

    // 启动初始化
    setInterval(() => {
        if (lastUrl !== location.href) {
            lastUrl = location.href;
            refreshUI();
        }
    }, 500);

    refreshUI();
    checkUpdate(); // 启动脚本时检查更新
})();
