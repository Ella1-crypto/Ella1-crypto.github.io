// 브라우저 안에서 Whisper 로 받아쓴다. 페이지가 멈추지 않도록 별도 워커에서 돌린다.
// 모델은 처음 한 번 Hugging Face 에서 내려받고 브라우저 캐시에 남는다.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;

const loaded = new Map();

async function getModel(model) {
  if (!loaded.has(model)) {
    loaded.set(model, pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info) => {
        if (info.status === 'progress' && info.total) {
          self.postMessage({ type: 'download', file: info.file, loaded: info.loaded, total: info.total });
        }
      },
    }));
  }
  try {
    return await loaded.get(model);
  } catch (error) {
    loaded.delete(model);   // 다음 시도에서 다시 받게 한다
    throw error;
  }
}

self.onmessage = async ({ data }) => {
  try {
    const transcriber = await getModel(data.model);
    self.postMessage({ type: 'transcribing' });
    const output = await transcriber(data.audio, {
      language: 'korean',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    self.postMessage({ type: 'done', text: output.text || '', chunks: output.chunks || [] });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
