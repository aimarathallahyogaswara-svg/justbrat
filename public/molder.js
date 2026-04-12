const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const molderInput = document.getElementById('molderInput');
const molderControls = document.getElementById('molderControls');
const molderQuality = document.getElementById('molderQuality');
const molderQualityVal = document.getElementById('molderQualityVal');
const molderDownloadBtn = document.getElementById('molderDownloadBtn');

const CANVAS_SIZE = 512;
let molderImage = null;

// Initial state
ctx.fillStyle = '#f9f9f9';
ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
ctx.fillStyle = '#ccc';
ctx.font = 'bold 24px Arial';
ctx.textAlign = 'center';
ctx.fillText('awaiting image...', CANVAS_SIZE / 2, CANVAS_SIZE / 2);

molderInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        molderImage = img;
        molderControls.classList.remove('hidden');
        renderMolderImage();
    };
    img.src = url;
});

molderQuality.addEventListener('input', () => {
    molderQualityVal.textContent = `${molderQuality.value}%`;
});

function renderMolderImage() {
    if (!molderImage) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // Scale to cover. 
    const scale = Math.max(CANVAS_SIZE / molderImage.width, CANVAS_SIZE / molderImage.height);
    const drawW = molderImage.width * scale;
    const drawH = molderImage.height * scale;
    const offsetX = (CANVAS_SIZE - drawW) / 2;
    const offsetY = (CANVAS_SIZE - drawH) / 2;
    
    ctx.drawImage(molderImage, offsetX, offsetY, drawW, drawH);
}

molderDownloadBtn.addEventListener('click', () => {
    if (!molderImage) return;
    const moldLevel = parseInt(molderQuality.value, 10);
    // Inverse mapping:
    // Max moldiness (100) -> 0.01 quality
    // Min moldiness (1) -> 0.90 quality
    const jpegQuality = Math.max(0.01, 1 - (moldLevel / 100));
    
    renderMolderImage();
    const link = document.createElement('a');
    link.download = `bratt2-moldy.jpg`;
    link.href = canvas.toDataURL('image/jpeg', jpegQuality);
    link.click();
});
