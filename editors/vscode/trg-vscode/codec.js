/**
 * codec.js
 * Pure JavaScript implementation of the TRG Codec.
 * Strictly implements:
 * - 64-Byte Master Container Header Block (Cache Line 0)
 * - 8-Bit ScriptIDs (1..255; registered: 1=English, 2=Bengali, 3=Hindi, 4=Tamil)
 * - Pure Integer Codepoint Bijective Dense Glyph Sequences
 * - 6 Strict Container & Slot Validation Checks
 * - CRLF Normalization (\r\n -> \n)
 */

const TRG_MAGIC_BYTE = 0x54; // 'T'
const TRG_PAYLOAD_OFFSET = 64;

const TRG_SCRIPT_SYNTAX = 0;
const TRG_SCRIPT_ENGLISH = 1;
const TRG_SCRIPT_BENGALI = 2;
const TRG_SCRIPT_HINDI = 3;
const TRG_SCRIPT_TAMIL = 4;

const INDIC_DANDA = 0x0964;         // '।'
const INDIC_DOUBLE_DANDA = 0x0965;  // '॥'

const OPERATOR_CHARS = "+-*/%=<>!&|^~?@#";
const DELIMITER_CHARS = [
    ' ', '\n', '\t', '_',
    '(', ')', '[', ']',
    '{', '}', ';', ':',
    ',', '.', '"', "'"
];

const OPERATOR_MAP = new Map();
const INV_OPERATOR_MAP = new Map();
for (let i = 0; i < OPERATOR_CHARS.length; i++) {
    const c = OPERATOR_CHARS[i];
    OPERATOR_MAP.set(c, 0x70 + i);
    INV_OPERATOR_MAP.set(0x70 + i, c);
}

const DELIMITER_MAP = new Map();
const INV_DELIMITER_MAP = new Map();
for (let i = 0; i < DELIMITER_CHARS.length; i++) {
    const c = DELIMITER_CHARS[i];
    DELIMITER_MAP.set(c, 0xF0 + i);
    INV_DELIMITER_MAP.set(0xF0 + i, c);
}

// Pure Integer Codepoint Construction
const BN_HOLES = new Set([4, 13, 14, 17, 18, 41, 49, 51, 52, 53, 58, 59, 69, 70, 73, 74, 79, 80, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 94, 100, 101, 127]);
const HI_HOLES = new Set([0, 58, 59, 78, 79, 83, 84, 85, 86, 87, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127]);
const TA_HOLES = new Set([0, 1, 4, 11, 12, 13, 17, 22, 23, 24, 27, 29, 32, 33, 34, 37, 38, 39, 43, 44, 45, 58, 59, 60, 61, 67, 68, 69, 73, 78, 79, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 123, 124, 125, 126, 127]);

function buildGlyphs(base, holes, extras = []) {
    const chars = [];
    for (let i = 0; i < 128; i++) {
        if (!holes.has(i)) chars.push(String.fromCharCode(base + i));
    }
    for (const cp of extras) chars.push(String.fromCharCode(cp));
    const s = chars.join("");
    const unique = new Set(s);
    if (s.length > 112 || unique.size !== s.length) {
        throw new Error(`Invalid glyph string: len=${s.length}, unique=${unique.size}`);
    }
    return s;
}

function buildEnglish() {
    const chars = [];
    for (let i = 65; i <= 90; i++) chars.push(String.fromCharCode(i));
    for (let i = 97; i <= 122; i++) chars.push(String.fromCharCode(i));
    for (let i = 48; i <= 57; i++) chars.push(String.fromCharCode(i));
    return chars.join("");
}

const SCRIPT_GLYPHS = {
    [TRG_SCRIPT_ENGLISH]: buildEnglish(),
    [TRG_SCRIPT_BENGALI]: buildGlyphs(0x0980, BN_HOLES, [0x0964, 0x0965]),
    [TRG_SCRIPT_HINDI]: buildGlyphs(0x0900, HI_HOLES),
    [TRG_SCRIPT_TAMIL]: buildGlyphs(0x0B80, TA_HOLES, [0x0964, 0x0965])
};

const ENCODE_MAP = {};
for (const [sid, g] of Object.entries(SCRIPT_GLYPHS)) {
    const map = new Map();
    for (let i = 0; i < g.length; i++) {
        map.set(g[i], i);
    }
    ENCODE_MAP[sid] = map;
}

function detectScriptIds(text) {
    const scripts = [];
    let hasDanda = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (OPERATOR_MAP.has(c) || DELIMITER_MAP.has(c)) {
            continue;
        }
        if (c === "\u0964" || c === "\u0965") {
            hasDanda = true;
            continue;
        }
        let sc = null;
        for (const sid of [TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL]) {
            if (ENCODE_MAP[sid].has(c)) {
                sc = sid;
                break;
            }
        }
        if (sc !== null && !scripts.includes(sc)) {
            scripts.push(sc);
        }
    }

    if (hasDanda) {
        if (scripts.some(s => s === TRG_SCRIPT_BENGALI || s === TRG_SCRIPT_HINDI || s === TRG_SCRIPT_TAMIL)) {
            // Fold into Indic script
        } else if (scripts.length < 2) {
            scripts.push(TRG_SCRIPT_HINDI);
        }
    }

    // Pure syntax strings or empty strings deterministically default script_a = 1 (English)
    if (scripts.length === 0) return [TRG_SCRIPT_ENGLISH, 0];
    if (scripts.length === 1) return [scripts[0], 0];
    if (scripts.length === 2) return [scripts[0], scripts[1]];

    throw new Error(
        `Multi-script violation (Fail Fast): Text requires ${scripts.length} scripts (${scripts.join(", ")}), max 2 allowed.`
    );
}

