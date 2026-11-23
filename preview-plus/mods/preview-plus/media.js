import { exec, appHome, window } from "herdr";
import { localCopyPath } from "./local-copy.js";
import { kind } from "./paths.js";

const MAC_LOCAL_COPY = String.raw`
function localCopySignature(fd, source) {
  ObjC.bindFunction('fgetattrlist', ['int', ['int', 'void *', 'void *', 'unsigned long', 'unsigned long']]);
  // Darwin attrlist: five bitmaps, common device/type/mtime/ctime/file ID, and file data length.
  var fields = $.NSMutableData.dataWithLength(24), bits = fields.mutableBytes;
  bits[0] = 5;
  bits[4] = 0x0a; bits[5] = 0x0c; bits[7] = 0x02; // 0x02000c0a (commonattr)
  bits[17] = 0x02; // 0x00000200 (fileattr)
  // Packed result: length, device, vnode type, two 64-bit timespecs, file ID, data length.
  var attrs = $.NSMutableData.dataWithLength(60);
  if ($.fgetattrlist(fd, fields.mutableBytes, attrs.mutableBytes, 60, 0) !== 0)
    throw new Error('Cannot read metadata for the local copy.');
  var bytes = attrs.mutableBytes;
  if (bytes[8] !== 1 || bytes[0] !== 60) throw new Error('The local copy must be a regular file.');
  return 'local-copy:' + source + ':' + ObjC.unwrap(attrs.base64EncodedStringWithOptions(0));
}

function readLocalCopy(source, metadataOnly) {
  ObjC.bindFunction('open', ['int', ['char *', 'int']]);
  ObjC.bindFunction('close', ['int', ['int']]);
  // O_NOFOLLOW_ANY rejects links in every component. O_NONBLOCK avoids waiting on a FIFO.
  var fd = $.open(source, 0x20000000 | 0x00000004);
  if (fd < 0) throw new Error('This local copy is missing, unreadable, or uses a symbolic link.');
  try {
    var signature = localCopySignature(fd, source);
    if (metadataOnly) return { signature: signature };
    var handle = $.NSFileHandle.alloc.initWithFileDescriptorCloseOnDealloc(fd, false);
    var data = handle.readDataToEndOfFileAndReturnError(null);
    if (data.isNil()) throw new Error('Cannot read the local copy.');
    if (signature !== localCopySignature(fd, source)) throw new Error('The local copy changed during the read.');
    return { signature: signature, data: data };
  } finally { $.close(fd); }
}`;

