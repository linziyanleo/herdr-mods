import { exec, appHome, window } from "herdr";
import { mediaSource } from "./local-copy.js";

// Also check physical paths: a symlink inside a sync root must not grant access outside it.
const MAC_LOCAL_COPY_CHECK = String.raw`
function checkLocalCopy(source, rootsJSON) {
  var roots = JSON.parse(rootsJSON || '[]');
  if (!roots.length) return;
  if (!$.NSFileManager.defaultManager.fileExistsAtPath($(source)))
    throw new Error('This local copy is missing or cannot be read.');
  function physical(path) { return ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath); }
  var file = physical(source);
  if (!roots.some(function(root) { var base = physical(root); return file.indexOf(base.replace(/\/$/, '') + '/') === 0; }))
    throw new Error('The local copy resolves outside the configured sync roots.');
}`;

const PYTHON_LOCAL_COPY_CHECK = String.raw`
def check_local_copy(source, roots):
    if not roots:
        return
    source_path = os.path.normcase(os.path.realpath(source))
    def inside(root):
        base = os.path.normcase(os.path.realpath(root))
        try:
            return source_path != base and os.path.commonpath([source_path, base]) == base
        except ValueError:
            return False
    if not any(inside(root) for root in roots):
        raise ValueError('The local copy resolves outside the configured sync roots.')
`;

// Arguments remain separate from executable code, including names containing quotes.
export const MAC_MEDIA = String.raw`
ObjC.import('Foundation');
ObjC.import('AppKit');
${MAC_LOCAL_COPY_CHECK}
function run(args) {
  var source = args[0], cache = args[1], pageNumber = Number(args[2]), pdf = args[3] === 'pdf';
  checkLocalCopy(source, args[4]);
  var fm = $.NSFileManager.defaultManager;
  var attrs = fm.attributesOfItemAtPathError($(source), null);
  if (!attrs) throw new Error('This file is no longer available or cannot be read.');
  var signature = source + ':' + ObjC.unwrap(attrs.objectForKey($.NSFileModificationDate).timeIntervalSince1970) + ':' + ObjC.unwrap(attrs.objectForKey($.NSFileSize));
  var hash1 = 2166136261, hash2 = 5381;
  for (var i = 0; i < signature.length; i++) { hash1 = Math.imul(hash1 ^ signature.charCodeAt(i), 16777619); hash2 = Math.imul(hash2, 33) ^ signature.charCodeAt(i); }
  var stamp = (hash1 >>> 0).toString(16) + '-' + (hash2 >>> 0).toString(16);
  var ext = source.split('.').pop().toLowerCase(), width, height, pages = 1, data;
  if (pdf) {
    ObjC.import('PDFKit');
    var document = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath($(source)));
    if (!document || document.isLocked) throw new Error('This PDF is locked or cannot be read.');
    pages = Number(document.pageCount);
    if (!pages) throw new Error('This PDF has no pages.');
    pageNumber = Math.max(1, Math.min(pages, pageNumber));
    var page = document.pageAtIndex(pageNumber - 1), bounds = page.boundsForBox(0);
    width = bounds.size.width; height = bounds.size.height;
    var scale = Math.min(2, 2048 / Math.max(width, height));
    var bitmap = page.thumbnailOfSizeForBox($.NSMakeSize(width * scale, height * scale), 0);
    var rep = $.NSBitmapImageRep.imageRepWithData(bitmap.TIFFRepresentation);
    width = Number(rep.pixelsWide); height = Number(rep.pixelsHigh);
    data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
    ext = 'png';
  } else if (ext === 'svg') {
    var text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(source), $.NSUTF8StringEncoding, null));
    var box = text.match(/\bviewBox\s*=\s*['"]\s*([-\d.e+]+)[ ,]+([-\d.e+]+)[ ,]+([\d.e+]+)[ ,]+([\d.e+]+)\s*['"]/i);
    var w = text.match(/\bwidth\s*=\s*['"]([\d.]+)(?:px)?['"]/i), h = text.match(/\bheight\s*=\s*['"]([\d.]+)(?:px)?['"]/i);
    width = w ? Number(w[1]) : box ? Number(box[3]) : 300;
    height = h ? Number(h[1]) : box ? Number(box[4]) : 150;
  } else {
    var picture = $.NSImage.alloc.initWithContentsOfFile($(source));
    if (!picture) throw new Error('This image cannot be decoded.');
    var representations = picture.representations, first = representations.objectAtIndex(0);
    width = Number(first.pixelsWide) || picture.size.width;
    height = Number(first.pixelsHigh) || picture.size.height;
  }
  if (!(width > 0 && height > 0)) throw new Error('This file has invalid image dimensions.');
  if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(cache), true, $(), null)) throw new Error('Cannot create the preview cache.');
  var name = stamp + (pdf ? '-page-' + pageNumber : '') + '.' + ext, destination = cache + '/' + name;
  if (!fm.fileExistsAtPath($(destination))) {
    var temporary = destination + '.' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
    var written = pdf ? data.writeToFileAtomically($(temporary), true) : fm.copyItemAtPathToPathError($(source), $(temporary), null);
    if (!written) throw new Error('Cannot write the preview cache.');
    if (!fm.moveItemAtPathToPathError($(temporary), $(destination), null)) {
      fm.removeItemAtPathError($(temporary), null);
      if (!fm.fileExistsAtPath($(destination))) throw new Error('Cannot finish the preview cache.');
    }
  }
  return JSON.stringify({ path: 'mods/preview-plus/.cache/' + name, width: width, height: height, pages: pages, page: pageNumber, signature: signature });
}`;

