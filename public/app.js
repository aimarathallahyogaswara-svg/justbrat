const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const textInput = document.getElementById('textInput');
const modeSelect = document.getElementById('modeSelect');
const wordCountEl = document.getElementById('wordCount');
const shareBtn = document.getElementById('shareBtn');
const renderBtn = document.getElementById('renderBtn');
const shareSection = document.getElementById('shareSection');
const shareLink = document.getElementById('shareLink');
const copyBtn = document.getElementById('copyBtn');
const waShareBtn = document.getElementById('waShareBtn');
const editorView = document.getElementById('editorView');
const canvasWrap = document.getElementById('canvasWrap');
const sharedHint = document.getElementById('sharedHint');
const delayRow = document.getElementById('delayRow');
const delayRange = document.getElementById('delayRange');
const delayValue = document.getElementById('delayValue');
const bgColorPicker = document.getElementById('bgColorPicker');
const textColorPicker = document.getElementById('textColorPicker');
const resetColors = document.getElementById('resetColors');
const imageInput = document.getElementById('imageInput');
const clearImageBtn = document.getElementById('clearImageBtn');
const imageSettings = document.getElementById('imageSettings');
const imgOpacity = document.getElementById('imgOpacity');
const imgOpacityVal = document.getElementById('imgOpacityVal');
const imgFit = document.getElementById('imgFit');
const staticStickerBtn = document.getElementById('staticStickerBtn');
const recordVideoBtn = document.getElementById('recordVideoBtn');



const MAX_WORDS = 1000; // Effectively removed for typical use
const CANVAS_SIZE = 512;

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0/dist/transformers.min.js';
// Prevent local model fetching since we are in the browser
env.allowLocalModels = false;

let animTimer = null;
let bgColor = '#ffffff';
let textColor = '#000000';
let bgImage = null; 
let bgVideo = null;
let activeDrawItems = [];
let renderLoopActive = false;
let autoLyricsTimeline = []; // Array of { word, start, end }
let isAudioPlaying = false;
let globalAudio = null;

let mediaRecorder = null;
let recordedChunks = [];
let cursorBlinkTimer = null;
let cursorVisible = true;
let isCanvasFocused = false;
const canvasTypeHint = document.getElementById('canvasTypeHint');

// ─── Color Management ────────────────────────────────────────────────────────

function applyColors(bg, text, rerender = true) {
    bgColor = bg;
    textColor = text;
    bgColorPicker.value = bg;
    textColorPicker.value = text;
    if (rerender) render(textInput.value, modeSelect.value);
}

bgColorPicker.addEventListener('input', () => {
    bgColor = bgColorPicker.value;
    render(textInput.value, modeSelect.value);
});

textColorPicker.addEventListener('input', () => {
    textColor = textColorPicker.value;
    render(textInput.value, modeSelect.value);
});

resetColors.addEventListener('click', () => {
    applyColors('#ffffff', '#000000');
    updatePresetActive('#ffffff');
});

// Preset theme buttons
const presetBtns = document.querySelectorAll('.preset-btn');
presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const bg = btn.dataset.bg;
        const text = btn.dataset.text;
        applyColors(bg, text);
        updatePresetActive(bg);
    });
});

function updatePresetActive(bg) {
    presetBtns.forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function getWords(text) {
    const rawWords = text.trim().split(/\s+/).filter(w => w.length > 0);
    const finalWords = [];
    
    // Auto go down for extremely long words
    for (const w of rawWords) {
        if (w.length > 12) {
            for (let i = 0; i < w.length; i += 10) {
                finalWords.push(w.substring(i, i + 10));
            }
        } else {
            finalWords.push(w);
        }
    }
    
    return finalWords.slice(0, MAX_WORDS);
}

function updateWordCount(text) {
    const count = getWords(text).length;
    wordCountEl.textContent = `${count} words`;
}

// ─── Image Upload ─────────────────────────────────────────────────────────────

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    
    if (file.type.startsWith('video/')) {
        bgImage = null;
        if (bgVideo) { bgVideo.pause(); bgVideo.src = ''; }
        bgVideo = document.createElement('video');
        bgVideo.muted = true;
        bgVideo.loop = true;
        bgVideo.playsInline = true;
        bgVideo.oncanplay = () => {
            bgVideo.play();
            clearImageBtn.classList.remove('hidden');
            imageSettings.classList.remove('hidden');
            render(textInput.value, modeSelect.value);
            startRenderLoop();
        };
        bgVideo.src = url;
    } else {
        if (bgVideo) { bgVideo.pause(); bgVideo.src = ''; bgVideo = null; }
        const img = new Image();
        img.onload = () => {
            bgImage = img;
            clearImageBtn.classList.remove('hidden');
            imageSettings.classList.remove('hidden');
            render(textInput.value, modeSelect.value);
            startRenderLoop();
        };
        img.src = url;
    }
});

