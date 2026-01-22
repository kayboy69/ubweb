// ==UserScript==
// @name         全能流媒体 ID & 链接提取工具 (Ultimate v3.4 Pro Fix)
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  深度修复芒果TV等站点的拖拽粘滞问题。支持 B站, Netflix, Disney+, 腾讯, 优酷, 爱奇艺, 芒果, LINE TV 等。
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
// ==/UserScript==

(function() {
    'use strict';

    let lastUrl = location.href;
    let currentContent = '';

    // 1. 创建悬浮窗
    const btn = document.createElement('div');
    btn.id = 'media-id-fetcher';
    btn.innerHTML = '正在扫描...';

    // 读取位置：如果没存过，默认 150, 20
    const savedTop = GM_getValue('btn_top', '150px');
    const savedLeft = GM_getValue('btn_left', null);

    Object.assign(btn.style, {
        position: 'fixed',
        top: savedTop,
        left: savedLeft,
        right: savedLeft ? 'auto' : '20px',
        zIndex: '2147483647', // 使用 32 位整数最大值，确保在芒果TV最顶层
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
        touchAction: 'none' // 禁止移动端默认滚动，优化拖拽
    });
    document.body.appendChild(btn);

    // 2. 增强型拖拽逻辑 (防止粘滞)
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

        // 使用捕获阶段 (true)，抢在网页原生脚本前拦截事件
        window.addEventListener('pointermove', doDrag, true);
        window.addEventListener('pointerup', stopDrag, true);
    };

    const doDrag = (e) => {
        if (!isDragging) return;
        e.stopImmediatePropagation(); // 阻止芒果TV脚本捕获此移动

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newX = initialX + dx;
        let newY = initialY + dy;

        // 边界检查
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

        // 保存位置
        GM_setValue('btn_top', btn.style.top);
        GM_setValue('btn_left', btn.style.left);

        window.removeEventListener('pointermove', doDrag, true);
        window.removeEventListener('pointerup', stopDrag, true);

        // 如果移动距离极小，判定为点击
        if (moveDist < 6) {
            handleCopy();
        }
    };

    btn.addEventListener('pointerdown', startDrag);

    // 3. 提取逻辑 (包含各平台适配)
    function getIdentifier() {
        const url = new URL(window.location.href);
        const path = url.pathname;
        const search = url.searchParams;

        // Bilibili
        if (url.hostname.includes('bilibili.tv')) {
            const m = path.match(/\/play\/\d+\/(\d+)/);
            return m ? 'ep' + m[1] : null;
        }
        if (url.hostname.includes('bilibili.com')) {
            const m = path.match(/\/(ep\d+)/);
            return m ? m[1] + '_tv' : null;
        }
        // 芒果 TV
        if (url.hostname.includes('mgtv.com')) {
            const m = path.match(/\/b\/(\d+)/);
            return m ? m[1] : null;
        }
        // 爱奇艺
        if (url.hostname.includes('iqiyi.com')) {
            const m = path.match(/\/(v_[^\.]+)\.html/);
            return m ? m[1] : null;
        }
        if (url.hostname.includes('iq.com')) {
            const m = path.match(/-([a-z0-9]+)$/i);
            return m ? m[1] : null;
        }
        // 腾讯/优酷/Netflix/Disney
        if (url.hostname.includes('v.qq.com')) return path.match(/\/cover\/([^\/]+)/)?.[1];
        if (url.hostname.includes('v.youku.com')) return path.match(/\/id_([^\.]+)\.html/)?.[1];
        if (url.hostname.includes('netflix.com')) return search.get('jbv');
        if (url.hostname.includes('disneyplus.com')) return path.match(/entity-[a-f0-9-]+/)?.[0];
        // 其他
        if (url.hostname.includes('linetv.tw')) return path.match(/\/drama\/(\d+)/)?.[1];
        if (url.hostname.includes('mytvsuper.com')) return path.match(/_(\d+)\//)?.[1];
        if (url.hostname.includes('now.com')) {
            const id = search.get('id'), t = search.get('type');
            return (id && t) ? `${url.origin}${url.pathname}?id=${id}&type=${t}` : null;
        }
        // 完整链接平台
        if ((url.hostname.includes('viu.com') && path.includes('/vod/')) ||
            (url.hostname.includes('myvideo.net.tw') && path.includes('details')) ||
            (url.hostname.includes('hamivideo.hinet.net') && path.includes('product')) ||
            (url.hostname.includes('friday.tw') && path.includes('detail'))) return window.location.href;

        return null;
    }

    // 4. UI 刷新
    function refreshUI() {
        const content = getIdentifier();
        if (content) {
            currentContent = content;
            const isUrl = content.startsWith('http');
            let displayCode = isUrl ? (content.split('?')[0].split('/').filter(Boolean).pop()) : content;
            if (displayCode && displayCode.length > 15) displayCode = displayCode.substring(0, 12) + '...';

            btn.innerHTML = `<div style="margin-bottom:4px; font-size:11px; color:#aaa;">${isUrl ? '复制链接' : '复制 ID'}</div><code style="color:#ffd700; background:#000; padding:2px 4px; border-radius:4px; font-size:10px; display:block;">${displayCode || 'LINK'}</code>`;
            btn.style.borderLeft = '4px solid #E50914';
        } else {
            currentContent = '';
            btn.innerHTML = '<span style="color:#666;">未检测到目标</span>';
            btn.style.borderLeft = '4px solid #444';
        }
    }

    // 5. 执行复制
    function handleCopy() {
        if (currentContent) {
            GM_setClipboard(currentContent);
            const oldHTML = btn.innerHTML;
            btn.innerHTML = '<div style="color:#28a745; margin-top:5px;">✅ 已复制</div>';
            setTimeout(() => { btn.innerHTML = oldHTML; }, 1200);
        }
    }

    setInterval(() => {
        if (lastUrl !== location.href) {
            lastUrl = location.href;
            refreshUI();
        }
    }, 500);

    refreshUI();
})();
