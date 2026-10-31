# TRG (Typed Relative Grid) — An Unbiased Fixed-Width 1-Byte Simple Text Grid

> **Status: Experimental Prototype (v0.0.1)**  
> **Notice:** This is an experimental project. It comes with **no guarantees** and is undergoing active testing, verification, and compiler integration. It is an exploration in systems architecture, not an established standard.

---

## 1. The Goal: Unbiased Systems Text for Sound-Based Languages

Most sound-based (phonetic) alphabets—like Bengali, Hindi (Devanagari), Tamil, Arabic, Cyrillic, Greek, and Latin—fit their core alphabet and digits in under 112 characters. TRG is a fixed-width, 1-byte-per-character binary text format that puts any two phonetic scripts on equal footing. Every character takes 1 byte of memory and can be read at index `i` in a single CPU instruction (`ptr@[i * 1]`).

* **1 Byte per Character:** Every character on disk, on the wire, and in memory takes strictly 1 byte (64 + Length bytes total).
* **Any Two Registered Scripts:** Neither plane is locked to English. Any two registered sound-based scripts—from the currently supported registry of English (ID 1), Bengali/Assamese (ID 2), Hindi/Devanagari (ID 3), and Tamil (ID 4)—pair as equals in the same binary stream.
* **Deterministic O(1) SIB Indexing:** Character `i` is loaded in 1 CPU clock cycle via hardware Scale-Index-Base addressing (`movzx eax, byte ptr [rsi + rdi * 1]`).
* **Zero Lookup Tables:** 100% pure register-level ALU carry math in SINC.
* **Direct 16-Bit SAGR Texture Atlas Coordinates:** Output coordinates directly index GPU/software texture atlas pages: `(ScriptID << 8) | GlyphID`.
* **Universal Math & Delimiter Apertures:** 16 math/logic operators and 16 structural delimiters are identical across all languages.
* **1-Instruction XOR Bracket Matching:** Closing brackets are computed in 1 CPU instruction: `bracket ^ 1`.
* **Zero Dependencies & Lean Implementation:** The core SINC decoder is strictly **76 lines of code** (66 active statements).

A 1-byte cell holds 256 values, so writing systems with thousands of symbols (like Chinese Hanzi or Japanese Kanji) and arbitrary emojis cannot physically fit into a 1-byte cell. TRG is designed specifically for **sound-based (phonetic) languages** and systems software (compilers, token tapes, terminal streams, and memory buffers).

---

## 2. Architecture & Binary Layout

### Master Header & Cache-Line Alignment
1. **64-Byte L1 Cache-Line Header:** The container begins with an aligned 64-byte master descriptor block:
   * **Bytes 0..3:** `Length` (uint32_t payload character count)
   * **Byte 4:** `Script A ID` (uint8_t simple script identifier, e.g. 1=English, 2=Bengali, 3=Hindi, 4=Tamil)
   * **Byte 5:** `Script B ID` (uint8_t simple script identifier, 0 if unused)
   * **Byte 6:** `Flags` (reserved, 0)
   * **Byte 7:** `Magic` (0x54 `'T'`)
   * **Bytes 8..63:** Reserved container padding (ensuring exact 64-byte L1 cache-line alignment)
2. **Payload Block (64-Byte Boundary):** Character data begins immediately at byte 64 (`ptr + 64`), matching modern CPU L1 cache lines (512-bit ZMM vector registers) for zero unaligned memory penalties.

### 256-Byte Space Partition
TRG partitions the 256-byte space into two symmetric 112-slot language planes and two 16-slot universal syntax apertures:

```text
+-----------------------+-------------------+-----------------------+-------------------+
|  Bank A (112 Slots)   | Math (16 Slots)   |  Bank B (112 Slots)   | Delim (16 Slots)  |
|      0x00..0x6F       |    0x70..0x7F     |      0x80..0xEF       |    0xF0..0xFF     |
|       Script A        |  Math & Logic Ops |       Script B        |  Delimiters & ()  |
+-----------------------+-------------------+-----------------------+-------------------+
```

1. **Language Plane A (`0x00..0x6F`, 112 slots):** Full alphabet + native numerals for Script A.
2. **Shared Operators (`0x70..0x7F`, 16 slots):** Universal math & logic operators:  
   `+` `-` `*` `/` `%` `=` `<` `>` `!` `&` `|` `^` `~` `?` `@` `#`