/**
 * Decodes a TRG binary buffer into text.
 * Enforces strict validation:
 * 1. Exact length (64 + length)
 * 2. Magic byte (0x54 'T')
 * 3. Reserved flags (must be 0)
 * 4. Header padding (all 56 bytes must be 0)
 * 5. Script IDs (script_a in 1..4, script_b in 0..4)
 * 6. Slot bounds per character
 */
function trgDecode(buf) {
    if (!Buffer.isBuffer(buf)) {
        buf = Buffer.from(buf);
    }
    if (buf.length < TRG_PAYLOAD_OFFSET) {
        throw new Error(`File is too small to be a TRG container (${buf.length} bytes, minimum ${TRG_PAYLOAD_OFFSET} required).`);
    }

    const length = buf.readUInt32LE(0);
    const scriptA = buf.readUInt8(4);
    const scriptB = buf.readUInt8(5);
    const flags = buf.readUInt8(6);
    const magic = buf.readUInt8(7);

    if (magic !== TRG_MAGIC_BYTE) {
        throw new Error(`Invalid TRG magic byte: 0x${magic.toString(16).toUpperCase()} (expected 0x54 'T').`);
    }

    if (flags !== 0) {
        throw new Error(`Non-zero reserved flags in byte 6: 0x${flags.toString(16).toUpperCase()} (expected 0).`);
    }

    for (let i = 8; i < TRG_PAYLOAD_OFFSET; i++) {
        if (buf[i] !== 0) {
            throw new Error(`Dirty non-zero padding in header bytes 8..63 at index ${i}.`);
        }
    }

    if (![TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL].includes(scriptA) ||
        ![0, TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL].includes(scriptB)) {
        throw new Error(`Unsupported Script ID (Fail Fast): scriptA=${scriptA}, scriptB=${scriptB}.`);
    }

    const expectedTotal = TRG_PAYLOAD_OFFSET + length;
    if (buf.length !== expectedTotal) {
        throw new Error(`TRG size mismatch: expected ${expectedTotal} bytes, got ${buf.length} bytes.`);
    }

    const payload = buf.subarray(TRG_PAYLOAD_OFFSET, TRG_PAYLOAD_OFFSET + length);
    const chars = [];
    const glyphsA = SCRIPT_GLYPHS[scriptA];
    const glyphsB = scriptB ? SCRIPT_GLYPHS[scriptB] : "";

    for (let i = 0; i < payload.length; i++) {
        const b = payload[i];
        if (b >= 0x70 && b <= 0x7F) {
            chars.push(INV_OPERATOR_MAP.get(b));
        } else if (b >= 0xF0 && b <= 0xFF) {
            chars.push(INV_DELIMITER_MAP.get(b));
        } else if (b <= 0x6F) {
            if (b >= glyphsA.length) {
                throw new Error(`Payload slot 0x${b.toString(16).toUpperCase()} (${b}) exceeds declared glyphs for Script A (${scriptA}, max ${glyphsA.length}).`);
            }
            chars.push(glyphsA[b]);
        } else { // 0x80..0xEF
            if (scriptB === 0) {
                throw new Error("Payload uses high-bank byte but Script B is undeclared (0).");
            }
            const slot = b - 0x80;
            if (slot >= glyphsB.length) {
                throw new Error(`Payload slot 0x${slot.toString(16).toUpperCase()} (${slot}) exceeds declared glyphs for Script B (${scriptB}, max ${glyphsB.length}).`);
            }
            chars.push(glyphsB[slot]);
        }
    }

    return {
        text: chars.join(""),
        scriptA,
        scriptB,
        length,
        flags
    };
}

/**
 * Encodes text into a TRG binary buffer.
 * Output size: strictly 64 + text.length bytes.
 */
function trgEncode(text) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const [scriptA, scriptB] = detectScriptIds(text);

    const buf = Buffer.alloc(TRG_PAYLOAD_OFFSET + text.length);
    buf.writeUInt32LE(text.length, 0);
    buf.writeUInt8(scriptA, 4);
    buf.writeUInt8(scriptB, 5);
    buf.writeUInt8(0, 6);
    buf.writeUInt8(TRG_MAGIC_BYTE, 7);

    const mapA = ENCODE_MAP[scriptA] || new Map();
    const mapB = scriptB ? (ENCODE_MAP[scriptB] || new Map()) : new Map();

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (OPERATOR_MAP.has(c)) {
            buf[TRG_PAYLOAD_OFFSET + i] = OPERATOR_MAP.get(c);
        } else if (DELIMITER_MAP.has(c)) {
            buf[TRG_PAYLOAD_OFFSET + i] = DELIMITER_MAP.get(c);
        } else if (mapA.has(c)) {
            buf[TRG_PAYLOAD_OFFSET + i] = mapA.get(c);
        } else if (scriptB && mapB.has(c)) {
            buf[TRG_PAYLOAD_OFFSET + i] = 0x80 | mapB.get(c);
        } else {
            const cp = text.charCodeAt(i);
            throw new Error(
                `Character '${c}' (U+${cp.toString(16).toUpperCase()}) cannot fit into Script A (${scriptA}) or Script B (${scriptB}) or Universal Syntax Apertures.`
            );
        }
    }

    return buf;
}

module.exports = {
    trgDecode,
    trgEncode,
    TRG_MAGIC_BYTE,
    TRG_PAYLOAD_OFFSET,
    TRG_SCRIPT_SYNTAX,
    TRG_SCRIPT_ENGLISH,
    TRG_SCRIPT_BENGALI,
    TRG_SCRIPT_HINDI,
    TRG_SCRIPT_TAMIL,
    SCRIPT_GLYPHS
};
