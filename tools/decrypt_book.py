"""Decrypt AdsPro encrypted .book.csv files.

Cipher (reverse-engineered):
  - Files start with a 4-byte magic prefix (e.g. `c0 c4 bf 3a`).
  - The remaining bytes are XOR'd with stream `key[i] = (7 + 7*i) mod 255`.
    Note `mod 255` (not 256) — that's what makes wraparound non-trivial.
  - No per-file key derivation; the same k0=7 works across all 175+ files.

Usage:
  python tools/decrypt_book.py SRC_DIR DST_DIR

Decrypts every *.book.csv and tint_book.ini-adjacent files in SRC_DIR into
DST_DIR. Existing files in DST_DIR are overwritten.
"""

import shutil
import sys
from pathlib import Path

MAGIC_PREFIX_LEN = 4
K0 = 7
STEP = 7
MOD = 255


def decrypt_bytes(enc: bytes) -> bytes:
    return bytes(b ^ ((K0 + STEP * i) % MOD) for i, b in enumerate(enc[MAGIC_PREFIX_LEN:]))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")

    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)

    n = 0
    for path in sorted(src.iterdir()):
        if path.is_file() and path.name.endswith(".book.csv"):
            data = path.read_bytes()
            if len(data) < MAGIC_PREFIX_LEN:
                continue
            (dst / path.name).write_bytes(decrypt_bytes(data))
            n += 1
        elif path.name == "tint_book.ini":
            shutil.copyfile(path, dst / path.name)
    print(f"Decrypted {n} CSV files into {dst}")


if __name__ == "__main__":
    main()
