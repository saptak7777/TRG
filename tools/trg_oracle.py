#!/usr/bin/env python3
"""
tools/trg_oracle.py
Independent Python Reference Oracle for TRG (Typed Relative Grid) Architecture.
Strictly implements:
- 64-byte L1 Cache-Line Header Block (Cache Line 0)
- 8-bit ScriptIDs (1..255; registered: 1=English, 2=Bengali, 3=Hindi, 4=Tamil)
- Pure Integer Codepoint Bijective Dense Glyph Sequences
- 6 Strict Container & Slot Validation Checks
- CRLF Normalization (\r\n -> \n)
"""

import struct
from typing import Tuple, List, Optional

TRG_MAGIC_BYTE = 0x54  # 'T'
TRG_PAYLOAD_OFFSET = 64

TRG_SCRIPT_SYNTAX = 0
TRG_SCRIPT_ENGLISH = 1
TRG_SCRIPT_BENGALI = 2
TRG_SCRIPT_HINDI = 3
TRG_SCRIPT_TAMIL = 4

OPERATORS_16 = "+-*/%=<>!&|^~?@#"
OPERATOR_CHARS = list(OPERATORS_16)
OPERATOR_MAP = {c: 0x70 + i for i, c in enumerate(OPERATOR_CHARS)}
INV_OPERATOR_MAP = {0x70 + i: c for i, c in enumerate(OPERATOR_CHARS)}

DELIMITER_CHARS = [
    " ", "\n", "\t", "_",
    "(", ")", "[", "]",
    "{", "}", ";", ":",
    ",", ".", "\"", "'"
]
DELIMITER_MAP = {c: 0xF0 + i for i, c in enumerate(DELIMITER_CHARS)}
INV_DELIMITER_MAP = {0xF0 + i: c for i, c in enumerate(DELIMITER_CHARS)}

# Pure Integer Codepoint Construction
BN_HOLES = {4, 13, 14, 17, 18, 41, 49, 51, 52, 53, 58, 59, 69, 70, 73, 74, 79, 80, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 94, 100, 101, 127}
HI_HOLES = {0, 58, 59, 78, 79, 83, 84, 85, 86, 87, *range(115, 128)}
TA_HOLES = {0, 1, 4, 11, 12, 13, 17, 22, 23, 24, 27, 29, 32, 33, 34, 37, 38, 39, 43, 44, 45, 58, 59, 60, 61, 67, 68, 69, 73, 78, 79, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 123, 124, 125, 126, 127}

def _build_glyphs(base: int, holes: set, extras: tuple = ()) -> str:
    s = "".join(chr(base + i) for i in range(128) if i not in holes) + "".join(chr(c) for c in extras)
    assert len(s) <= 112 and len(set(s)) == len(s), f"Invalid glyph sequence: len={len(s)}, unique={len(set(s))}"
    return s

SCRIPT_GLYPHS = {
    TRG_SCRIPT_ENGLISH: "".join(chr(c) for r in ((65, 91), (97, 123), (48, 58)) for c in range(*r)), # 62 chars
    TRG_SCRIPT_BENGALI: _build_glyphs(0x0980, BN_HOLES, (0x0964, 0x0965)),                            # 98 chars
    TRG_SCRIPT_HINDI: _build_glyphs(0x0900, HI_HOLES),                                                # 105 chars
    TRG_SCRIPT_TAMIL: _build_glyphs(0x0B80, TA_HOLES, (0x0964, 0x0965)),                             # 74 chars
}

ENCODE_MAP = {sid: {ch: i for i, ch in enumerate(g)} for sid, g in SCRIPT_GLYPHS.items()}

SCRIPT_NAMES = {
    TRG_SCRIPT_ENGLISH: "English (ID 1)",
    TRG_SCRIPT_BENGALI: "Bengali/Assamese (ID 2)",
    TRG_SCRIPT_HINDI: "Devanagari/Hindi (ID 3)",
    TRG_SCRIPT_TAMIL: "Tamil (ID 4)",
}

def detect_script_ids(text: str) -> Tuple[int, int]:
    scripts: List[int] = []
    has_danda = False

    for c in text:
        if c in OPERATOR_MAP or c in DELIMITER_MAP:
            continue
        if c in ("\u0964", "\u0965"):
            has_danda = True
            continue
        sc = None
        for sid in (TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL):
            if c in ENCODE_MAP[sid]:
                sc = sid
                break
        if sc and sc not in scripts:
            scripts.append(sc)

    if has_danda:
        if any(s in scripts for s in (TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL)):
            pass
        elif len(scripts) < 2:
            scripts.append(TRG_SCRIPT_HINDI)

    # Pure syntax strings or empty strings deterministically default script_a = 1 (English)
    if len(scripts) == 0:
        return TRG_SCRIPT_ENGLISH, 0
    if len(scripts) == 1:
        return scripts[0], 0
    if len(scripts) == 2:
        return scripts[0], scripts[1]

    raise ValueError(
        f"Multi-script violation (Fail Fast): Text requires {len(scripts)} scripts "
        f"({scripts}), exceeding the 2-script maximum for TRG."
    )