3. **Language Plane B (`0x80..0xEF`, 112 slots):** Full alphabet + native numerals for Script B.
4. **Shared Delimiters (`0xF0..0xFF`, 16 slots):** Structural delimiters and bracket pairs:  
   `' '` `\n` `\t` `_` `(` `)` `[` `]` `{` `}` `;` `:` `,` `.` `"` `'`

### Bijective Dense Glyph Sequences
Rather than sparse, fragmented Unicode block offsets with collision-prone patch tables, TRG uses **Canonical Bijective Dense Glyph Sequences** for each registered script plane:

```text
SCRIPT_GLYPHS[sid] = [c0, c1, ..., cN-1],  where N <= 112
```

* **100% Collision-Free Bijection:** Forward encoding is a unique dictionary lookup (`ENCODE_MAP[sid][c]`), and reverse decoding is a direct string index (`SCRIPT_GLYPHS[sid][slot]`). Perfect round-trip (`decode(encode(c)) == c`) is mathematically guaranteed for all registered characters.
* **Pure Integer Codepoint Construction:** Glyph tables are constructed programmatically from integer hex codepoints and hole filters, ensuring total immunity against clipboard or editor Unicode NFC normalization/decomposition bugs.
* **Registered Script Mappings (v0.0.1):**
  * **Script 1 (Pure English, 62/112 slots):** Slots `0x00..0x19` (`A..Z`), `0x1A..0x33` (`a..z`), `0x34..0x3D` (`0..9`). Zero teletype/control bytes.
  * **Script 2 (Bengali & Assamese, 98/112 slots):** Full alphabet + native numerals (`০..৯`). Assamese `ৰ` is slot `0x51` (81), `ৱ` is slot `0x52` (82), Danda `।` is slot `0x60` (96), Double Danda `॥` is slot `0x61` (97).
  * **Script 3 (Hindi / Devanagari, 105/112 slots):** Full standard Devanagari alphabet + numerals (`०..९`). Short A `ऄ` is slot `0x03` (3), Danda `।` is slot `0x5A` (90), Double Danda `॥` is slot `0x5B` (91), Abbreviation sign `॰` is slot `0x66` (102).
  * **Script 4 (Tamil, 74/112 slots):** Full Tamil alphabet + native numerals (`௦..௯`). Core vowels `அ` is slot `0x02` (2), `ஆ` is slot `0x03` (3), traditional numerals `௰` is slot `0x3D` (61), `௱` is slot `0x3E` (62), `௲` is slot `0x3F` (63), Dandas `।`/`॥` are slots `0x48`/`0x49` (72/73).

---

## 3. Core Silicon Algorithms

### 1. The 4-Line Carry ALU Decode Equation
Decoding any 1-byte cell into its 16-bit 2D SAGR texture atlas coordinate takes strictly **4 branchless scalar ALU operations** without memory reads:

```sinc
fn trg_decode_1b(raw_byte, script_a, delta_ab) [
    plane_mask = 0 - (raw_byte~ >> 7);
    lang_base = script_a + (delta_ab & plane_mask);
    ap_carry = (raw_byte~ & TRG_MASK_APERTURE) + TRG_CARRY_ADD;
    is_lang = (ap_carry >> 7) - 1;
    ret raw_byte + (lang_base & is_lang);
]
```
Where `script_a` and `script_b` are compile-time pre-shifted script constants (`256`, `512`, `768`, `1024`), and `delta_ab = (script_b - script_a) - 128`.

* **Bank A Language byte (`0x00..0x6F`):** `is_lang = -1`, `plane_mask = 0` -> returns `raw_byte + script_a` (e.g., Bengali `ক` = glyph 16 -> `16 + 512 = 528`, Page 2 Bengali, Glyph 16).
* **Bank B Language byte (`0x80..0xEF`):** `is_lang = -1`, `plane_mask = -1` -> returns `raw_byte + lang_base` (e.g., Tamil `க` = glyph 14, raw byte 142 -> `142 + 896 = 1038`, Page 4 Tamil, Glyph 14).
* **Universal Operators & Delimiters (`0x70..0x7F`, `0xF0..0xFF`):** `is_lang = 0` -> returns raw token byte directly (Page 0 Syntax glyphs, e.g., `+` = `112`, `}` = `249`).

### 2. 1-Instruction XOR Bracket Inversion (`b ^ 1`)
Brackets in Bank 1 (`0xF0..0xFF`) are aligned on consecutive even/odd bytes:
* `(` (`0xF4`) ^ 1 -> `)` (`0xF5`)
* `[` (`0xF6`) ^ 1 -> `]` (`0xF7`)
* `{` (`0xF8`) ^ 1 -> `}` (`0xF9`)

