/**
 * face-api.js models + simple blink + head-movement liveness before returning a 128-D descriptor.
 */

import * as faceapi from 'face-api.js'

let modelLoadPromise: Promise<void> | null = null

export function getFaceModelBaseUrl(): string {
  const raw = import.meta.env.VITE_FACE_MODEL_URL
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\/$/, '')
  return 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'
}

export function ensureFaceModelsLoaded(): Promise<void> {
  if (modelLoadPromise) return modelLoadPromise
  const base = getFaceModelBaseUrl()
  modelLoadPromise = (async () => {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(base)
    await faceapi.nets.faceLandmark68Net.loadFromUri(base)
    await faceapi.nets.faceRecognitionNet.loadFromUri(base)
  })()
  return modelLoadPromise
}

function eyeAspectRatio(eye: faceapi.Point[]) {
  if (eye.length < 6) return 0.35
  const v1 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y)
  const v2 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y)
  const h = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y)
  return h > 0 ? (v1 + v2) / (2 * h) : 0.35
}

function meanEar(lm: faceapi.FaceLandmarks68) {
  return (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2
}

export function descriptorToJson(d: Float32Array): string {
  return JSON.stringify(Array.from(d))
}

/**
 * Samples the video for a few seconds, requires a visible blink and slight head movement,
 * then returns a face descriptor from SSD + recognition nets.
 */
export async function runLivenessAndFaceDescriptor(video: HTMLVideoElement): Promise<Float32Array> {
  await ensureFaceModelsLoaded()
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Camera not ready — wait for preview, then try again.')
  }

  const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 })
  const ears: number[] = []
  const noseX: number[] = []
  const deadline = Date.now() + 4800

  while (Date.now() < deadline) {
    const det = await faceapi.detectSingleFace(video, ssdOpts).withFaceLandmarks()
    if (det) {
      ears.push(meanEar(det.landmarks))
      const nose = det.landmarks.getNose()[0]
      noseX.push(nose.x)
    }
    await new Promise((r) => setTimeout(r, 110))
  }

  if (ears.length < 14) {
    throw new Error('Face not visible long enough — face the camera in good light.')
  }

  const earSpread = Math.max(...ears) - Math.min(...ears)
  if (earSpread < 0.048) {
    throw new Error('Please blink clearly once (printed photos cannot blink).')
  }

  if (noseX.length >= 10) {
    const nxSpread = Math.max(...noseX) - Math.min(...noseX)
    if (nxSpread < 4) {
      throw new Error('Please move your head slightly side-to-side.')
    }
  }

  const final = await faceapi.detectSingleFace(video, ssdOpts).withFaceLandmarks().withFaceDescriptor()
  if (!final) {
    throw new Error('Could not read face after liveness — try again.')
  }
  return final.descriptor
}
