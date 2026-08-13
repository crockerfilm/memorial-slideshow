// Renders the slideshow into a single 1920x1080/30fps mp4 as fast as the
// machine can encode, instead of playing it back in real time. Stills
// (title card, closing card, photos) are drawn with Canvas 2D -- matching
// the on-screen CSS look pixel-for-pixel, since it's the same colors/fonts
// -- then handed to ffmpeg.wasm as a timed segment. Actual video clips get
// the same blurred-background-fill treatment applied via an ffmpeg filter
// instead (re-implementing that per frame in Canvas would mean decoding
// the video in real time again, defeating the point). Segments are
// concatenated with a stream copy (no re-encode) and background music is
// mixed in on top in one final pass.
import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12/+esm';
import { toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12/+esm';

const W = 1920, H = 1080, FPS = 30;
const COLORS = { bg: '#0a0a0a', ink: '#e9e5dc', inkDim: '#9c968a', accent: '#b08d57' };
const SERIF = 'Georgia, "Times New Roman", serif';

function canvasToBlob(canvas){
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function drawTitleCardFrame(ctx, settings){
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  const cx = W / 2;
  let y = H / 2 - 60;

  ctx.fillStyle = COLORS.ink;
  ctx.font = `400 78px ${SERIF}`;
  ctx.fillText(settings.title || '', cx, y);

  y += 50;
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 60, y);
  ctx.lineTo(cx + 60, y);
  ctx.stroke();

  if(settings.subtitle){
    y += 60;
    ctx.fillStyle = COLORS.inkDim;
    ctx.font = `italic 400 30px ${SERIF}`;
    ctx.fillText(settings.subtitle, cx, y);
  }
  if(settings.dates){
    y += 48;
    ctx.fillStyle = COLORS.inkDim;
    ctx.font = `400 24px ${SERIF}`;
    ctx.fillText(settings.dates, cx, y);
  }
}

function drawClosingCardFrame(ctx, settings){
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  const cx = W / 2;
  let y = H / 2 - 20;

  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 60, y);
  ctx.lineTo(cx + 60, y);
  ctx.stroke();

  y += 50;
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = `italic 400 30px ${SERIF}`;
  wrapText(ctx, settings.closing_message || 'Thank you.', cx, y, W * 0.7, 40);
}

function wrapText(ctx, text, cx, y, maxWidth, lineHeight){
  const words = text.split(' ');
  let line = '';
  const lines = [];
  for(const word of words){
    const test = line ? line + ' ' + word : word;
    if(ctx.measureText(test).width > maxWidth && line){
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if(line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight));
}

async function drawPhotoFrame(ctx, img, caption){
  ctx.save();
  ctx.filter = 'blur(42px) brightness(0.4) saturate(1.15)';
  const coverScale = Math.max(W / img.width, H / img.height);
  const cw = img.width * coverScale, ch = img.height * coverScale;
  ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
  ctx.restore();

  const containScale = Math.min(W / img.width, H / img.height);
  const fw = img.width * containScale, fh = img.height * containScale;
  ctx.drawImage(img, (W - fw) / 2, (H - fh) / 2, fw, fh);

  if(caption){
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `italic 400 30px ${SERIF}`;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText(caption, W / 2, H * 0.92);
    ctx.shadowBlur = 0;
  }
}

async function loadImage(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function renderBackupVideo({ settings, slides, publicUrl, onProgress }){
  const report = (msg) => onProgress && onProgress(msg);

  report('Loading video engine…');
  const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12/dist/umd';
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    classWorkerURL: await toBlobURL('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12/dist/esm/worker.js', 'text/javascript')
  });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const segmentFiles = [];
  let segIdx = 0;

  async function stillSegment(drawFn, durationSec){
    await drawFn();
    const blob = await canvasToBlob(canvas);
    const name = `still${segIdx}.png`;
    ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    const segName = `seg${segIdx}.mp4`;
    await ffmpeg.exec([
      '-loop', '1', '-i', name,
      '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
      '-t', String(durationSec),
      '-r', String(FPS),
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-c:a', 'aac', '-shortest',
      segName
    ]);
    segmentFiles.push(segName);
    segIdx++;
  }

  async function videoSegment(url, audioEnabled){
    const data = await (await fetch(url)).arrayBuffer();
    const inName = `vid${segIdx}.input`;
    ffmpeg.writeFile(inName, new Uint8Array(data));
    const segName = `seg${segIdx}.mp4`;
    const filter = "split=2[bg][fg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20,eq=brightness=-0.35[bgb];[fg]scale=1920:1080:force_original_aspect_ratio=decrease[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]";
    const args = ['-i', inName, '-filter_complex', filter, '-map', '[v]'];
    if(audioEnabled){
      args.push('-map', '0:a?');
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '1:a', '-shortest');
    }
    args.push('-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', segName);
    await ffmpeg.exec(args);
    segmentFiles.push(segName);
    segIdx++;
  }

  report('Rendering title card…');
  await stillSegment(() => drawTitleCardFrame(ctx, settings), 5);

  let i = 0;
  for(const s of slides){
    i++;
    report(`Rendering ${i} of ${slides.length}…`);
    const url = await publicUrl(s.storage_path);
    if(s.type === 'video'){
      await videoSegment(url, s.audio_enabled !== false);
    } else {
      const img = await loadImage(url);
      await stillSegment(() => drawPhotoFrame(ctx, img, s.caption), settings.photo_seconds || 6);
    }
  }

  report('Rendering closing card…');
  await stillSegment(() => drawClosingCardFrame(ctx, settings), 8);

  report('Stitching segments together…');
  const listContent = segmentFiles.map(f => `file '${f}'`).join('\n');
  ffmpeg.writeFile('list.txt', listContent);
  await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'concatenated.mp4']);

  let finalName = 'concatenated.mp4';
  if(settings.music_path){
    report('Mixing in background music…');
    const musicUrl = await publicUrl(settings.music_path);
    const musicData = await (await fetch(musicUrl)).arrayBuffer();
    ffmpeg.writeFile('music.input', new Uint8Array(musicData));
    await ffmpeg.exec([
      '-i', 'concatenated.mp4', '-i', 'music.input',
      '-filter_complex', '[1:a]aloop=loop=-1:size=2000000000,volume=0.5[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]',
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest',
      'final.mp4'
    ]);
    finalName = 'final.mp4';
  }

  report('Finishing up…');
  const outData = await ffmpeg.readFile(finalName);
  return new Blob([outData.buffer], { type: 'video/mp4' });
}
