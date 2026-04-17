import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0/dist/transformers.min.js';

// Prevent local model fetching since we are in the browser
env.allowLocalModels = false;

let transcriber = null;

self.onmessage = async (e) => {
    try {
        if (!transcriber) {
            self.postMessage({ status: 'loading' });
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
        }

        self.postMessage({ status: 'extracting' });

        const output = await transcriber(e.data.channelData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true
        });

        self.postMessage({ status: 'done', output });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};