def trg_encode(text: str) -> bytes:
    """
    Encodes text into a TRG binary container.
    - Normalizes CRLF -> \n
    - Padds header to 64 bytes (L1 Cache Line 0)
    - Total file size = strictly 64 + len(normalized_text) bytes.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    length = len(text)
    script_a, script_b = detect_script_ids(text)

    # 64-byte Header: Length (uint32), ScriptA (uint8), ScriptB (uint8), Flags (uint8), Magic (uint8), 56 reserved bytes
    header = struct.pack("<IBBBB56x", length, script_a, script_b, 0, TRG_MAGIC_BYTE)
    assert len(header) == TRG_PAYLOAD_OFFSET

    payload = bytearray(length)
    map_a = ENCODE_MAP.get(script_a, {})
    map_b = ENCODE_MAP.get(script_b, {}) if script_b else {}

    for i, c in enumerate(text):
        if c in OPERATOR_MAP:
            payload[i] = OPERATOR_MAP[c]
        elif c in DELIMITER_MAP:
            payload[i] = DELIMITER_MAP[c]
        elif c in map_a:
            payload[i] = map_a[c]
        elif script_b and c in map_b:
            payload[i] = 0x80 | map_b[c]
        else:
            raise ValueError(
                f"Character {c!r} (U+{ord(c):04X}) cannot fit into Script A ({script_a}) "
                f"or Script B ({script_b}) or Universal Syntax Apertures."
            )

    return header + bytes(payload)

def trg_decode(data: bytes) -> str:
    """
    Decodes a TRG binary container into a Python string.
    Enforces strict validation:
    1. Exact length (64 + length)
    2. Magic byte (0x54 'T')
    3. Reserved flags (must be 0)
    4. Header padding (all 56 bytes must be 0)
    5. Script IDs (script_a in 1..4, script_b in 0..4)
    6. Slot bounds per character
    """
    if len(data) < TRG_PAYLOAD_OFFSET:
        raise ValueError(f"TRG file too small: {len(data)} bytes (minimum {TRG_PAYLOAD_OFFSET} required)")

    length, script_a, script_b, flags, magic = struct.unpack("<IBBBB", data[:8])
    if magic != TRG_MAGIC_BYTE:
        raise ValueError(f"Invalid TRG magic byte: 0x{magic:02X} (expected 0x{TRG_MAGIC_BYTE:02X} 'T')")

    if flags != 0:
        raise ValueError(f"Non-zero reserved flags in byte 6: 0x{flags:02X} (expected 0)")

    if any(b != 0 for b in data[8:TRG_PAYLOAD_OFFSET]):
        raise ValueError("Dirty non-zero padding in header bytes 8..63")

    if script_a not in (TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL) or \
       script_b not in (0, TRG_SCRIPT_ENGLISH, TRG_SCRIPT_BENGALI, TRG_SCRIPT_HINDI, TRG_SCRIPT_TAMIL):
        raise ValueError(f"Unsupported Script ID (Fail Fast): script_a={script_a}, script_b={script_b}")

    expected_total = TRG_PAYLOAD_OFFSET + length
    if len(data) != expected_total:
        raise ValueError(f"TRG size mismatch: expected {expected_total} bytes, got {len(data)} bytes")

    payload = data[TRG_PAYLOAD_OFFSET:]
    chars = []
    glyphs_a = SCRIPT_GLYPHS[script_a]
    glyphs_b = SCRIPT_GLYPHS.get(script_b, "") if script_b else ""

    for b in payload:
        if 0x70 <= b <= 0x7F:
            chars.append(INV_OPERATOR_MAP[b])
        elif 0xF0 <= b <= 0xFF:
            chars.append(INV_DELIMITER_MAP[b])
        elif b <= 0x6F:
            if b >= len(glyphs_a):
                raise ValueError(f"Payload slot 0x{b:02X} ({b}) exceeds declared glyphs for Script A ({script_a}, max {len(glyphs_a)})")
            chars.append(glyphs_a[b])
        else: # 0x80..0xEF
            if script_b == 0:
                raise ValueError("Payload uses high-bank byte but Script B is undeclared (0)")
            slot = b - 0x80
            if slot >= len(glyphs_b):
                raise ValueError(f"Payload slot 0x{slot:02X} ({slot}) exceeds declared glyphs for Script B ({script_b}, max {len(glyphs_b)})")
            chars.append(glyphs_b[slot])

    return "".join(chars)

if __name__ == "__main__":
    sample = "বাংলা: নমস্কার ৯ + অসমীয়া: ৰ, ৱ + हिन्दी: नमस्ते ९\n"
    encoded = trg_encode(sample)
    decoded = trg_decode(encoded)
    assert decoded == sample, f"Oracle mismatch!\nExpected: {sample}\nGot: {decoded}"
    assert len(encoded) == TRG_PAYLOAD_OFFSET + len(sample)
    print(f"TRG Bijective Oracle Self-Test PASSED ({len(sample)} chars -> {len(encoded)} bytes)")
