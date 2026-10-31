#!/usr/bin/env python3
import sys
import os
import struct

script_dir = os.path.dirname(os.path.realpath(__file__))
project_root = os.path.dirname(script_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

from tools.trg_oracle import (
    trg_encode,
    trg_decode,
    TRG_MAGIC_BYTE,
    TRG_PAYLOAD_OFFSET,
    SCRIPT_NAMES
)

def cmd_encode(src_path: str, dst_path: str):
    with open(src_path, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        data = trg_encode(text)
    except ValueError as e:
        print(f"Error encoding {src_path}: {e}", file=sys.stderr)
        sys.exit(1)
    with open(dst_path, "wb") as f:
        f.write(data)
    print(f"Encoded {src_path} ({len(text)} chars) -> {dst_path} ({len(data)} bytes)")

def cmd_cat(src_path: str):
    with open(src_path, "rb") as f:
        data = f.read()
    try:
        text = trg_decode(data)
    except ValueError as e:
        print(f"Error decoding {src_path}: {e}", file=sys.stderr)
        sys.exit(1)
    sys.stdout.write(text)

def cmd_decode(src_path: str, dst_path: str):
    with open(src_path, "rb") as f:
        data = f.read()
    try:
        text = trg_decode(data)
    except ValueError as e:
        print(f"Error decoding {src_path}: {e}", file=sys.stderr)
        sys.exit(1)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Decoded {src_path} ({len(data)} bytes) -> {dst_path} ({len(text)} chars)")

def cmd_inspect(src_path: str):
    with open(src_path, "rb") as f:
        data = f.read()
    if len(data) < TRG_PAYLOAD_OFFSET:
        print(f"File too small to be a valid TRG container ({len(data)} bytes, min {TRG_PAYLOAD_OFFSET})", file=sys.stderr)
        sys.exit(1)

    length, script_a, script_b, flags, magic = struct.unpack("<IBBBB", data[:8])
    name_a = SCRIPT_NAMES.get(script_a, f"Custom (ID {script_a})")
    name_b = SCRIPT_NAMES.get(script_b, f"Custom (ID {script_b})" if script_b else "None")

    print(f"=== TRG Master Descriptor: {src_path} ===")
    print(f"Magic Byte:      0x{magic:02X} ({'OK (0x54)' if magic == TRG_MAGIC_BYTE else 'INVALID'})")
    print(f"Header Size:     {TRG_PAYLOAD_OFFSET} bytes (Cache Line 0)")
    print(f"Character Count: {length} chars")
    print(f"Script Plane A:  {name_a}")
    print(f"Script Plane B:  {name_b}")
    print(f"Flags:           0x{flags:02X}")
    print(f"Payload Size:    {len(data) - TRG_PAYLOAD_OFFSET} bytes")
    print(f"Total File Size: {len(data)} bytes (exact 64 + {length})")

def cmd_roundtrip(src_path: str):
    with open(src_path, "r", encoding="utf-8") as f:
        original = f.read()
    encoded = trg_encode(original)
    recovered = trg_decode(encoded)
    normalized = original.replace("\r\n", "\n").replace("\r", "\n")
    if normalized != recovered:
        print(f"FAIL: Round-trip mismatch on {src_path}", file=sys.stderr)
        sys.exit(1)
    print(f"PASS: Round-trip verified for {src_path} ({len(normalized)} chars, {len(encoded)} bytes)")

def main():
    if len(sys.argv) < 2:
        print("Usage: trgctl <encode|decode|inspect|roundtrip|cat> [args...]")
        sys.exit(1)

    action = sys.argv[1]
    if action == "encode" and len(sys.argv) == 4:
        cmd_encode(sys.argv[2], sys.argv[3])
    elif action == "decode" and len(sys.argv) == 4:
        cmd_decode(sys.argv[2], sys.argv[3])
    elif action == "inspect" and len(sys.argv) == 3:
        cmd_inspect(sys.argv[2])
    elif action == "roundtrip" and len(sys.argv) == 3:
        cmd_roundtrip(sys.argv[2])
    elif action == "cat" and len(sys.argv) == 3:
        cmd_cat(sys.argv[2])
    else:
        print(f"Unknown action or incorrect arguments: {action}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
