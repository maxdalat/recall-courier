// Validates where a media file comes from (local path, base64 data, or https URL) before Anki stores it.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ToolError } from './errors.js';

const EXTENSIONS = {
  picture: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'tif', 'tiff'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'spx'],
  video: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'ogv', '3gp', 'mpeg', 'mpg'],
};
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function mediaKind(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return Object.keys(EXTENSIONS).find((kind) => EXTENSIONS[kind].includes(ext)) ?? null;
}

export function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return !h.includes('.'); // bare hostnames such as "intranet"
}

export function checkFilename(filename) {
  if (!filename || /[\\/\0]/.test(filename) || filename.startsWith('.') || filename.length > 120) {
    throw new ToolError(
      `"${filename}" is not a usable media file name. Use a plain name like "diagram.png" with no folders, no leading dot, and at most 120 characters.`,
    );
  }
  if (!mediaKind(filename)) {
    throw new ToolError(
      `"${filename}" does not look like an image, audio or video file. Allowed extensions: ${Object.values(EXTENSIONS).flat().join(', ')}.`,
    );
  }
}

// Returns AnkiConnect parameters { filename, path | url | data } or throws a ToolError.
export function validateMediaSource({ filename, path: filePath, url, data_base64: data }) {
  const given = [filePath, url, data].filter((v) => v !== undefined && v !== '');
  if (given.length !== 1) {
    throw new ToolError('Give exactly one source for each media file: path (a local file), url (https), or data_base64.');
  }
  if (filePath !== undefined) {
    const expanded = filePath === '~' || filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(1)) : filePath;
    if (!path.isAbsolute(expanded)) throw new ToolError(`"${filePath}" is not an absolute path. Give the full path, e.g. /Users/me/Pictures/cat.png.`);
    if (!existsSync(expanded) || !statSync(expanded).isFile()) throw new ToolError(`No file exists at "${filePath}". Check the path and try again.`);
    if (statSync(expanded).size > MAX_FILE_BYTES) throw new ToolError(`"${filePath}" is larger than 100 MB, which is too big for an Anki card.`);
    const name = filename || path.basename(expanded);
    checkFilename(name);
    return { filename: name, path: expanded };
  }
  if (!filename) throw new ToolError('filename is required when the source is a url or data_base64 (for example "cat.png").');
  checkFilename(filename);
  if (url !== undefined) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new ToolError(`"${url}" is not a valid URL. Give a full https:// address.`);
    }
    if (parsed.protocol !== 'https:') throw new ToolError(`Only https:// URLs are accepted (got ${parsed.protocol}//). Use an https link, or download the file and pass its path.`);
    if (parsed.username || parsed.password) throw new ToolError('URLs with a username or password are not accepted. Download the file and pass its path instead.');
    if (isPrivateHost(parsed.hostname)) throw new ToolError(`"${parsed.hostname}" is a local or private address, which is not accepted. Use a public https URL, or pass a local file path.`);
    return { filename, url: parsed.toString() };
  }
  const compact = data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new ToolError('data_base64 is not valid base64. Encode the raw file bytes with standard base64 (no data: prefix).');
  }
  if (compact.length * 0.75 > MAX_FILE_BYTES) throw new ToolError('data_base64 decodes to more than 100 MB, which is too big for an Anki card.');
  return { filename, data: compact };
}
