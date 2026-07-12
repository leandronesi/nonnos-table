# Third-party provenance and license review

This inventory records what is shipped or loaded by the current browser build.
It is not legal advice and it does not resolve license compatibility. The root
`LICENSE` (MIT) does **not** override the licenses of the items below.

## Public-launch blocker

The current tree contains source described in its own headers as faithfully or
verbatim ported from a GPL-3.0 project, and loads Maia-3 weights whose model card
states AGPLv3. Before a public or acquisition-oriented launch, decide with
qualified counsel and the relevant copyright holders whether to:

1. relicense the combined work and provide the corresponding source/terms;
2. replace the copied/derived implementation with independently written code;
3. obtain a separate commercial permission; or
4. use a differently licensed model and integration.

Do not treat this notice as permission for commercial distribution.

## Maia platform browser code and vocabularies

- Upstream: [CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend)
- Upstream license: GNU GPL v3.0 (repository `LICENSE`)
- Upstream branch named in local source comments: `main` (no commit was recorded
  when the port was made; this provenance gap should be closed before release)

Classification from the local file headers:

| Local file | Local description | Classification for review |
|---|---|---|
| `frontend/src/pipeline/maia/tensor.ts` | “Ported faithfully”; multiple helpers “ported verbatim” from `src/lib/engine/tensor.ts` | copied/derived GPL code |
| `frontend/src/pipeline/maia/maiaEngine.ts` | wrapper adapted from `src/lib/engine/maia.ts`; evaluation/decoding functions “ported verbatim” | mixed new wrapper + copied/derived GPL code |
| `frontend/public/maia-worker.js` | adapted worker with IndexedDB, protocol and feeds marked “ported verbatim” | copied/derived GPL code |
| `frontend/src/pipeline/maia/all_moves_maia3.json` | Maia-3 move vocabulary from upstream | copied data/artifact; review under upstream GPL |
| `frontend/src/pipeline/maia/all_moves_maia3_reversed.json` | reversed Maia-3 move vocabulary from upstream | copied data/artifact; review under upstream GPL |

The current implementation is therefore **not** accurately described as a
clean-room rewrite. Project-specific pathing, singleton lifecycle, chess.js
adaptation, progress reporting and single-thread settings are modifications on
top of the port.

## Maia-3 model

- Model family/card: [UofTCSSLab/Maia3-79M](https://huggingface.co/UofTCSSLab/Maia3-79M)
- Model-card license: AGPLv3
- ONNX artifact source recorded by `docs/MAIA_BROWSER.md` and `upload-maia.mjs`:
  `CSSLab/maia-platform-frontend/public/maia3/maia3_simplified.onnx`
- Runtime location: not committed in this tree; `maiaEngine.ts` loads
  `VITE_MAIA_MODEL_URL` or the documented same-origin fallback. The
  administrative uploader requires an explicit HTTPS source and SHA-256, and
  rejects mutable GitHub branch URLs.

The exact license relationship between the simplified ONNX artifact, the GPL
platform repository and the AGPL model card has not been resolved. Record the
artifact hash and obtain an explicit license determination before launch.

## Stockfish / stockfish.js

- Package: `stockfish` 18.0.7
- Wrapper source: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)
- Engine source: [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish)
- License declared by package and bundled JS header: GNU GPL v3.0
- Shipped files:
  - `frontend/public/engine/stockfish-18-lite-single.js`
  - `frontend/public/engine/stockfish-18-lite-single.wasm`

GPL distribution obligations include the license and corresponding source (or
a compliant written/source offer for the exact build). A URL in this notice is
not asserted to satisfy every obligation; package `Copying.txt`, exact build
source and build instructions must be included/verified before release.

## ONNX Runtime Web

- Package: `onnxruntime-web` 1.23.0
- Upstream: [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)
- License: MIT
- Shipped/self-hosted runtime files:
  - `frontend/public/ort/ort.wasm.min.js`
  - `frontend/public/ort/ort-wasm-simd-threaded.mjs`
  - `frontend/public/ort/ort-wasm-simd-threaded.wasm`

Microsoft's MIT copyright and license notice must accompany substantial copies.
Review ONNX Runtime's own `ThirdPartyNotices.txt` for bundled dependencies.

## Integrity snapshot (2026-07-11)

These hashes identify the local artifacts reviewed here; they are not upstream
version identifiers.

```text
maia-worker.js                       EDD04EF3D30C228A00F5F4FFFCB75FB1DA58511C8036405A59C0BE78D4D53DEF
tensor.ts                            155630DFE4E7353A1D5DFDDC63F6A30F937F1FCF722134518F5B3E6A925106D5
maiaEngine.ts                        64F0F2D6B3B474962FDFC7C485D341099EE178A9C3A0A42BF9A1C1067C786CC3
all_moves_maia3.json                 E3351A233174E99D9DDCA981681B65A444D191E8A6B474E27BD8FAD8514AF8D7
all_moves_maia3_reversed.json        BB9542B706D3011AA8C0BB067DD33B50BBD7313414CFB50052B0C92AAA9833EE
stockfish-18-lite-single.js          2C02445ABF3A13AF1C5CB5A2BE80EF0D62C3B3E1903823A10B7D6DDB87A94A15
stockfish-18-lite-single.wasm        A8FBC05EC6920B56D7485826DCB02C5FFD2826BCBF751CF973046F237A9096F1
ort.wasm.min.js                      1D252C807DEBA263B069BC8DE80D604F4F4EAE104198C9FBC438192F40B4DF1A
ort-wasm-simd-threaded.mjs           713E3528EB5ACD004555D527EEE34C9B1E45D1441D2FF5D570F73AF32D5E7305
ort-wasm-simd-threaded.wasm          3260FCDB33B4FC4EC33E89CAF392E13625823E01049D3BF32C38464F9DBFE14C
```
