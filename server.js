require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Setup global CORS specifically for API so any user/app can use it
app.use('/api', (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Initialize Supabase Client
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

// API Routes
app.post('/api/create', async (req, res) => {
    const { text, mode, theme } = req.body;
    if (!text || !mode) {
         return res.status(400).json({ error: 'Text and mode are required' });
    }

    const id = generateId();
    
    const { data, error } = await supabase
        .from('posts')
        .insert([{ id, text, mode, theme: theme || '' }]);

    if (error) {
        console.error(error);
        return res.status(500).json({ error: 'Database error' });
    }
    res.json({ id });
});

app.get('/api/posts/:id', async (req, res) => {
    const { id } = req.params;
    
    // In Supabase, .single() returns exactly one row or errors if not found
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
});

// Endpoint untuk semua user (menampilkan post-post terbaru secara public)
app.get('/api/recent', async (req, res) => {
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
});

// Single Page Path Handler (Routing)
app.get('/:id', (req, res) => {
    // If id is not an API call or static file, serve index.html
    const id = req.params.id;
    // Don't intercept static files with dots (e.g., .css, .js)
    if (id.includes('.')) {
        return res.status(404).end();
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