// Linux/Windows fallback needs Python 3, but no third-party Python packages.
export const PYTHON_IMAGE = String.raw`
import hashlib, json, os, re, shutil, struct, sys, tempfile
${PYTHON_LOCAL_COPY_CHECK}
source, cache = sys.argv[1:3]
check_local_copy(source, json.loads(sys.argv[3]) if len(sys.argv) > 3 else [])
stat = os.stat(source)
signature = source + ':' + str(stat.st_mtime_ns) + ':' + str(stat.st_size)
ext = source.rsplit('.', 1)[-1].lower()
with open(source, 'rb') as handle:
    data = handle.read(1024 * 1024)
if ext == 'svg':
    text = data.decode('utf-8-sig')
    box = re.search(r'\bviewBox\s*=\s*[\x22\x27]([^\x22\x27]+)', text, re.I)
    box = [float(n) for n in re.split(r'[ ,]+', box[1].strip())] if box else [0, 0, 300, 150]
    def dimension(key, fallback):
        match = re.search(r'\b' + key + r'\s*=\s*[\x22\x27]([\d.]+)(?:px)?[\x22\x27]', text, re.I)
        return float(match[1]) if match else fallback
    width, height = dimension('width', box[2]), dimension('height', box[3])
elif data.startswith(b'\x89PNG\r\n\x1a\n'):
    width, height = struct.unpack('>II', data[16:24])
elif data.startswith(b'\xff\xd8'):
    i = 2
    while i < len(data):
        if data[i] != 255: i += 1; continue
        while data[i] == 255: i += 1
        marker = data[i]; i += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7: continue
        size = int.from_bytes(data[i:i+2], 'big')
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            height, width = struct.unpack('>HH', data[i+3:i+7]); break
        if size < 2: raise ValueError('Invalid JPEG')
        i += size
    else: raise ValueError('Cannot read JPEG dimensions')
elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
    if data[12:16] == b'VP8X':
        width, height = 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little')
    elif data[12:16] == b'VP8L':
        bits = int.from_bytes(data[21:25], 'little'); width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
    else:
        width, height = struct.unpack('<HH', data[26:30]); width &= 0x3fff; height &= 0x3fff
else: raise ValueError('This image format cannot be decoded')
if width <= 0 or height <= 0: raise ValueError('Invalid image dimensions')
os.makedirs(cache, exist_ok=True)
name = hashlib.sha256(signature.encode()).hexdigest() + '.' + ext
destination = os.path.join(cache, name)
if not os.path.exists(destination):
    fd, temporary = tempfile.mkstemp(dir=cache)
    os.close(fd)
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
print(json.dumps(dict(path='mods/preview-plus/.cache/' + name, width=width, height=height, pages=1, page=1, signature=signature)))
`;

export async function loadMedia(target, page = 1, type = "image", roots = []) {
  const source = mediaSource(target, roots);
  const platform = window()?.platform;
  if (type === "pdf" && platform !== "macos") throw new Error("PDF previews require macOS and PDFKit." + (target.on ? "" : " Use Open to view this file."));
  const cache = `${appHome()}/mods/preview-plus/.cache`;
  const result = platform === "macos"
    ? await exec("osascript", ["-l", "JavaScript", "-e", MAC_MEDIA, source.file, cache, String(page), type, JSON.stringify(source.syncRoots || [])])
    : await exec(platform === "windows" ? "python" : "python3", ["-c", PYTHON_IMAGE, source.file, cache, JSON.stringify(source.syncRoots || [])]);
  if (result.code !== 0) throw new Error((source.localCopy ? "Local copy unavailable: " : "") + (result.stderr.trim() || "Cannot preview this file."));
  const media = JSON.parse(result.stdout.trim());
  if (!media.path?.startsWith("mods/preview-plus/.cache/") || !(media.width > 0 && media.height > 0 && media.pages > 0)) throw new Error("The media preview returned invalid data.");
  return { ...media, localCopy: Boolean(source.localCopy) };
}

export async function mediaSignature(target, roots = []) {
  const source = mediaSource(target, roots);
  const platform = window()?.platform;
  const result = platform === "macos"
    ? await exec("osascript", ["-l", "JavaScript", "-e", `ObjC.import('Foundation'); ${MAC_LOCAL_COPY_CHECK} function run(args) { checkLocalCopy(args[0], args[1]); var attrs=$.NSFileManager.defaultManager.attributesOfItemAtPathError($(args[0]),null); if(!attrs) throw new Error('This file is no longer available or cannot be read.'); return args[0]+':'+ObjC.unwrap(attrs.objectForKey($.NSFileModificationDate).timeIntervalSince1970)+':'+ObjC.unwrap(attrs.objectForKey($.NSFileSize)); }`, source.file, JSON.stringify(source.syncRoots || [])])
    : await exec(platform === "windows" ? "python" : "python3", ["-c", `import os,sys,json
${PYTHON_LOCAL_COPY_CHECK}
check_local_copy(sys.argv[1], json.loads(sys.argv[2]))
s=os.stat(sys.argv[1]); print(sys.argv[1]+':'+str(s.st_mtime_ns)+':'+str(s.st_size))`, source.file, JSON.stringify(source.syncRoots || [])]);
  if (result.code !== 0) throw new Error((source.localCopy ? "Local copy unavailable: " : "") + (result.stderr.trim() || "Cannot read media metadata."));
  return result.stdout.trim();
}

export async function openFile(target) {
  if (target.on) throw new Error("Open is only available for local files.");
  const platform = window()?.platform;
  const command = platform === "macos" ? "open" : platform === "windows" ? "explorer.exe" : "xdg-open";
  const result = await exec(command, [target.file]);
  if (result.code !== 0) throw new Error("The system application could not open this file.");
}