clearImageBtn.addEventListener('click', () => {
    bgImage = null;
    if (bgVideo) { bgVideo.pause(); bgVideo.src = ''; bgVideo = null; }
    imageInput.value = '';
    clearImageBtn.classList.add('hidden');
    imageSettings.classList.add('hidden');
    render(textInput.value, modeSelect.value);
});

imgOpacity.addEventListener('input', () => {
    imgOpacityVal.textContent = `${imgOpacity.value}%`;
    render(textInput.value, modeSelect.value);
});

imgFit.addEventListener('change', () => {
    render(textInput.value, modeSelect.value);
});

// ─── Canvas Core ─────────────────────────────────────────────────────────────

function clearCanvasBackground() {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    const media = bgVideo || bgImage;
    if (media) {
        // Fallback for video dimensions
        let mWidth = media.videoWidth || media.width;
        let mHeight = media.videoHeight || media.height;
        if (!mWidth || !mHeight) return;

        const opacity = parseInt(imgOpacity.value, 10) / 100;
        const fit = imgFit.value;
        let drawW, drawH, offsetX, offsetY;

        if (fit === 'cover') {
            const scale = Math.max(CANVAS_SIZE / mWidth, CANVAS_SIZE / mHeight);
            drawW = mWidth * scale;
            drawH = mHeight * scale;
            offsetX = (CANVAS_SIZE - drawW) / 2;
            offsetY = (CANVAS_SIZE - drawH) / 2;
        } else if (fit === 'contain') {
            const scale = Math.min(CANVAS_SIZE / mWidth, CANVAS_SIZE / mHeight);
            drawW = mWidth * scale;
            drawH = mHeight * scale;
            offsetX = (CANVAS_SIZE - drawW) / 2;
            offsetY = (CANVAS_SIZE - drawH) / 2;
        } else { // stretch
            drawW = CANVAS_SIZE;
            drawH = CANVAS_SIZE;
            offsetX = 0;
            offsetY = 0;
        }

        ctx.globalAlpha = opacity;
        ctx.drawImage(media, offsetX, offsetY, drawW, drawH);
        ctx.globalAlpha = 1.0;
    }
}

function startRenderLoop() {
    if (!renderLoopActive) {
        renderLoopActive = true;
        renderLoop();
    }
}

function renderLoop() {
    clearCanvasBackground();
    for (const item of activeDrawItems) {
        drawWordActual(item.w, item.partialLength);
    }
    if (renderLoopActive) {
        requestAnimationFrame(renderLoop);
    }
}

function clearCanvas() {
    activeDrawItems = [];
}

