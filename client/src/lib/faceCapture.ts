/**
 * Fast path for attendance face: smaller JPEGs upload quicker and decode faster server-side (jpeg-js).
 */

const DEFAULT_MAX_EDGE = 640
const DEFAULT_QUALITY = 0.78

export function getFaceCameraConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: 'user',
      width: { ideal: 640, max: 1280 },
      height: { ideal: 480, max: 720 },
    },
    audio: false,
  }
}

export function captureVideoFrameToJpegBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options?: { maxEdge?: number; quality?: number }
): Promise<Blob | null> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options?.quality ?? DEFAULT_QUALITY
  return new Promise((resolve) => {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) {
      resolve(null)
      return
    }
    let tw = vw
    let th = vh
    if (vw > maxEdge || vh > maxEdge) {
      const scale = maxEdge / Math.max(vw, vh)
      tw = Math.max(1, Math.round(vw * scale))
      th = Math.max(1, Math.round(vh * scale))
    }
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    ctx.drawImage(video, 0, 0, tw, th)
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  })
}
