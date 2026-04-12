// ═══════════════════════════════════════════════════════
// anyom.js — Community page logic for JustBratt
// ═══════════════════════════════════════════════════════

// ── Canvas brat renderer (inline, self-contained) ───────────────────────────

function bratRender(canvas, text, bgColor = '#ffffff', textColor = '#000000') {
    const SIZE = canvas.width;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return;

    const margin = 45;
    const maxWidth = SIZE - margin * 2;
    const maxHeight = SIZE - margin * 2;

    let fontSize = 140;
    let rows = [];
    let lineHeight;

    while (fontSize > 12) {
        ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
        lineHeight = fontSize * 1.05;
        rows = [];
        let cur = [], curW = 0, tooWide = false;

        for (const w of words) {
            const ww = ctx.measureText(w).width;
            if (ww > maxWidth) { tooWide = true; break; }
            const sp = ctx.measureText(' ').width;
            if (cur.length === 0) { cur.push(w); curW = ww; }
            else if (curW + sp + ww > maxWidth) { rows.push(cur); cur = [w]; curW = ww; }
            else { cur.push(w); curW += sp + ww; }
        }
        if (!tooWide && cur.length) rows.push(cur);
        if (!tooWide && rows.length * lineHeight <= maxHeight) break;
        fontSize -= 2;
    }

    let y = (SIZE - rows.length * lineHeight) / 2 + fontSize / 2;
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;

    for (const row of rows) {
        const rowText = row.join(' ');
        const rowW = ctx.measureText(rowText).width;
        let x = (SIZE - rowW) / 2;

        const jx = (Math.random() - 0.5) * 8;
        const jy = (Math.random() - 0.5) * 6;

        ctx.save();
        ctx.filter = 'blur(1.2px)';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (const w of row) {
            const ww = ctx.measureText(w).width;
            ctx.fillText(w, x + jx + (Math.random() - 0.5) * 4, y + jy + (Math.random() - 0.5) * 4);
            x += ww + ctx.measureText(' ').width;
        }
        ctx.restore();
        y += lineHeight;
    }
}

// ── State ────────────────────────────────────────────────────────────────────

let composerBg = '#ffffff';
let composerText = '#000000';
let currentCommentPostId = null;
let currentCommentCanvas = null;
let feedOffset = 0;
const PAGE_SIZE = 10;
let isFeedLoading = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const composerCanvas = document.getElementById('composerCanvas');
const communityText = document.getElementById('communityText');
const charCount = document.getElementById('charCount');
const authorName = document.getElementById('authorName');
const postBtn = document.getElementById('postCommunityBtn');
const communityFeed = document.getElementById('communityFeed');
const refreshBtn = document.getElementById('refreshFeedBtn');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const shareToast = document.getElementById('shareToast');
const commentModal = document.getElementById('commentModal');
const commentsList = document.getElementById('commentsList');
const commentNameInput = document.getElementById('commentNameInput');
const commentTextInput = document.getElementById('commentTextInput');
const submitCommentBtn = document.getElementById('submitCommentBtn');
const closeCommentModal = document.getElementById('closeCommentModal');
const commentPreviewCanvas = document.getElementById('commentPreviewCanvas');
const commentPostText = document.getElementById('commentPostText');

// ── Composer live preview ─────────────────────────────────────────────────────

function updateComposerPreview() {
    const text = communityText.value.trim() || 'your text...';
    bratRender(composerCanvas, text, composerBg, composerText);
}

communityText.addEventListener('input', () => {
    const len = communityText.value.length;
    charCount.textContent = `${len} / 300`;
    updateComposerPreview();
});

// Preset buttons
document.querySelectorAll('.anyom-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        composerBg = btn.dataset.bg;
        composerText = btn.dataset.text;
        document.querySelectorAll('.anyom-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateComposerPreview();
    });
});

// Initial preview
updateComposerPreview();

// ── Post to Community ─────────────────────────────────────────────────────────

postBtn.addEventListener('click', async () => {
    const text = communityText.value.trim();
    if (!text) { flashInput(communityText); return; }

    postBtn.disabled = true;
    postBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Posting...';

    const theme = JSON.stringify({ bg: composerBg, text: composerText });
    const author = authorName.value.trim() || 'anonim';

    try {
        const res = await fetch('/api/community/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, author_name: author, theme }),
        });

        if (!res.ok) throw new Error('Server error');
        const data = await res.json();

        // Clear composer
        communityText.value = '';
        charCount.textContent = '0 / 300';
        updateComposerPreview();

        // Show toast animation
        showShareToast();

        // Prepend card to feed
        const card = buildCard(data);
        if (communityFeed.querySelector('.feed-loading') || communityFeed.querySelector('.feed-empty')) {
            communityFeed.innerHTML = '';
        }
        communityFeed.prepend(card);
        renderCardCanvas(card, data);

    } catch (e) {
        alert('gagal post, coba lagi ya 😭');
        console.error(e);
    }

    postBtn.disabled = false;
    postBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Post to Community';
});