function buildWordLayout(words) {
    if (words.length === 0) return [];

    const margin = 40;
    const maxWidth = CANVAS_SIZE - margin * 2;
    const maxHeight = CANVAS_SIZE - margin * 2;
    
    let fontSize = 160;
    let rows = [];
    let lineHeight;
    
    // Find optimal font size to fit words dynamically
    while (fontSize > 12) {
        ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
        lineHeight = fontSize * 1.15; 
        
        rows = [];
        let currentRow = [];
        let currentLineWidth = 0;
        let wordTooWide = false;
        
        for (const word of words) {
            const wordWidth = ctx.measureText(word).width;
            if (wordWidth > maxWidth) {
                wordTooWide = true; // Word alone exceeds bounds, must shrink font
                break;
            }
            
            const spaceWidth = ctx.measureText(' ').width;
            
            if (currentRow.length === 0) {
                currentRow.push(word);
                currentLineWidth = wordWidth;
            } else {
                if (currentLineWidth + spaceWidth + wordWidth > maxWidth) {
                    rows.push(currentRow); // Wrap line (auto kebawah)
                    currentRow = [word];
                    currentLineWidth = wordWidth;
                } else {
                    currentRow.push(word);
                    currentLineWidth += spaceWidth + wordWidth;
                }
            }
        }
        if (!wordTooWide && currentRow.length > 0) {
            rows.push(currentRow);
        }
        if (!wordTooWide) {
            const totalHeight = rows.length * lineHeight;
            if (totalHeight <= maxHeight) {
                break; // Everything fits nicely
            }
        }
        fontSize -= 2; // Shrink and try again
    }

    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    const layout = [];
    
    let y = (CANVAS_SIZE - (rows.length * lineHeight)) / 2 + (fontSize / 2);

    for (const row of rows) {
        const rowJitterY = rand(-2, 2);

        if (row.length === 1) {
            // Single word: left-aligned (authentic brat style)
            layout.push({
                text: row[0],
                x: margin + rand(-3, 3),
                y: y + rowJitterY,
                size: fontSize,
            });
        } else {
            // Multiple words: spread first word to left edge, last word to right edge,
            // middle words evenly distributed between — THIS is the authentic brat look.
            const wordWidths = row.map(w => ctx.measureText(w).width);
            const totalWordsWidth = wordWidths.reduce((a, b) => a + b, 0);
            const gap = (maxWidth - totalWordsWidth) / (row.length - 1);

            let x = margin;
            for (let i = 0; i < row.length; i++) {
                layout.push({
                    text: row[i],
                    x: x + rand(-2, 2),
                    y: y + rowJitterY + rand(-1, 1),
                    size: fontSize,
                });
                x += wordWidths[i] + gap;
            }
        }

        y += lineHeight;
    }
    return layout;
}

