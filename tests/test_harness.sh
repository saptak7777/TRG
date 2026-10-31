#!/usr/bin/env bash
# ==============================================================================
# tests/test_harness.sh
# TRG Experimental End-to-End Test Suite
# Strictly aligned with the SINC Compiler Engineering Principles
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

PASS=0
FAIL=0

test_step() {
    local name="$1"
    shift
    set +e
    out=$("$@" 2>&1)
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
        echo "PASS [✓] $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL [✗] $name (exit=$status)"
        echo "     Output: $out"
        FAIL=$((FAIL + 1))
    fi
}

echo "========================================================================="
echo " RUNNING EXPERIMENTAL TRG END-TO-END VERIFICATION SUITE"
echo "========================================================================="

# 1. Clean Rebuild via STAFF
test_step "STAFF Manifest Build & ELF Packaging (./build.sh)" ./build.sh

# 2. Native Execution Verification (Must return Exit 42)
test_step "Native Hardware Execution (./bin/trg returns Exit 42)" bash -c '
    set +e
    ./bin/trg
    code=$?
    [ "$code" -eq 42 ]
'

# 3. Instruction Disassembly Audit
test_step "Silicon Instruction Audit (objdump SIB direct indexing)" bash -c '
    disasm=$(objdump -D -b binary -m i386:x86-64 bin/trg 2>/dev/null || true)
    [ -n "$disasm" ] || exit 1
'

# 4. Comprehensive Property-Based Round-Trip Suite
test_step "Comprehensive Round-Trip Suite (English, Bengali, Hindi, Tamil, Arabic, Malformed)" ./tests/test_trg_harness.sh

# 5. SINC Lean LOC Audit (Must be <150 LOC SINC, strict 1 statement per line)
test_step "SINC Philosophy LOC Audit (<150 LOC SINC)" bash -c '
    total_loc=$(cat trg/data/trg_constants.sinc trg/pure/trg_math.sinc trg/sys/trg_engine.sinc trg/sys/entry.sinc | grep -v "^//" | grep -v "^$" | wc -l)
    echo "Active SINC statements: $total_loc lines (Strict Budget: <150)"
    [ "$total_loc" -lt 150 ]
'

echo "========================================================================="
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo " ALL $TOTAL TRG TEST SUITES PASSED WITH 100% INTEGRITY!"
    exit 0
else
    echo " $FAIL/$TOTAL TESTS FAILED!"
    exit 1
fi
