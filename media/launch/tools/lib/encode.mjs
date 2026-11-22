/* ffmpeg settings for each output (craft bible part 10). Raw RGB frames go in on stdin; nothing is ever written to disk
   as an image sequence.

     h264      H.264 High, CRF 14 (preview: 23), yuv420p, BT.709 tagged, limited range, +faststart (the 16:9 and 9:16 posts)
     prores    ProRes 4444, 10-bit 4:4:4 (the archive master)
     lossless  FFV1, RGB, exact pixels (the exact master; also what determinism checks compare)
     png       one frame to a PNG (still mode) */
import { spawn } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
export const EXT = { h264: '.mp4', prores: '.mov', lossless: '.mkv', png: '.png' };

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

export function videoArgs(codec, o) {
  const input = ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', o.width + 'x' + o.height, '-r', String(o.fps), '-i', 'pipe:0'];
  const yuv = (fmt) => ['-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bitexact,format=' + fmt];
  switch (codec) {
    case 'h264':
      return [...input, ...yuv('yuv420p'), '-c:v', 'libx264', '-preset', o.preview ? 'veryfast' : 'slow', '-crf', String(o.crf ?? (o.preview ? 23 : 14)),
        '-profile:v', 'high', '-threads', String(o.threads ?? 2), ...BT709, '-color_range', 'tv', '-movflags', '+faststart', '-y', o.out];
    case 'prores':
      return [...input, ...yuv('yuv444p10le'), '-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-threads', String(o.threads ?? 2), ...BT709, '-color_range', 'tv', '-y', o.out];
    case 'lossless':
      return [...input, '-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '4', '-pix_fmt', 'bgr0', '-threads', String(o.threads ?? 2), '-y', o.out];
    case 'png':
      return [...input, '-frames:v', '1', '-y', o.out];
    default:
      throw new Error('unknown codec ' + codec + ' (h264, prores, lossless, png)');
  }
}

/** an ffmpeg process fed raw frames; write(buf) respects back-pressure; end() resolves when the file is complete */
export function encoder(codec, o) {
  const p = spawn(FFMPEG, videoArgs(codec, o), { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (b) => { err += b; });
  const done = new Promise((ok, fail) => p.on('close', (c) => (c === 0 ? ok() : fail(new Error('ffmpeg exited ' + c + ': ' + err.slice(-2000))))));
  done.catch(() => undefined);
  return {
    async write(buf) { if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r)); },
    async end() { p.stdin.end(); await done; }
  };
}

export function run(args) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', (c) => (c === 0 ? ok(out) : fail(new Error('ffmpeg ' + args.join(' ') + '\n' + err.slice(-2000)))));
  });
}

/** join segments without re-encoding; mux a wav when given (AAC 320k 48 kHz for mp4, 24-bit PCM for mov/mkv), padded
    or cut to the picture's exact length */
export async function concat(segments, out, o = {}) {
  const { writeFile, rm } = await import('node:fs/promises');
  const list = out + '.list.txt';
  await writeFile(list, segments.map((s) => "file '" + s.replace(/'/g, "'\\''") + "'").join('\n') + '\n');
  const args = ['-f', 'concat', '-safe', '0', '-i', list];
  if (o.audio) args.push('-i', o.audio, '-map', '0:v', '-map', '1:a', '-af', 'apad', '-t', String(o.duration));
  args.push('-c:v', 'copy');
  if (o.audio) args.push(...(out.endsWith('.mp4') ? ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'] : ['-c:a', 'pcm_s24le', '-ar', '48000']));
  if (out.endsWith('.mp4')) args.push('-movflags', '+faststart');
  args.push('-y', out);
  await run(args);
  await rm(list, { force: true });
}

/** put a wav under an existing video (the audio mux step) */
export async function mux(video, wav, out) {
  const dur = await probeDuration(video);
  const aac = out.endsWith('.mp4');
  await run(['-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'apad', '-t', String(dur),
    ...(aac ? ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart'] : ['-c:a', 'pcm_s24le', '-ar', '48000']), '-y', out]);
}

export async function probe(file) {
  const { execFileSync } = await import('node:child_process');
  const j = JSON.parse(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-count_frames', file]).toString());
  return j;
}
export async function probeDuration(file) {
  const { execFileSync } = await import('node:child_process');
  return Number(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}