function buildSplitLayout(words) {
    if (words.length === 0) return [];

    const leftWords = [];
    const rightWords = [];
    for (let i = 0; i < words.length; i++) {
        if (i % 2 === 0) leftWords.push(words[i]);
        else rightWords.push(words[i]);
    }

    // Split the canvas into two halves, each word centered within its half.
    const sideMarginX = 18;
    const marginY = 45;
    const maxWidthHalf = (CANVAS_SIZE / 2) - sideMarginX * 2;
    const maxHeight = CANVAS_SIZE - marginY * 2;

    let fontSize = 160;
    let lineHeight = 0;

    // Pick a font size that fits both columns (width + height).
    while (fontSize > 12) {
        ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, Helvetica, sans-serif`;
        lineHeight = fontSize * 1.05;

        const leftFitsWidth = leftWords.every(w => ctx.measureText(w).width <= maxWidthHalf);
        const rightFitsWidth = rightWords.every(w => ctx.measureText(w).width <= maxWidthHalf);
        const leftFitsHeight = (leftWords.length * lineHeight) <= maxHeight;
        const rightFitsHeight = (rightWords.length * lineHeight) <= maxHeight;

        if (leftFitsWidth && rightFitsWidth && leftFitsHeight && rightFitsHeight) break;
        fontSize -= 2;
    }

    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, Helvetica, sans-serif`;
    lineHeight = fontSize * 1.05;

    const totalLeftH = leftWords.length * lineHeight;
    const totalRightH = rightWords.length * lineHeight;

    const startYLeft = (CANVAS_SIZE - totalLeftH) / 2 + (fontSize / 2);
    const startYRight = (CANVAS_SIZE - totalRightH) / 2 + (fontSize / 2);

    const centerXLeft = CANVAS_SIZE / 4;
    const centerXRight = (CANVAS_SIZE * 3) / 4;

    // Keep original word order in the returned layout array
    // (useful if later animation modes are added for split).
    const layout = [];
    for (let i = 0; i < words.length; i++) {
        const text = words[i];
        if (i % 2 === 0) {
            const leftIdx = i / 2;
            const wWidth = ctx.measureText(text).width;
            layout.push({
                text,
                x: centerXLeft - wWidth / 2 + rand(-2, 2),
                y: startYLeft + leftIdx * lineHeight + rand(-2, 2),
                size: fontSize,
            });
        } else {
            const rightIdx = (i - 1) / 2;
            const wWidth = ctx.measureText(text).width;
            layout.push({
                text,
                x: centerXRight - wWidth / 2 + rand(-2, 2),
                y: startYRight + rightIdx * lineHeight + rand(-2, 2),
                size: fontSize,
            });
        }
    }

    return layout;
}

function drawWord(w, partialLength) {
    activeDrawItems.push({ w, partialLength });
}

function drawWordActual(w, partialLength) {
    if (partialLength === 0) return;
    const textToDraw = partialLength === undefined ? w.text : w.text.substring(0, partialLength);

    ctx.save();
    ctx.filter = 'blur(1.5px)';
    ctx.font = `bold ${w.size}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(textToDraw, w.x, w.y);
    ctx.restore();
}

// Helper: measure text using same emoji-aware font stack
function measureWord(word, fontSize) {
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, Helvetica, sans-serif`;
    return ctx.measureText(word).width;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderInstant(words) {
    clearCanvas();
    const layout = buildWordLayout(words);
    for (const w of layout) drawWord(w);
}

function renderSplitInstant(words) {
    clearCanvas();
    const layout = buildSplitLayout(words);
    for (const w of layout) drawWord(w);
}

function renderAnimate(words) {
    clearCanvas();
    const layout = buildWordLayout(words);
    if (layout.length === 0) return;

    let i = 0;

    function next() {
        if (i >= layout.length) return;
        drawWord(layout[i]);
        i++;
        
        let delay;
        if (delayRange) {
            const wpm = parseInt(delayRange.value, 10);
            delay = (60000 / wpm) + rand(-20, 20); // Accurate WPM mapped to ms-per-word
        } else {
            delay = rand(120, 220); 
        }
        
        animTimer = setTimeout(next, delay);
    }

    next();
}

function renderTyping(words) {
    clearCanvas();
    const layout = buildWordLayout(words);
    if (layout.length === 0) return;

    let wordIndex = 0;
    let charIndex = 0;

    function next() {
        if (wordIndex >= layout.length) return;

        // Clear and redraw everything up to current state 
        // to prevent blur from drastically overlapping itself
        clearCanvas();
        for (let i = 0; i < wordIndex; i++) {
            drawWord(layout[i]);
        }

        const currentWord = layout[wordIndex];
        drawWord(currentWord, charIndex + 1);

        charIndex++;
        if (charIndex >= currentWord.text.length) {
            charIndex = 0;
            wordIndex++;
        }

        if (wordIndex < layout.length || charIndex > 0) {
            let delay;
            if (delayRange) {
                const wpm = parseInt(delayRange.value, 10);
                delay = (12000 / wpm) + rand(-10, 10); // Accurate WPM mapped to ms-per-char (where 1 word = 5 chars standardized)
            } else {
                delay = 50; 
            }
            animTimer = setTimeout(next, Math.max(10, Math.round(delay)));
        }
    }
    
    next();
}

function renderLyrics(words) {
    clearCanvas();
    startRenderLoop();
    const layout = buildWordLayout(words);
    if (layout.length === 0) return;

    let i = 0;

    function next() {
        if (i >= layout.length) return;
        
        clearCanvas();
        drawWord(layout[i]);
        i++;
        
        let delay;
        if (delayRange) {
            const wpm = parseInt(delayRange.value, 10);
            delay = (60000 / wpm) + rand(-20, 20);
        } else {
            delay = rand(120, 220); 
        }
        
        animTimer = setTimeout(next, delay);
    }

    next();
}

function renderLyrics2() {
    clearCanvas();
    startRenderLoop();
    if (autoLyricsTimeline.length === 0) {
        activeDrawItems.push({ w: { text: "Upload MP3 first", x: 100, y: CANVAS_SIZE/2, size: 40 } });
        return;
    }
    if (!globalAudio) return;
    
    // The render loop will handle timestamp checking
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    
    function nextFrame() {
        if (!globalAudio || globalAudio.paused) return; // Exit if paused/stopped
        const t = globalAudio.currentTime;
        
        // Find which words should be visible right now. (We'll flash words as they are spoken)
        // Or we could show all spoken words, but lyrics flash is cooler.
        const currentWord = autoLyricsTimeline.find(word => t >= word.start && t <= word.end + 0.3); // add 300ms tail
        
        clearCanvas();
        if (currentWord) {
            // Recompute layout for just this word to center it like brat
            const layout = buildWordLayout([currentWord.text]);
            for(let w of layout) drawWord(w);
        }
        
        if (!globalAudio.paused && !globalAudio.ended) {
            animTimer = setTimeout(nextFrame, 50); // check 20fps
        }
    }
    nextFrame();
}

function render(text, mode) {
    if (globalAudio) {
        globalAudio.pause();
        globalAudio.currentTime = 0;
    }

    const words = getWords(text);
    startRenderLoop();

    if (mode === 'typing') {
        renderTyping(words);
    } else if (mode === 'animate') {
        renderAnimate(words);
    } else if (mode === 'lyrics') {
        renderLyrics(words);
    } else if (mode === 'lyrics2') {
        if (globalAudio) globalAudio.play();
        renderLyrics2();
    } else if (mode === 'split') {
        renderSplitInstant(words);
    } else {
        renderInstant(words);
    }
}

// ─── Events ──────────────────────────────────────────────────────────────────

textInput.addEventListener('input', () => {
    updateWordCount(textInput.value);
    
    // BRAT TYPE pulse effect
    canvasWrap.style.transform = 'scale(1.05)';
    setTimeout(() => {
        canvasWrap.style.transform = 'scale(1)';
    }, 50);

    if (modeSelect.value === 'normal' || modeSelect.value === 'split') {
        render(textInput.value, modeSelect.value);
    }
});

function updateDelayLabel() {
    const val = parseInt(delayRange.value, 10);
    delayValue.textContent = `${val} WPM`;
}

modeSelect.addEventListener('change', () => {
    const isAnimated = modeSelect.value !== 'normal' && modeSelect.value !== 'split';
    const isLyrics2 = modeSelect.value === 'lyrics2';
    
    delayRow.classList.toggle('hidden', !isAnimated || isLyrics2); // speed doesn't apply to lyrics2
    document.getElementById('audioUploadRow').classList.toggle('hidden', !isLyrics2);
    
    updateDelayLabel();
    render(textInput.value, modeSelect.value);
});

const audioInput = document.getElementById('audioInput');
const audioStatus = document.getElementById('audioStatus');
let transcriber = null;

async function initTranscriber() {
    if (!transcriber) {
        audioStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading AI model... (may take a moment)';
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        audioStatus.innerHTML = '<i class="fa-solid fa-check"></i> AI model loaded!';
    }
}

audioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (globalAudio) {
        globalAudio.pause();
        globalAudio.src = '';
    }

    const url = URL.createObjectURL(file);
    globalAudio = new Audio(url);

    try {
        await initTranscriber();
        
        audioStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting lyrics...';
        
        // Decode audio data to Float32Array
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);

        // Transcribe with word-level timestamps
        const output = await transcriber(channelData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word'
        });

        // output.chunks usually contains { text, timestamp: [start, end] }
        if (output && output.chunks) {
            autoLyricsTimeline = output.chunks.map(c => ({
                text: c.text.trim(),
                start: c.timestamp[0],
                end: c.timestamp[1]
            })).filter(c => c.text);
            
            audioStatus.innerHTML = '<i class="fa-solid fa-check"></i> Lyrics sync ready!';
            
            textInput.value = output.text.trim();
            updateWordCount(textInput.value);
            
            render(textInput.value, modeSelect.value);
        } else {
            audioStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No speech detected.';
        }
    } catch (err) {
        console.error(err);
        audioStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error parsing audio.';
    }
});