Compilers derive closing brackets and verify bracket balance in **1 CPU XOR instruction with zero memory reads**.

---

## 4. Technical Specifications

| Property | Specification |
| :--- | :--- |
| **Cell Width** | Fixed 1 byte per character |
| **Header Size** | 64 bytes (L1 cache-line aligned) |
| **Total File Size** | 64 + Length bytes |
| **Script Registry** | 8-Bit Simple Script Registry (1..255 capacity; v0.0.1: 1=English, 2=Bengali, 3=Hindi, 4=Tamil) |
| **Script Capacity** | Up to 112 dense phonetic characters per plane (English: 62/112, Tamil: 74/112, Bengali: 98/112, Hindi: 105/112) |
| **Validation Checks** | 6 Strict Container and Slot Bounds Checks |
| **Shared Syntax Slots** | 16 math/logic operators (`0x70..0x7F`) + 16 delimiters (`0xF0..0xFF`) |
| **Coordinate Output** | Direct 16-bit SAGR Texture Atlas Coordinates `(Page, Glyph)` |
| **Random Access (`text[i]`)** | Direct 1-cycle SIB load: `ptr@[i * 1]` |
| **Bracket Matching** | 1 CPU XOR instruction: `b ^ 1` (0 memory lookups) |
| **SINC Implementation** | 76 LOC (66 active statements), 0 lookup tables, 0 runtime shifts |
| **Logograph / Emoji Support** | Unsupported (Fails fast due to 1-byte cell limits) |

---

## 5. Repository Structure

```text
trg/
├── bin/                        # Bundled SINC bootstrap toolchain
├── trg/                        # Native SINC Triad Implementation (76 LOC Total)
│   ├── build.staff             # STAFF build manifest
│   ├── data/
│   │   └── trg_constants.sinc  # Cache offsets, bitmasks, pre-shifted script IDs (20 LOC)
│   ├── pure/
│   │   └── trg_math.sinc       # 4-line carry ALU equation & descriptor packing (17 LOC)
│   └── sys/
│       ├── trg_engine.sinc     # Direct ptr@[i] SIB memory engine (10 LOC)
│       └── entry.sinc          # Hardware verification entrypoint (Exit 42) (29 LOC)
├── steel/                      # STEEL standard syscall library
├── tools/
│   ├── trg_oracle.py           # Python reference gateway with deterministic hole-folding
│   └── trg_cli.py              # CLI tool (trgctl) for encode, decode, inspect, cat
├── tests/
│   ├── test_trg_harness.sh     # Comprehensive property-based multilingual test harness
│   └── test_harness.sh         # End-to-end verification suite
├── editors/
│   └── vscode/trg-vscode/      # VS Code / Antigravity extension (TRG codec)
├── examples/                   # Bilingual sample programs (Bengali + Hindi)
├── build.sh                    # Compiles trg.staff to native ELF via STAFF
├── trgctl                      # CLI runner for encode/decode/inspect/cat
└── rsinc                       # CLI runner wrapper
```

---

## 6. Quick Start

### 1. Build and Run Native Verification Suite
```bash
./build.sh
./bin/trg
echo $?  # prints 42
```

### 2. Run the Full Test Harness
```bash
./tests/test_harness.sh
```

### 3. CLI Tool (`trgctl`)
```bash
# Encode UTF-8 text file to TRG binary
./trgctl encode input.txt output.trg

# Inspect container header (reports Script A, Script B, length)
./trgctl inspect output.trg

# Print decoded text directly to stdout (used by Git textconv)
./trgctl cat output.trg

# Decode TRG binary back to UTF-8
./trgctl decode output.trg recovered.txt

# Round-trip verification
./trgctl roundtrip input.txt
```

---

## 7. Current Boundaries

1. **Registered Script Boundary (v0.0.1):** Each container supports up to two declared sound-based scripts chosen from the 4 registered scripts: English (ID 1), Bengali/Assamese (ID 2), Hindi/Devanagari (ID 3), and Tamil (ID 4). Mixing 3 or more distinct scripts or using unregistered script IDs fails fast by design.
2. **No Logographs / Emojis:** Characters requiring >= 15 bits cannot physically fit into a 1-byte cell and are intentionally rejected.
3. **Systems & Research Purpose:** TRG is engineered for compiler token tapes, flat memory buffers, and custom systems pipelines, not as a replacement for general-purpose UTF-8 across the open web.

---

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
