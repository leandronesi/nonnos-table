/**
 * maia-worker.js — Maia-3 ONNX inference worker.
 *
 * Ported faithfully from:
 *   CSSLab/maia-platform-frontend/public/maia-worker.js (branch main)
 *
 * Adaptations vs. CSSLab original:
 *
 *   1. BASE_URL-aware paths (GH Pages subpath).
 *      CSSLab used hardcoded '/ort/…'. We read the base from the query
 *      string (?base=…) injected by maiaEngine.ts when instantiating the worker.
 *      Falls back to '/' for local dev.
 *
 *   2. numThreads = 1 (CRITICAL for GH Pages).
 *      GH Pages does NOT send COOP/COEP headers → SharedArrayBuffer is
 *      unavailable → multi-threaded ORT crashes. Setting numThreads=1 makes
 *      ORT use a single-threaded WASM path that works without SAB.
 *      The simd-threaded .wasm is still used (it's the only build shipped in
 *      onnxruntime-web ≥1.17) but it degrades gracefully to single-thread
 *      when numThreads=1.
 *
 *   3. ort.wasm.min.js loaded via importScripts (same as CSSLab but path is
 *      now dynamic from the base URL).
 *
 * Messages FROM main thread (identical protocol to CSSLab):
 *   { type: 'init', modelUrl, modelVersion }
 *   { type: 'download' }
 *   { type: 'inference', id, tokens, eloSelfs, eloOppos, batchSize }
 *
 * Messages TO main thread (identical protocol to CSSLab):
 *   { type: 'status', status }
 *   { type: 'progress', progress }
 *   { type: 'error', message, id? }
 *   { type: 'inference-result', id, logitsMove, logitsValue }
 */

// ── Resolve BASE_URL from query string (injected by maiaEngine.ts) ───────────
const _selfUrl = self.location.href
const _baseParam = new URL(_selfUrl).searchParams.get('base') || '/'
const BASE = _baseParam.endsWith('/') ? _baseParam : _baseParam + '/'

// Load ORT — must be synchronous before any async work
importScripts(BASE + 'ort/ort.wasm.min.js')

const ORT = ort

// Set wasm asset path BEFORE creating any session.
// numThreads=1: disables multi-threading → no SharedArrayBuffer requirement.
ORT.env.wasm.wasmPaths = BASE + 'ort/'
ORT.env.wasm.numThreads = 1

// ── IndexedDB caching (ported verbatim from CSSLab) ──────────────────────────

const DB_NAME = 'MaiaModels'
const STORE_NAME = 'models'
const MODEL_KEY = 'maia-rapid-model'

function isCompatibleModelCache(data, expectedUrl, expectedVersion) {
  return data.url === expectedUrl && data.version === expectedVersion
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

async function getCachedModel(modelUrl, modelVersion) {
  const db = await openDB()
  const tx = db.transaction([STORE_NAME], 'readonly')
  const store = tx.objectStore(STORE_NAME)

  const data = await new Promise((resolve, reject) => {
    const req = store.get(MODEL_KEY)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })

  if (!data) return null

  if (!isCompatibleModelCache(data, modelUrl, modelVersion)) {
    const rwTx = db.transaction([STORE_NAME], 'readwrite')
    rwTx.objectStore(STORE_NAME).delete(MODEL_KEY)
    return null
  }

  return await data.data.arrayBuffer()
}

async function storeModel(modelUrl, modelVersion, buffer) {
  const db = await openDB()
  const tx = db.transaction([STORE_NAME], 'readwrite')
  const store = tx.objectStore(STORE_NAME)

  await new Promise((resolve, reject) => {
    const req = store.put({
      id: MODEL_KEY,
      url: modelUrl,
      version: modelVersion,
      data: new Blob([buffer]),
      timestamp: Date.now(),
      size: buffer.byteLength,
    })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ── Worker state ──────────────────────────────────────────────────────────────

let session = null
let modelUrl = null
let modelVersion = null

async function initSession(buffer) {
  session = await ORT.InferenceSession.create(buffer)
}

// ── Message handler (ported verbatim from CSSLab, protocol unchanged) ─────────

self.onmessage = async (e) => {
  const msg = e.data

  try {
    switch (msg.type) {
      case 'init': {
        modelUrl = msg.modelUrl
        modelVersion = msg.modelVersion
        postMessage({ type: 'status', status: 'loading' })

        const buffer = await getCachedModel(modelUrl, modelVersion)
        if (buffer) {
          await initSession(buffer)
          postMessage({ type: 'status', status: 'ready' })
        } else {
          postMessage({ type: 'status', status: 'no-cache' })
        }
        break
      }

      case 'download': {
        postMessage({ type: 'status', status: 'downloading' })
        postMessage({ type: 'progress', progress: 0 })
        const response = await fetch(modelUrl)
        if (!response.ok) throw new Error('Failed to fetch model: ' + response.status)

        let buffer

        if (response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader()
          const contentLength = +(response.headers.get('Content-Length') || 0)
          const chunks = []
          let receivedLength = 0
          let lastReportedProgress = 0

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            receivedLength += value.length

            if (contentLength > 0) {
              const currentProgress = Math.floor(
                (receivedLength / contentLength) * 100,
              )
              if (currentProgress >= lastReportedProgress + 10) {
                postMessage({ type: 'progress', progress: currentProgress })
                lastReportedProgress = currentProgress
              }
            }
          }

          buffer = new Uint8Array(receivedLength)
          let position = 0
          for (const chunk of chunks) {
            buffer.set(chunk, position)
            position += chunk.length
          }
        } else {
          buffer = new Uint8Array(await response.arrayBuffer())
        }

        await storeModel(modelUrl, modelVersion, buffer.buffer)
        await initSession(buffer.buffer)
        postMessage({ type: 'progress', progress: 100 })
        postMessage({ type: 'status', status: 'ready' })
        break
      }

      case 'inference': {
        if (!session) {
          postMessage({
            type: 'error',
            message: 'Model not initialized',
            id: msg.id,
          })
          return
        }

        const { id, tokens, eloSelfs, eloOppos, batchSize } = msg

        // Feeds: ported verbatim from CSSLab (names must match ONNX model)
        const feeds = {
          tokens: new ORT.Tensor('float32', new Float32Array(tokens), [
            batchSize,
            64,
            12,
          ]),
          elo_self: new ORT.Tensor('float32', new Float32Array(eloSelfs), [
            batchSize,
          ]),
          elo_oppo: new ORT.Tensor('float32', new Float32Array(eloOppos), [
            batchSize,
          ]),
        }

        const result = await session.run(feeds)

        const logitsMove = new Float32Array(result.logits_move.data)
        const logitsValue = new Float32Array(result.logits_value.data)

        // Transfer ArrayBuffers (zero-copy, ported verbatim from CSSLab)
        postMessage(
          {
            type: 'inference-result',
            id,
            logitsMove: logitsMove.buffer,
            logitsValue: logitsValue.buffer,
          },
          [logitsMove.buffer, logitsValue.buffer],
        )
        break
      }
    }
  } catch (err) {
    postMessage({
      type: 'error',
      message: err.message || 'Unknown worker error',
      id: msg.id,
    })
  }
}