delayRange.addEventListener('input', () => {
    updateDelayLabel();
    if (modeSelect.value !== 'normal' && modeSelect.value !== 'split') {
        render(textInput.value, modeSelect.value);
    }
});

renderBtn.addEventListener('click', () => {
    render(textInput.value, modeSelect.value);
});

document.getElementById('reverseBtn').addEventListener('click', () => {
    const text = textInput.value;
    textInput.value = text.split('').reverse().join('');
    render(textInput.value, modeSelect.value);
});

// ─── Canvas Focus / Cursor Blink ────────────────────────────────────────────

function startCursorBlink() {
    if (cursorBlinkTimer) return;
    cursorBlinkTimer = setInterval(() => {
        cursorVisible = !cursorVisible;
        // Only draw cursor in normal mode (animate/typing have their own timing)
        if (modeSelect.value === 'normal') {
            renderWithCursor(textInput.value);
        }
    }, 530);
}

function stopCursorBlink() {
    if (cursorBlinkTimer) {
        clearInterval(cursorBlinkTimer);
        cursorBlinkTimer = null;
    }
    cursorVisible = false;
    if (modeSelect.value === 'normal') {
        renderWithCursor(textInput.value);
    }
}

function renderWithCursor(text) {
    renderInstant(getWords(text));
    if (cursorVisible && isCanvasFocused && modeSelect.value === 'normal') {
        // Draw a blinking pipe cursor at the bottom-right of the text area
        const words = getWords(text);
        if (words.length === 0) {
            // Draw cursor at center
            ctx.save();
            ctx.fillStyle = textColor;
            ctx.font = `bold 80px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.7;
            ctx.fillText('|', CANVAS_SIZE / 2 + 40, CANVAS_SIZE / 2);
            ctx.restore();
        }
        // When text present, cursor is implied by the blink on the canvas border
    }
}

canvasWrap.addEventListener('click', () => {
    textInput.focus();
});

textInput.addEventListener('focus', () => {
    isCanvasFocused = true;
    canvasWrap.classList.add('canvas-focused');
    canvasTypeHint.classList.add('hint-hidden');
    startCursorBlink();
});

textInput.addEventListener('blur', () => {
    isCanvasFocused = false;
    canvasWrap.classList.remove('canvas-focused');
    stopCursorBlink();
    // Show hint if canvas has no text
    if (!textInput.value.trim()) {
        canvasTypeHint.classList.remove('hint-hidden');
    }
});

shareBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    const mode = modeSelect.value;
    const colors = { bg: bgColor, text: textColor };
    if (!text) { alert('type something first.'); return; }

    const originalText = shareBtn.innerHTML;
    shareBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> loading...';
    shareBtn.disabled = true;
    
    try {
        // Timeout after 10 seconds so we don't hang forever
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch('/api/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mode, theme: JSON.stringify(colors) }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            // API returned an error — use fallback hash-based share
            throw new Error(`API error: ${res.status}`);
        }

        const data = await res.json();
        if (data.id) {
            const url = `${window.location.origin}/${data.id}`;
            shareLink.value = url;
            shareSection.classList.remove('hidden');
            shareSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            throw new Error('No ID returned');
        }
    } catch (e) {
        console.warn('[share] API failed, using fallback hash share:', e.message);
        
        // Fallback: encode share data directly in the URL hash
        // This works even when the database/API is completely down
        try {
            const shareData = { t: text, m: mode, c: colors };
            const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareData))));
            const url = `${window.location.origin}/#s=${encoded}`;
            shareLink.value = url;
            shareSection.classList.remove('hidden');
            shareSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (fallbackErr) {
            console.error('[share] Fallback also failed:', fallbackErr);
            alert('could not generate link. please try again.');
        }
    } finally {
        shareBtn.innerHTML = originalText;
        shareBtn.disabled = false;
    }
});