// ── Toast ─────────────────────────────────────────────────────────────────────

function showShareToast() {
    shareToast.classList.remove('hidden');
    // Force reflow
    shareToast.offsetHeight;
    shareToast.classList.add('show');
    setTimeout(() => {
        shareToast.classList.remove('show');
        setTimeout(() => shareToast.classList.add('hidden'), 500);
    }, 2400);
}

// ── Flash input red if empty ──────────────────────────────────────────────────

function flashInput(el) {
    el.style.borderColor = '#e53e3e';
    el.style.boxShadow = '0 0 0 3px rgba(229, 62, 62, 0.15)';
    el.focus();
    setTimeout(() => {
        el.style.borderColor = '';
        el.style.boxShadow = '';
    }, 1200);
}

// ── Feed loading ──────────────────────────────────────────────────────────────

async function loadFeed(reset = false) {
    if (isFeedLoading) return;
    isFeedLoading = true;

    if (reset) {
        feedOffset = 0;
        communityFeed.innerHTML = `
            <div class="feed-loading">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                loading posts...
            </div>`;
        loadMoreBtn.classList.add('hidden');
    }

    try {
        const res = await fetch(`/api/community/posts?limit=${PAGE_SIZE}&offset=${feedOffset}`);
        const data = await res.json();
        const posts = data.posts || [];

        if (reset) communityFeed.innerHTML = '';

        if (posts.length === 0 && feedOffset === 0) {
            communityFeed.innerHTML = `
                <div class="feed-empty">
                    <i class="fa-solid fa-comment-slash"></i>
                    <span>no posts yet.<br>be the first to drop something!</span>
                </div>`;
            loadMoreBtn.classList.add('hidden');
        } else {
            posts.forEach((post, i) => {
                const card = buildCard(post);
                // Stagger offset for animation
                card.style.animationDelay = `${i * 0.05}s`;
                communityFeed.appendChild(card);
                renderCardCanvas(card, post);
            });

            feedOffset += posts.length;
            if (posts.length === PAGE_SIZE) {
                loadMoreBtn.classList.remove('hidden');
            } else {
                loadMoreBtn.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('[feed]', e);
        if (feedOffset === 0) {
            communityFeed.innerHTML = `
                <div class="feed-empty">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>gagal load feed 😭<br>refresh ya</span>
                </div>`;
        }
    }

    isFeedLoading = false;
}

// ── Build card HTML ───────────────────────────────────────────────────────────

function buildCard(post) {
    const div = document.createElement('div');
    div.className = 'feed-card';
    div.dataset.postId = post.id;

    const author = post.author_name || 'anonim';
    const time = timeAgo(post.created_at);
    const commentCount = post.comment_count ?? '';
    const commentLabel = commentCount !== '' ? `(${commentCount})` : '';

    div.innerHTML = `
        <div class="card-canvas-wrap">
            <canvas class="card-canvas" width="512" height="512" data-text="${escapeAttr(post.text)}" data-bg="${escapeAttr(getBg(post))}" data-textcolor="${escapeAttr(getTextColor(post))}"></canvas>
        </div>
        <div class="card-body">
            <div class="card-meta">
                <div class="card-author">
                    <i class="fa-solid fa-user-secret"></i>
                    ${escapeHtml(author)}
                </div>
                <div class="card-time">${time}</div>
            </div>
            <div class="card-text">${escapeHtml(post.text)}</div>
            <div class="card-actions">
                <button class="card-action-btn comment-action-btn" data-post-id="${post.id}">
                    <i class="fa-solid fa-comment"></i> komentar ${commentLabel}
                </button>
                <button class="card-action-btn wa-action wa-share-btn" data-post-id="${post.id}" data-text="${escapeAttr(post.text)}" data-author="${escapeAttr(author)}">
                    <i class="fa-brands fa-whatsapp"></i> share
                </button>
                <button class="card-action-btn copy-action copy-link-btn" data-post-id="${post.id}">
                    <i class="fa-solid fa-copy"></i> copy
                </button>
            </div>
        </div>`;

    // Event listeners
    div.querySelector('.comment-action-btn').addEventListener('click', () => openCommentModal(post));
    div.querySelector('.wa-share-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const text = encodeURIComponent(`"${btn.dataset.text}" — by ${btn.dataset.author} via JustBratt\n${window.location.origin}/anyom.html`);
        window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    });
    div.querySelector('.copy-link-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const url = `${window.location.origin}/anyom.html`;
        navigator.clipboard.writeText(url).catch(() => {});
        btn.classList.add('copied');
        btn.innerHTML = '<i class="fa-solid fa-check"></i> copied!';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<i class="fa-solid fa-copy"></i> copy';
        }, 1800);
    });

    return div;
}

