require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');
// Lazy-load render module — @napi-rs/canvas is a native binary that may
// fail on some serverless platforms.  If it fails we only lose /api/sticker,
// not every other API route.
let renderStickerImage;
try {
    renderStickerImage = require('./render').renderStickerImage;
} catch (e) {
    console.warn('[server] Could not load render module (sticker API disabled):', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security: Rate Limiting (in-memory, per IP) ────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP

function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return next();
    }

    const entry = rateLimitMap.get(ip);
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        // Reset window
        entry.count = 1;
        entry.windowStart = now;
        return next();
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    }

    next();
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// ─── Security: Input Sanitization ────────────────────────────────────────────
function sanitizeText(text) {
    if (typeof text !== 'string') return '';
    // Strip any HTML/script tags to prevent XSS
    return text
        .replace(/<[^>]*>/g, '')     // Remove HTML tags
        .replace(/[<>"]/g, '')       // Remove remaining angle brackets and quotes
        .trim()
        .slice(0, 500);              // Max 500 chars
}

function isValidHexColor(color) {
    return /^#[0-9a-fA-F]{3,8}$/.test(color);
}

function isValidMode(mode) {
    return ['normal', 'animate', 'typing', 'lyrics'].includes(mode);
}

function isValidUrl(url) {
    try {
        const parsed = new URL(url);
        // Only allow http/https protocols to prevent SSRF
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        // Block private/internal IPs
        const hostname = parsed.hostname;
        if (hostname === 'localhost' || 
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.') ||
            hostname.endsWith('.local') ||
            hostname === '[::1]') {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' })); // Limit body size
app.use(express.static('public'));

// Security headers for all responses
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// CORS for API routes
app.use('/api', (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Rate limit API routes
app.use('/api', rateLimiter);

// ─── Database ────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Connected to Supabase.");
} else {
    console.error("Missing SUPABASE credentials in .env file! API will crash.");
}

function generateId() {
    return crypto.randomBytes(4).toString('hex'); // 8 characters short id
}

// Helper to format full URL
function getFullUrl(req, id) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}/${id}`;
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// Unified handler for creating a post (supports POST and GET for bot ease)
async function handleCreate(req, res) {
    const raw = (req.method === 'POST') ? req.body : req.query;
    const text = sanitizeText(raw.text);
    const mode = raw.mode;
    const theme = raw.theme;

    if (!text) {
        return res.status(400).json({ error: '`text` is required and must not be empty.' });
    }

    if (!mode || !isValidMode(mode)) {
        return res.status(400).json({ error: '`mode` is required. Must be one of: normal, animate, typing, lyrics.' });
    }

    // Validate theme if provided
    if (theme) {
        try {
            const parsed = JSON.parse(theme);
            if (parsed.bg && !isValidHexColor(parsed.bg)) {
                return res.status(400).json({ error: 'Invalid `bg` hex color in theme.' });
            }
            if (parsed.text && !isValidHexColor(parsed.text)) {
                return res.status(400).json({ error: 'Invalid `text` hex color in theme.' });
            }
        } catch {
            return res.status(400).json({ error: '`theme` must be a valid JSON string.' });
        }
    }

    const id = generateId();

    try {
        const { data, error } = await supabase
            .from('posts')
            .insert([{ id, text, mode, theme: theme || '' }]);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({
            id,
            url: getFullUrl(req, id)
        });
    } catch (err) {
        console.error('[create]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

app.post('/api/create', handleCreate);
app.get('/api/create', handleCreate);

app.get('/api/posts/:id', async (req, res) => {
    const { id } = req.params;

    // Validate ID format (should be 8 hex chars)
    if (!/^[a-f0-9]{8}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid post ID format.' });
    }

    try {
        const { data, error } = await supabase
            .from('posts')
            .select('text, mode, theme, created_at')
            .eq('id', id)
            .single();

        if (error) {
            console.error(error);
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json(data);
    } catch (err) {
        console.error('[posts]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Public recent posts endpoint
app.get('/api/recent', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('posts')
            .select('id, text, mode, created_at')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ data });
    } catch (err) {
        console.error('[recent]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Sticker API — returns a compressed JPEG image ─────────────────────────
app.get('/api/sticker', async (req, res) => {
    const {
        text,
        bg = '#ffffff',
        color = '#000000',
        imageUrl,
        opacity,
        quality,
    } = req.query;

    if (!renderStickerImage) {
        return res.status(503).json({ error: 'Sticker rendering is not available on this server.' });
    }

    if (!text || !text.trim()) {
        return res.status(400).json({ error: '`text` query parameter is required.' });
    }

    // Validate colors
    if (!isValidHexColor(bg)) {
        return res.status(400).json({ error: 'Invalid `bg` hex color.' });
    }
    if (!isValidHexColor(color)) {
        return res.status(400).json({ error: 'Invalid `color` hex color.' });
    }

    // Validate imageUrl if provided (SSRF protection)
    if (imageUrl && !isValidUrl(imageUrl)) {
        return res.status(400).json({ error: 'Invalid or disallowed `imageUrl`. Only public http/https URLs allowed.' });
    }

    const sanitizedText = sanitizeText(text);
    const imageOpacity = opacity ? Math.min(1, Math.max(0, parseInt(opacity, 10) / 100)) : 0.45;
    // Default quality is 8 (very moldy), user can override with ?quality=1-100
    const jpegQuality = quality ? Math.max(1, Math.min(100, parseInt(quality, 10))) : 8;

    try {
        const result = await renderStickerImage({
            text: sanitizedText,
            bgColor: bg,
            textColor: color,
            imageUrl: imageUrl || null,
            imageOpacity,
            quality: jpegQuality,
        });

        const ext = result.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        res.set({
            'Content-Type': result.mimeType,
            'Content-Length': result.buffer.length,
            'Cache-Control': 'public, max-age=86400',
            'Content-Disposition': `inline; filename="brat-${Date.now()}.${ext}"`,
        });
        res.send(result.buffer);
    } catch (err) {
        console.error('[sticker]', err);
        res.status(500).json({ error: 'Failed to render sticker.' });
    }
});

// ─── Community API ───────────────────────────────────────────────────────────

// GET /api/community/posts?limit=10&offset=0
app.get('/api/community/posts', async (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    try {
        const { data, error } = await supabase
            .from('community_posts')
            .select('id, text, author_name, theme, created_at')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Attach comment counts
        const postsWithCounts = await Promise.all((data || []).map(async (post) => {
            try {
                const { count } = await supabase
                    .from('community_comments')
                    .select('id', { count: 'exact', head: true })
                    .eq('post_id', post.id);
                return { ...post, comment_count: count || 0 };
            } catch {
                return { ...post, comment_count: 0 };
            }
        }));

        res.json({ posts: postsWithCounts });
    } catch (err) {
        console.error('[community/posts GET]', err);
        res.status(500).json({ error: 'Failed to load community posts: ' + (err.message || err.toString()) });
    }
});

// POST /api/community/posts
app.post('/api/community/posts', async (req, res) => {
    const text = sanitizeText(req.body.text);
    const author_name = sanitizeText(req.body.author_name || 'anonim').slice(0, 32) || 'anonim';
    const theme = req.body.theme || '';

    if (!text) return res.status(400).json({ error: '`text` is required.' });

    if (theme) {
        try {
            const parsed = JSON.parse(theme);
            if (parsed.bg && !isValidHexColor(parsed.bg)) return res.status(400).json({ error: 'Invalid bg color.' });
            if (parsed.text && !isValidHexColor(parsed.text)) return res.status(400).json({ error: 'Invalid text color.' });
        } catch {
            return res.status(400).json({ error: 'Invalid theme JSON.' });
        }
    }

    const id = generateId();
    try {
        const { data, error } = await supabase
            .from('community_posts')
            .insert([{ id, text, author_name, theme }])
            .select('id, text, author_name, theme, created_at')
            .single();

        if (error) throw error;
        res.json({ ...data, comment_count: 0 });
    } catch (err) {
        console.error('[community/posts POST]', err);
        res.status(500).json({ error: `Failed to create post. ${err.message || err.toString()}` });
    }
});

// GET /api/community/posts/:postId/comments
app.get('/api/community/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    if (!/^[a-f0-9]{8}$/.test(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

    try {
        const { data, error } = await supabase
            .from('community_comments')
            .select('id, author_name, comment, created_at')
            .eq('post_id', postId)
            .order('created_at', { ascending: true })
            .limit(100);

        if (error) throw error;
        res.json({ comments: data || [] });
    } catch (err) {
        console.error('[community/comments GET]', err);
        res.status(500).json({ error: `Failed to load comments. ${err.message || err.toString()}` });
    }
});

// POST /api/community/posts/:postId/comments
app.post('/api/community/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    if (!/^[a-f0-9]{8}$/.test(postId)) return res.status(400).json({ error: 'Invalid post ID.' });

    const comment = sanitizeText(req.body.comment);
    const author_name = sanitizeText(req.body.author_name || 'anonim').slice(0, 32) || 'anonim';

    if (!comment) return res.status(400).json({ error: '`comment` is required.' });
    if (comment.length > 200) return res.status(400).json({ error: 'Comment too long (max 200 chars).' });

    const id = generateId();
    try {
        const { data, error } = await supabase
            .from('community_comments')
            .insert([{ id, post_id: postId, author_name, comment }])
            .select('id, author_name, comment, created_at')
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[community/comments POST]', err);
        res.status(500).json({ error: `Failed to post comment. ${err.message || err.toString()}` });
    }
});

// Single Page Path Handler (Routing)
app.get('/:id', (req, res) => {
    const id = req.params.id;
    // Don't intercept static files with dots (e.g., .css, .js)
    if (id.includes('.')) {
        return res.status(404).end();
    }
    // Serve anyom community page
    if (id === 'anyom') {
        return res.sendFile(path.join(__dirname, 'public', 'anyom.html'));
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// For local testing (when running `node server.js`)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

// Export for Vercel Serverless
module.exports = app;

