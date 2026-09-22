#!/usr/bin/env bash
# Moderado installer: downloads the verified standalone binary for the host
# platform from the latest GitHub release, verifies its SHA-256 checksum
# against the published manifest, and installs it to ~/.local/bin.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --version v0.3.0 --dir ~/.local/bin
#
# The installer never executes downloaded code before the checksum matches the
# release manifest. Binaries are unsigned; Windows SmartScreen and macOS
# Gatekeeper may still prompt on first run.
set -euo pipefail

REPO="marcuz-apl/moderado"
INSTALL_DIR="${HOME}/.local/bin"
PINNED_VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --version) PINNED_VERSION="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: install.sh [--version vX.Y.Z] [--dir INSTALL_DIR]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
need curl
# Probe candidates by execution: on Windows, `python3` may resolve to a
# Microsoft Store stub that prints "Python was not found" and exits nonzero.
PY=""
for candidate in python3 python; do
  if command -v "${candidate}" >/dev/null 2>&1 && "${candidate}" --version >/dev/null 2>&1; then
    PY="${candidate}"
    break
  fi
done
if [ -z "${PY}" ]; then
  echo "Missing required command: python3 (or python)" >&2
  exit 1
fi

# Test hooks (not for users): FAKE_OS / FAKE_ARCH override uname so the
# installer matrix is testable on any host.
OS="${FAKE_OS:-$(uname -s)}"
ARCH="${FAKE_ARCH:-$(uname -m)}"
case "${OS}-${ARCH}" in
  Linux-x86_64) ASSET="moderado-linux-x64" ;;
  Darwin-arm64) ASSET="moderado-macos-arm64" ;;
  *) echo "Unsupported platform: ${OS} ${ARCH}." >&2
     echo "Install with 'npm install -g moderado' (Node.js >= 20), the Windows binary," >&2
     echo "winget, or Scoop instead." >&2
     exit 1 ;;
esac

if [ -n "${PINNED_VERSION}" ]; then
  TAG="${PINNED_VERSION}"
else
  TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | "${PY}" -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
fi

BASE="https://github.com/${REPO}/releases/download/${TAG}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

curl -fsSL "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"
curl -fsSL "${BASE}/${ASSET}.sha256" -o "${TMP}/${ASSET}.sha256"
curl -fsSL "${BASE}/manifest.json" -o "${TMP}/manifest.json"

EXPECTED_SHA="$(cut -d' ' -f1 "${TMP}/${ASSET}.sha256")"
ACTUAL_SHA="$("${PY}" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "${TMP}/${ASSET}")"
if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
  echo "Checksum mismatch for ${ASSET}: expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}." >&2
  exit 1
fi

MANIFEST_SHA="$("${PY}" -c 'import json,sys; m = json.load(open(sys.argv[1])); print(next(a["checksum"] for a in m["artifacts"] if a["filename"] == sys.argv[2]))' "${TMP}/manifest.json" "${ASSET}")"
if [ "${MANIFEST_SHA}" != "${EXPECTED_SHA}" ]; then
  echo "Checksum for ${ASSET} does not match manifest.json; refusing to install." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
install -m 0755 "${TMP}/${ASSET}" "${INSTALL_DIR}/moderado"
echo "Installed moderado ${TAG} to ${INSTALL_DIR}/moderado"
echo "Ensure ${INSTALL_DIR} is on your PATH, then run: moderado --help"