copyBtn.addEventListener('click', () => {
    shareLink.select();
    navigator.clipboard.writeText(shareLink.value).catch(() => document.execCommand('copy'));
    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    copyBtn.style.background = '#e8f5e9';
    copyBtn.style.color = '#2e7d32';
    copyBtn.style.borderColor = '#a5d6a7';
    setTimeout(() => {
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Link';
        copyBtn.style.background = '';
        copyBtn.style.color = '';
        copyBtn.style.borderColor = '';
    }, 2000);
});

waShareBtn.addEventListener('click', () => {
    const url = encodeURIComponent(shareLink.value);
    const text = encodeURIComponent('check out my brat text! \n');
    window.open(`https://api.whatsapp.com/send?text=${text}${url}`, '_blank');
});

// Twitter/X Share
const twitterShareBtn = document.getElementById('twitterShareBtn');
if (twitterShareBtn) {
    twitterShareBtn.addEventListener('click', () => {
        const url = encodeURIComponent(shareLink.value);
        const text = encodeURIComponent('check out my brat text! 🟢');
        window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
    });
}

// ─── Export ──────────────────────────────────────────────────────────────────

staticStickerBtn.addEventListener('click', () => {
    // Render fully before capturing
    renderInstant(getWords(textInput.value));
    setTimeout(() => {
        const link = document.createElement('a');
        
        let filename = 'brat';
        if (textInput.value.trim().length > 0) {
            const titleWords = getWords(textInput.value).slice(0, 3).join('-');
            filename = `brat-${titleWords.replace(/[^a-z0-9-]/gi, '')}`;
        }
        
        link.download = `${filename}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        if (modeSelect.value !== 'normal') render(textInput.value, modeSelect.value);
    }, 60);
});

recordVideoBtn.addEventListener('click', async () => {
    // Allows user to stop manually at any point
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
    }

    const words = getWords(textInput.value);
    if (words.length === 0) { alert('type something first.'); return; }

    if (animTimer) { clearTimeout(animTimer); animTimer = null; }

    let stream = canvas.captureStream(30);

    // Merge audio if lyrics2 mode
    if (modeSelect.value === 'lyrics2' && globalAudio) {
        try {
            // We create a fresh Audio object from the same source to feed into the stream without breaking the currently playing one
            const clonedAudio = new Audio(globalAudio.src);
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const source = actx.createMediaElementSource(clonedAudio);
            const dest = actx.createMediaStreamDestination();
            source.connect(dest);
            source.connect(actx.destination);
            
            const audioTrack = dest.stream.getAudioTracks()[0];
            if (audioTrack) {
                stream = new MediaStream([...stream.getVideoTracks(), audioTrack]);
            }
            
            // We swap globalAudio to this new one so renderLyrics2 reads its currentTime!
            globalAudio.pause();
            globalAudio = clonedAudio;
        } catch (err) {
            console.error("Audio mixing error:", err);
        }
    }
    
    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
    }

    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 50000 });
    } catch (e) {
        // Fallback for Safari/iOS
        mediaRecorder = new MediaRecorder(stream, { videoBitsPerSecond: 50000 });
        mimeType = mediaRecorder.mimeType || 'video/mp4'; 
    }
    
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        recordVideoBtn.innerHTML = '<div class="export-btn-icon"><i class="fa-solid fa-film"></i></div><div class="export-btn-info"><span class="export-btn-title">Record Video</span><span class="export-btn-desc">Capture animation as MP4/WebM</span></div>';
        recordVideoBtn.style.color = '';
        recordVideoBtn.style.borderColor = '';
        
        const blob = new Blob(recordedChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('avc1') ? 'mp4' : 'webm';
        
        let filename = 'brat-video';
        if (textInput.value.trim().length > 0) {
            const titleWords = getWords(textInput.value).slice(0, 3).join('-');
            filename = `brat-video-${titleWords.replace(/[^a-z0-9-]/gi, '')}`;
        }

        const link = document.createElement('a');
        link.download = `${filename}.${ext}`;
        link.href = URL.createObjectURL(blob);
        link.click();
        
        render(textInput.value, modeSelect.value);
    };

    // UI state while recording
    recordVideoBtn.innerHTML = '<div class="export-btn-icon" style="background:linear-gradient(135deg,#ffebee,#ffcdd2);color:#c62828;"><i class="fa-solid fa-stop"></i></div><div class="export-btn-info"><span class="export-btn-title" style="color:#c62828;">Stop Recording</span><span class="export-btn-desc">Click to save your video</span></div>';
    recordVideoBtn.style.borderColor = '#ef9a9a';
    
    mediaRecorder.start();

    // Start playback for the capture
    clearCanvas();
    const layout = buildWordLayout(words);
    const mode = modeSelect.value;
    const wpm = parseInt(delayRange.value, 10);
    
    if (mode === 'typing') {
        let wordIndex = 0;
        let charIndex = 0;
        function nextFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return; // User manually stopped
            
            if (wordIndex >= layout.length) {
                setTimeout(() => {
                    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
                }, 1500); // Record final still buffer
                return;
            }
            
            clearCanvas();
            for (let i = 0; i < wordIndex; i++) drawWord(layout[i]);
            
            const currentWord = layout[wordIndex];
            drawWord(currentWord, charIndex + 1);

            charIndex++;
            if (charIndex >= currentWord.text.length) {
                charIndex = 0;
                wordIndex++;
            }
            
            const delay = Math.max(20, Math.round(12000 / wpm) + rand(-10, 10));
            animTimer = setTimeout(nextFrame, delay);
        }
        nextFrame();
    } else if (mode === 'lyrics') {
        let wi = 0;
        function nextFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return; 
            
            if (wi >= layout.length) {
                setTimeout(() => {
                    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
                }, 1500);
                return;
            }

            clearCanvas();
            drawWord(layout[wi]);
            wi++;
            
            const delay = Math.max(50, Math.round(60000 / wpm) + rand(-20, 20));
            animTimer = setTimeout(nextFrame, delay);
        }
        nextFrame();
    } else if (mode === 'lyrics2') {
        if (globalAudio) {
            globalAudio.currentTime = 0;
            globalAudio.play();
        }
        
        function nextFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
            
            if (!globalAudio || globalAudio.ended) {
                setTimeout(() => {
                    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
                }, 1000);
                return;
            }
            // renderLoop handles drawing!
            animTimer = setTimeout(nextFrame, 200);
        }
        renderLyrics2(); // triggers the timeline based rendering (which hooks to renderLoop)
        nextFrame();
    } else {
        // Animate / Normal (word-by-word playback)
        let wi = 0;
        function nextFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return; 
            
            if (wi >= layout.length) {
                setTimeout(() => {
                    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
                }, 1500);
                return;
            }

            clearCanvas();
            for (let i = 0; i <= wi; i++) drawWord(layout[i]);
            wi++;
            
            const delay = Math.max(50, Math.round(60000 / wpm) + rand(-20, 20));
            animTimer = setTimeout(nextFrame, delay);
        }
        nextFrame();
    }
});

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
    clearCanvas();

    // Check for hash-based fallback share link first
    const hash = window.location.hash;
    if (hash && hash.startsWith('#s=')) {
        try {
            const encoded = hash.substring(3);
            const decoded = JSON.parse(decodeURIComponent(escape(atob(encoded))));
            
            editorView.classList.add('hidden');
            sharedHint.classList.remove('hidden');
            document.body.classList.add('share-view');
            
            textInput.value = decoded.t || '';
            modeSelect.value = decoded.m || 'normal';
            
            if (decoded.c && decoded.c.bg && decoded.c.text) {
                applyColors(decoded.c.bg, decoded.c.text, false);
            }
            
            render(decoded.t || '', decoded.m || 'normal');
            return;
        } catch (e) {
            console.warn('[init] Could not parse hash share:', e.message);
        }
    }

    const pathId = window.location.pathname.replace(/^\//, '');

    if (pathId && pathId !== '') {
        // SHARE VIEW
        editorView.classList.add('hidden');
        sharedHint.classList.remove('hidden');
        document.body.classList.add('share-view');

        try {
            const res = await fetch(`/api/posts/${pathId}`);
            if (res.ok) {
                const data = await res.json();
                
                // Set loaded state quietly
                textInput.value = data.text;
                modeSelect.value = data.mode;
                
                if (data.theme) {
                    try {
                        const colors = JSON.parse(data.theme);
                        if (colors.bg && colors.text) {
                            applyColors(colors.bg, colors.text, false);
                        }
                    } catch(_) {}
                    render(data.text, data.mode);
                } else {
                    render(data.text, data.mode);
                }
                return;
            }
        } catch (e) {
            console.error(e);
        }

        // Fallback if id not found
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('link not found.', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
        return;
    }

    // EDITOR VIEW — default preview
    render('brat', 'normal');
}

init();
