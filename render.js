const { createCanvas, loadImage } = require('@napi-rs/canvas');

const CANVAS_SIZE = 512;

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function getWords(text) {
    const rawWords = text.trim().split(/\s+/).filter(w => w.length > 0);
    const finalWords = [];
    for (const w of rawWords) {
        if (w.length > 12) {
            for (let i = 0; i < w.length; i += 10) {
                finalWords.push(w.substring(i, i + 10));
            }
        } else {
            finalWords.push(w);
        }
    }
    return finalWords;
}

function buildWordLayout(ctx, words) {
    if (words.length === 0) return [];

    const margin = 45;
    const maxWidth = CANVAS_SIZE - margin * 2;
    const maxHeight = CANVAS_SIZE - margin * 2;

    let fontSize = 160;
    let rows = [];
    let lineHeight;

    while (fontSize > 12) {
        ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
        lineHeight = fontSize * 1.05;

        rows = [];
        let currentRow = [];
        let currentLineWidth = 0;
        let wordTooWide = false;

        for (const word of words) {
            const wordWidth = ctx.measureText(word).width;
            if (wordWidth > maxWidth) {
                wordTooWide = true;
                break;
            }

            const spaceWidth = ctx.measureText(' ').width;

            if (currentRow.length === 0) {
                currentRow.push(word);
                currentLineWidth = wordWidth;
            } else {
                if (currentLineWidth + spaceWidth + wordWidth > maxWidth) {
                    rows.push(currentRow);
                    currentRow = [word];
                    currentLineWidth = wordWidth;
                } else {
                    currentRow.push(word);
                    currentLineWidth += spaceWidth + wordWidth;
                }
            }
        }

        if (!wordTooWide && currentRow.length > 0) rows.push(currentRow);

        if (!wordTooWide) {
            const totalHeight = rows.length * lineHeight;
            if (totalHeight <= maxHeight) break;
        }
        fontSize -= 2;
    }

    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    const layout = [];
    let y = (CANVAS_SIZE - (rows.length * lineHeight)) / 2 + (fontSize / 2);

    for (const row of rows) {
        const rowText = row.join(' ');
        const rowWidth = ctx.measureText(rowText).width;
        let x = (CANVAS_SIZE - rowWidth) / 2;

        const rowJitterX = rand(-4, 4);
        const rowJitterY = rand(-3, 3);

        for (const word of row) {
            const wordWidth = ctx.measureText(word).width;
            const spaceWidth = ctx.measureText(' ').width;
            layout.push({
                text: word,
                x: x + rowJitterX + rand(-2, 2),
                y: y + rowJitterY + rand(-2, 2),
                size: fontSize,
            });
            x += wordWidth + spaceWidth;
        }
        y += lineHeight;
    }

    return layout;
}

function drawWord(ctx, w, textColor, partialLength) {
    if (partialLength === 0) return;
    const textToDraw = partialLength === undefined ? w.text : w.text.substring(0, partialLength);
    ctx.save();
    // Match client-side font stack with emoji support
    ctx.font = `bold ${w.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, Helvetica, sans-serif`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(textToDraw, w.x, w.y);
    ctx.restore();
}

/**
 * Renders a brat-style image and returns it as a JPEG Buffer (heavily compressed).
 * @param {object} opts
 * @param {string} opts.text - The text to render
 * @param {string} [opts.bgColor='#ffffff'] - Background hex color
 * @param {string} [opts.textColor='#000000'] - Text hex color
 * @param {string} [opts.imageUrl] - Optional background image URL
 * @param {number} [opts.imageOpacity=0.45] - Background image opacity (0-1)
 * @param {number} [opts.quality=8] - JPEG quality 1-100 (default 8 = very moldy)
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} Image buffer and MIME type
 */
async function renderStickerImage(opts) {
    const {
        text: rawText,
        bgColor: rawBg = '#ffffff',
        textColor: rawTextColor = '#000000',
        imageUrl = null,
        imageOpacity = 0.45,
        quality = 8,
    } = opts;

    // Sanitize inputs
    const text = (typeof rawText === 'string' ? rawText : '').replace(/<[^>]*>/g, '').trim().slice(0, 500);
    const bgColor = /^#[0-9a-fA-F]{3,8}$/.test(rawBg) ? rawBg : '#ffffff';
    const textColor = /^#[0-9a-fA-F]{3,8}$/.test(rawTextColor) ? rawTextColor : '#000000';

    if (!text) {
        throw new Error('Text is required for rendering.');
    }

    const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw background image if provided
    if (imageUrl) {
        try {
            const bgImg = await loadImage(imageUrl);
            const scale = Math.max(CANVAS_SIZE / bgImg.width, CANVAS_SIZE / bgImg.height);
            const drawW = bgImg.width * scale;
            const drawH = bgImg.height * scale;
            const offsetX = (CANVAS_SIZE - drawW) / 2;
            const offsetY = (CANVAS_SIZE - drawH) / 2;
            ctx.globalAlpha = Math.min(1, Math.max(0, imageOpacity));
            ctx.drawImage(bgImg, offsetX, offsetY, drawW, drawH);
            ctx.globalAlpha = 1.0;
        } catch (e) {
            console.warn('[render] Could not load background image:', e.message);
        }
    }

    // Render words
    const words = getWords(text);
    const layout = buildWordLayout(ctx, words);
    for (const w of layout) {
        drawWord(ctx, w, textColor, undefined);
    }

    // Output as heavily compressed JPEG for the moldy/burik aesthetic
    // Clamp quality between 1-100, default is 8 (very crusty)
    const jpegQuality = Math.max(1, Math.min(100, quality));

    try {
        // @napi-rs/canvas supports toBuffer('image/jpeg') with quality
        const buffer = await canvas.encode('jpeg', jpegQuality);
        return { buffer, mimeType: 'image/jpeg' };
    } catch (e) {
        // Fallback: try PNG if JPEG encoding fails
        console.warn('[render] JPEG encode failed, falling back to PNG:', e.message);
        const buffer = canvas.toBuffer('image/png');
        return { buffer, mimeType: 'image/png' };
    }
}

module.exports = { renderStickerImage };