// Arguments remain separate from executable code, including names containing quotes.
export const MAC_MEDIA = String.raw`
ObjC.import('Foundation');
${MAC_LOCAL_COPY}
function run(args) {
  var source = args[0], cache = args[1], pageNumber = Number(args[2]), pdf = args[3] === 'pdf';
  var metadataOnly = args[3] === 'signature', localCopy = args[4] === 'local-copy';
  var fm = $.NSFileManager.defaultManager;
  var input, signature;
  if (localCopy) {
    input = readLocalCopy(source, metadataOnly);
    signature = input.signature;
  } else {
    var attrs = fm.attributesOfItemAtPathError($(source), null);
    if (!attrs) throw new Error('This file is no longer available or cannot be read.');
    signature = source + ':' + ObjC.unwrap(attrs.objectForKey($.NSFileModificationDate).timeIntervalSince1970) + ':' + ObjC.unwrap(attrs.objectForKey($.NSFileSize));
  }
  if (metadataOnly) return signature;
  ObjC.import('AppKit');
  var hash1 = 2166136261, hash2 = 5381;
  for (var i = 0; i < signature.length; i++) { hash1 = Math.imul(hash1 ^ signature.charCodeAt(i), 16777619); hash2 = Math.imul(hash2, 33) ^ signature.charCodeAt(i); }
  var stamp = (hash1 >>> 0).toString(16) + '-' + (hash2 >>> 0).toString(16);
  var ext = source.split('.').pop().toLowerCase(), width, height, pages = 1, data;
  if (pdf) {
    ObjC.import('PDFKit');
    var document = localCopy ? $.PDFDocument.alloc.initWithData(input.data) : $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath($(source)));
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
    var text = ObjC.unwrap(localCopy ? $.NSString.alloc.initWithDataEncoding(input.data, $.NSUTF8StringEncoding)
      : $.NSString.stringWithContentsOfFileEncodingError($(source), $.NSUTF8StringEncoding, null));
    var box = text.match(/\bviewBox\s*=\s*['"]\s*([-\d.e+]+)[ ,]+([-\d.e+]+)[ ,]+([\d.e+]+)[ ,]+([\d.e+]+)\s*['"]/i);
    var w = text.match(/\bwidth\s*=\s*['"]([\d.]+)(?:px)?['"]/i), h = text.match(/\bheight\s*=\s*['"]([\d.]+)(?:px)?['"]/i);
    width = w ? Number(w[1]) : box ? Number(box[3]) : 300;
    height = h ? Number(h[1]) : box ? Number(box[4]) : 150;
  } else {
    var picture = localCopy ? $.NSImage.alloc.initWithData(input.data) : $.NSImage.alloc.initWithContentsOfFile($(source));
    if (!picture) throw new Error('This image cannot be decoded.');
    var representations = picture.representations, first = representations.objectAtIndex(0);
    width = Number(first.pixelsWide) || picture.size.width;
    height = Number(first.pixelsHigh) || picture.size.height;
  }
  if (!(width > 0 && height > 0)) throw new Error('This file has invalid image dimensions.');
  if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(cache), true, $(), null)) throw new Error('Cannot create the preview cache.');
  var name = (localCopy ? 'local-copy-' : '') + stamp + (pdf ? '-page-' + pageNumber : '') + '.' + ext, destination = cache + '/' + name;
  if (!fm.fileExistsAtPath($(destination))) {
    var temporary = destination + '.' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
    var bytes = pdf ? data : input && input.data;
    var written = bytes ? bytes.writeToFileAtomically($(temporary), true) : fm.copyItemAtPathToPathError($(source), $(temporary), null);
    if (!written) throw new Error('Cannot write the preview cache.');
    if (!fm.moveItemAtPathToPathError($(temporary), $(destination), null)) {
      fm.removeItemAtPathError($(temporary), null);
      if (!fm.fileExistsAtPath($(destination))) throw new Error('Cannot finish the preview cache.');
    }
  }
  if (localCopy) {
    var cached = fm.attributesOfItemAtPathError($(destination), null);
    if (cached.isNil() || ObjC.unwrap(cached.objectForKey($.NSFileType)) !== ObjC.unwrap($.NSFileTypeRegular))
      throw new Error('The preview cache entry must be a regular file.');
  }
  return JSON.stringify({ path: 'mods/preview-plus/.cache/' + name, width: width, height: height, pages: pages, page: pageNumber, signature: signature });
}`;

