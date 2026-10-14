// 영상에서 장면 전환 프레임과 16kHz 음성을 꺼낸다. FFmpeg 대신 <video> + <canvas> 로 처리한다.
// 0.25초마다 작은 흑백 썸네일을 비교해, 앞 샘플과 차이가 기준을 넘으면 그 순간을 한 장 저장한다.

const PROBE_W = 36;
const PROBE_H = 64;
const STEP_S = 0.25;
const MIN_GAP_S = 0.7;        // 연달아 바뀌는 효과(깜빡임)로 같은 장면이 여러 장 나오지 않게
const MAX_FRAMES = 24;
const OUT_W = 540;
const JPEG_QUALITY = 0.8;
const SEEK_TIMEOUT_MS = 3000;
const AUDIO_RATE = 16000;     // Whisper 입력 규격
// 슬라이더 1(많이) ~ 5(적게) → 평균 밝기 차이 기준
const THRESHOLDS = { 1: 0.05, 2: 0.08, 3: 0.12, 4: 0.18, 5: 0.25 };
export const SCENE_LABELS = { 1: '아주 많이', 2: '많이', 3: '보통', 4: '적게', 5: '아주 적게' };

function seek(video, time) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    video.currentTime = time;
  });
}

function probe(video, ctx) {
  ctx.drawImage(video, 0, 0, PROBE_W, PROBE_H);
  const { data } = ctx.getImageData(0, 0, PROBE_W, PROBE_H);
  const gray = new Float32Array(PROBE_W * PROBE_H);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  return gray;
}

function difference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function capture(video) {
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * OUT_W) || Math.round(OUT_W * 16 / 9);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * @param {HTMLVideoElement} video 메타데이터를 읽은 영상
 * @param {number} level 1~5
 * @param {(ratio: number) => void} onProgress
 * @returns {Promise<{time: number, src: string}[]>}
 */
export async function extractScenes(video, level, onProgress) {
  const threshold = THRESHOLDS[level] ?? THRESHOLDS[3];
  const duration = video.duration;
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = PROBE_W;
  probeCanvas.height = PROBE_H;
  const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });

  const frames = [];
  let previous = null;
  let lastKept = -Infinity;
  for (let time = 0.05; time < duration && frames.length < MAX_FRAMES; time += STEP_S) {
    await seek(video, time);
    const current = probe(video, ctx);
    const changed = previous && difference(previous, current) > threshold && time - lastKept >= MIN_GAP_S;
    if (!previous || changed) {
      frames.push({ time, src: capture(video) });
      lastKept = time;
    }
    previous = current;
    onProgress(Math.min(time / duration, 1));
  }
  await seek(video, 0);
  return frames;
}

/** @param {File} file @returns {Promise<Float32Array|null>} 소리가 없으면 null */
export async function decodeAudio(file) {
  const context = new AudioContext({ sampleRate: AUDIO_RATE });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const mixed = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mixed[i] += data[i] / buffer.numberOfChannels;
    }
    return mixed;
  } catch (error) {
    return null;
  } finally {
    context.close();
  }
}

export const clock = (seconds) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((seconds - whole) * 10)}`;
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/** 장면을 한 장에 모은다(Claude 에 이미지 하나로 붙여 넣기 위해). @returns {Promise<HTMLCanvasElement>} */
export async function contactSheet(frames) {
  const images = await Promise.all(frames.map((frame) => loadImage(frame.src)));
  const columns = Math.min(4, images.length);
  const cellW = 270;
  const cellH = Math.round((images[0].height / images[0].width) * cellW);
  const label = 28;
  const gap = 8;
  const rows = Math.ceil(images.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellW + (columns + 1) * gap;
  canvas.height = rows * (cellH + label) + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0d18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 16px "IBM Plex Sans KR", sans-serif';
  images.forEach((image, index) => {
    const x = gap + (index % columns) * (cellW + gap);
    const y = gap + Math.floor(index / columns) * (cellH + label + gap);
    ctx.fillStyle = index === 0 ? '#d4ff5c' : '#eef0f7';
    ctx.fillText(`#${index + 1}  ${clock(frames[index].time)}`, x + 2, y + 19);
    ctx.drawImage(image, x, y + label, cellW, cellH);
  });
  return canvas;
}