// ── Render brat canvas inside card ───────────────────────────────────────────

function renderCardCanvas(card, post) {
    const canvas = card.querySelector('.card-canvas');
    if (!canvas) return;
    const bg = getBg(post);
    const tc = getTextColor(post);
    bratRender(canvas, post.text, bg, tc);
}

function getBg(post) {
    try { return JSON.parse(post.theme || '{}').bg || '#ffffff'; } catch { return '#ffffff'; }
}

function getTextColor(post) {
    try { return JSON.parse(post.theme || '{}').text || '#000000'; } catch { return '#000000'; }
}

// ── Comment Modal ─────────────────────────────────────────────────────────────

async function openCommentModal(post) {
    currentCommentPostId = post.id;
    commentModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Render preview canvas
    bratRender(commentPreviewCanvas, post.text, getBg(post), getTextColor(post));
    commentPostText.textContent = `"${post.text}" — ${post.author_name || 'anonim'}`;

    // Clear old
    commentNameInput.value = '';
    commentTextInput.value = '';

    // Load comments
    await loadComments(post.id);
}

closeCommentModal.addEventListener('click', closeModal);
commentModal.querySelector('.comment-modal-backdrop').addEventListener('click', closeModal);

function closeModal() {
    commentModal.classList.add('hidden');
    document.body.style.overflow = '';
    currentCommentPostId = null;
}

async function loadComments(postId) {
    commentsList.innerHTML = `
        <div class="feed-loading">
            <div class="loading-dots"><span></span><span></span><span></span></div>
        </div>`;

    try {
        const res = await fetch(`/api/community/posts/${postId}/comments`);
        const data = await res.json();
        const comments = data.comments || [];

        if (comments.length === 0) {
            commentsList.innerHTML = `<div class="no-comments">belum ada komentar. yuk mulai! 👀</div>`;
            return;
        }

        commentsList.innerHTML = '';
        comments.forEach(c => {
            const item = document.createElement('div');
            item.className = 'comment-item';
            item.innerHTML = `
                <div class="comment-author-row">
                    <span class="comment-author"><i class="fa-solid fa-user-secret"></i> ${escapeHtml(c.author_name || 'anonim')}</span>
                    <span class="comment-time">${timeAgo(c.created_at)}</span>
                </div>
                <div class="comment-body">${escapeHtml(c.comment)}</div>`;
            commentsList.appendChild(item);
        });
    } catch (e) {
        commentsList.innerHTML = `<div class="no-comments">gagal load komentar 😭</div>`;
    }
}

submitCommentBtn.addEventListener('click', async () => {
    const comment = commentTextInput.value.trim();
    if (!comment || !currentCommentPostId) return;

    const author = commentNameInput.value.trim() || 'anonim';

    submitCommentBtn.disabled = true;
    submitCommentBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const res = await fetch(`/api/community/posts/${currentCommentPostId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author_name: author, comment }),
        });

        if (!res.ok) throw new Error();

        commentTextInput.value = '';

        // Append new comment instantly
        const item = document.createElement('div');
        item.className = 'comment-item';
        item.style.animationDelay = '0s';
        item.innerHTML = `
            <div class="comment-author-row">
                <span class="comment-author"><i class="fa-solid fa-user-secret"></i> ${escapeHtml(author)}</span>
                <span class="comment-time">baru aja</span>
            </div>
            <div class="comment-body">${escapeHtml(comment)}</div>`;

        if (commentsList.querySelector('.no-comments')) {
            commentsList.innerHTML = '';
        }
        commentsList.appendChild(item);
        item.scrollIntoView({ behavior: 'smooth', block: 'end' });

        // Update comment count on card
        updateCardCommentCount(currentCommentPostId);

    } catch {
        alert('gagal kirim komentar 😭');
    }

    submitCommentBtn.disabled = false;
    submitCommentBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> send';
});

function updateCardCommentCount(postId) {
    const card = communityFeed.querySelector(`[data-post-id="${postId}"]`);
    if (!card) return;
    const btn = card.querySelector('.comment-action-btn');
    if (!btn) return;

    // Parse existing count
    const match = btn.textContent.match(/\((\d+)\)/);
    const count = match ? parseInt(match[1]) + 1 : 1;
    btn.innerHTML = `<i class="fa-solid fa-comment"></i> komentar (${count})`;
}

// ── Refresh & Load More ───────────────────────────────────────────────────────

refreshBtn.addEventListener('click', () => {
    refreshBtn.style.transform = 'rotate(360deg)';
    refreshBtn.style.transition = 'transform 0.6s ease';
    setTimeout(() => {
        refreshBtn.style.transform = '';
        refreshBtn.style.transition = '';
    }, 700);
    loadFeed(true);
});

loadMoreBtn.addEventListener('click', () => loadFeed(false));

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'baru aja';
    if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return `${Math.floor(diff / 86400)} hari lalu`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadFeed(true);