// Linux/Windows fallback needs Python 3, but no third-party Python packages.
export const PYTHON_IMAGE = String.raw`
import hashlib, json, os, re, shutil, stat, struct, sys, tempfile
source, cache = sys.argv[1:3]
operation, copy_mode = sys.argv[3:5]
local_copy = copy_mode == 'local-copy'
if local_copy:
    sys.tracebacklimit = 0

def open_local_copy():
    if os.open not in os.supports_dir_fd or not hasattr(os, 'O_NOFOLLOW'):
        raise ValueError('Local copies require descriptor-relative file access.')
    # Open each component relative to an already-open directory, rejecting all symlinks.
    dir_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parts = source[1:].split('/')
    directory = os.open('/', dir_flags)
    try:
        for part in parts[:-1]:
            child = os.open(part, dir_flags, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
    except OSError:
        raise ValueError('This local copy is missing, unreadable, or uses a symbolic link.') from None
    finally:
        os.close(directory)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('The local copy must be a regular file.')
        return fd
    except BaseException:
        os.close(fd)
        raise

def signature_of(metadata):
    stamp = f'{source}:{metadata.st_mtime_ns}:{metadata.st_size}'
    if not local_copy:
        return stamp
    return f'local-copy:{stamp}:{metadata.st_dev}:{metadata.st_ino}:{metadata.st_ctime_ns}'

if operation == 'signature' and not local_copy:
    print(signature_of(os.stat(source)))
    sys.exit(0)

def image_dimensions(data, ext):
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
    return width, height

ext = source.rsplit('.', 1)[-1].lower()
with (os.fdopen(open_local_copy(), 'rb') if local_copy else open(source, 'rb')) as handle:
    signature = signature_of(os.fstat(handle.fileno()))
    if operation == 'signature':
        print(signature)
        sys.exit(0)
    width, height = image_dimensions(handle.read(1024 * 1024), ext)
    os.makedirs(cache, exist_ok=True)
    name = ('local-copy-' if local_copy else '') + hashlib.sha256(signature.encode()).hexdigest() + '.' + ext
    destination = os.path.join(cache, name)
    if not os.path.exists(destination):
        fd, temporary = tempfile.mkstemp(dir=cache)
        try:
            with os.fdopen(fd, 'wb') as output:
                handle.seek(0)
                shutil.copyfileobj(handle, output)
            if local_copy and signature != signature_of(os.fstat(handle.fileno())):
                raise ValueError('The local copy changed during the read.')
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    elif local_copy and signature != signature_of(os.fstat(handle.fileno())):
        raise ValueError('The local copy changed during the read.')
    if local_copy and not stat.S_ISREG(os.lstat(destination).st_mode):
        raise ValueError('The preview cache entry must be a regular file.')
print(json.dumps(dict(path='mods/preview-plus/.cache/' + name, width=width, height=height, pages=1, page=1, signature=signature)))
`;

async function mediaHelper(target, roots, page, type) {
  const localCopy = localCopyPath(target, roots);
  if (target.on && !localCopy) throw new Error("Image and PDF previews are only available for local files. To preview a local copy, configure localSyncRoots in Preview Plus.");
  const platform = window()?.platform;
  if (localCopy && (platform === "windows" || !localCopy.startsWith("/") || localCopy.startsWith("//")))
    throw new Error("Local copy unavailable: sync roots require a POSIX path on macOS or Linux.");
  if (platform !== "macos" && (type === "pdf" || (localCopy && kind(localCopy) === "pdf")))
    throw new Error("PDF previews require macOS and PDFKit." + (target.on ? "" : " Use Open to view this file."));
  const file = localCopy || target.file, mode = localCopy ? "local-copy" : "local";
  const cache = `${appHome()}/mods/preview-plus/.cache`;
  const result = platform === "macos"
    ? await exec("osascript", ["-l", "JavaScript", "-e", MAC_MEDIA, file, cache, String(page), type, mode])
    : await exec(platform === "windows" ? "python" : "python3", ["-c", PYTHON_IMAGE, file, cache, type, mode]);
  if (result.code !== 0) throw new Error((localCopy ? "Local copy unavailable: " : "") + (result.stderr.trim() || "Cannot read this file."));
  return result.stdout.trim();
}

export async function loadMedia(target, page = 1, type = "image", roots = []) {
  const media = JSON.parse(await mediaHelper(target, roots, page, type));
  if (!media.path?.startsWith("mods/preview-plus/.cache/") || !(media.width > 0 && media.height > 0 && media.pages > 0)) throw new Error("The media preview returned invalid data.");
  return media;
}

export function mediaSignature(target, roots = []) {
  return mediaHelper(target, roots, 1, "signature");
}

export async function openFile(target) {
  if (target.on) throw new Error("Open is only available for local files.");
  const platform = window()?.platform;
  const command = platform === "macos" ? "open" : platform === "windows" ? "explorer.exe" : "xdg-open";
  const result = await exec(command, [target.file]);
  if (result.code !== 0) throw new Error("The system application could not open this file.");
}
