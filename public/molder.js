const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const molderInput = document.getElementById('molderInput');
const molderControls = document.getElementById('molderControls');
const molderQuality = document.getElementById('molderQuality');
const molderQualityVal = document.getElementById('molderQualityVal');
const molderDownloadBtn = document.getElementById('molderDownloadBtn');
const molderBtnInfo = document.getElementById('molderBtnInfo');
const videoEl = document.getElementById('molderVideo');

const CANVAS_SIZE = 512;
let currentMode = null; // 'image' or 'video'
let molderImage = null;
let renderLoop = null;

// Initial state
function drawWaitingState() {
    ctx.fillStyle = '#f9f9f9';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('awaiting media...', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
}
drawWaitingState();

molderInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    
    // Stop previous loop if any
    if (renderLoop) cancelAnimationFrame(renderLoop);
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();

    if (file.type.startsWith('video/')) {
        currentMode = 'video';
        molderImage = null;
        setupVideo(url);
    } else {
        currentMode = 'image';
        setupImage(url);
    }
});

function setupImage(url) {
    const img = new Image();
    img.onload = () => {
        molderImage = img;
        molderControls.classList.remove('hidden');
        renderMolderImage();
    };
    img.src = url;
}

function setupVideo(url) {
    videoEl.src = url;
    videoEl.loop = true;
    molderControls.classList.remove('hidden');
    videoEl.play().then(() => {
        // Start render loop
        function drawVideoFrame() {
            if (currentMode === 'video' && !videoEl.paused && !videoEl.ended) {
                renderVideoFrame();
            }
            renderLoop = requestAnimationFrame(drawVideoFrame);
        }
        renderLoop = requestAnimationFrame(drawVideoFrame);
    }).catch(err => console.log('Video play error', err));
}

molderQuality.addEventListener('input', () => {
    molderQualityVal.textContent = `${molderQuality.value}%`;
    if (currentMode === 'image') {
        renderMolderImage();
    }
});

function drawMediaScaled(source, srcW, srcH) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // Scale to cover. 
    const scale = Math.max(CANVAS_SIZE / srcW, CANVAS_SIZE / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const offsetX = (CANVAS_SIZE - drawW) / 2;
    const offsetY = (CANVAS_SIZE - drawH) / 2;
    
    // Low quality drawing interpolation
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, offsetX, offsetY, drawW, drawH);
}

function renderMolderImage() {
    if (!molderImage) return;
    drawMediaScaled(molderImage, molderImage.width, molderImage.height);
}

function renderVideoFrame() {
    if (videoEl.readyState >= 2) {
        drawMediaScaled(videoEl, videoEl.videoWidth, videoEl.videoHeight);
    }
}

molderDownloadBtn.addEventListener('click', async () => {
    const moldLevel = parseInt(molderQuality.value, 10);

    if (currentMode === 'image' && molderImage) {
        // Inverse mapping:
        // Max moldiness (100) -> 0.01 quality
        // Min moldiness (1) -> 0.90 quality
        const jpegQuality = Math.max(0.01, 1 - (moldLevel / 100));
        
        renderMolderImage();
        const link = document.createElement('a');
        link.download = `bratt2-moldy.jpg`;
        link.href = canvas.toDataURL('image/jpeg', jpegQuality);
        link.click();
    } 
    else if (currentMode === 'video') {
        isRecording = true;
        molderDownloadBtn.disabled = true;
        
        // Update UI
        const origHtml = molderBtnInfo.innerHTML;
        molderBtnInfo.innerHTML = `
            <span class="export-btn-title">Ruining Video...</span>
            <span class="export-btn-desc">Please wait</span>
        `;

        // 144p / 240p bitrates
        // Max moldiness (100) -> ~10,000 bps (extremely blocky/glitchy)
        // Min moldiness (1) -> ~250,000 bps
        const streamOptions = {
            mimeType: 'video/webm;codecs=vp8',
            videoBitsPerSecond: Math.max(10000, 250000 - (moldLevel * 2400))
        };
        
        let recorderOptions = {};
        if (MediaRecorder.isTypeSupported(streamOptions.mimeType)) {
            recorderOptions = streamOptions;
        }

        const stream = canvas.captureStream(30); // 30 FPS
        const mediaRecorder = new MediaRecorder(stream, recorderOptions);
        const chunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bratt2-moldy.webm`;
            a.click();
            
            // Restore UI
            molderDownloadBtn.disabled = false;
            molderBtnInfo.innerHTML = origHtml;
            videoEl.loop = true;
            videoEl.play();
        };

        // Prepare recording
        videoEl.pause();
        videoEl.currentTime = 0;
        videoEl.loop = false; // Stop at end

        // Add ended listener once
        videoEl.onended = () => {
            mediaRecorder.stop();
            videoEl.onended = null;
        };

        // Wait a frame and start
        await new Promise(r => setTimeout(r, 100));
        mediaRecorder.start();
        videoEl.play();
    }
});
