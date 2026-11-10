/**
 * Reliable client-side image reading and optimization.
 * Reads files immediately on selection to prevent mobile browser content URI expiration,
 * and optimizes oversized images via canvas so uploads stay within the server's 2 MB limit.
 */

export function bufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const len = bytes.length
  const chunkSize = 0x8000
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, sub as unknown as number[])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    let mime = file.type || ''
    if (!mime || mime === 'image/jpg') {
      if (/\.png$/i.test(file.name)) mime = 'image/png'
      else if (/\.webp$/i.test(file.name)) mime = 'image/webp'
      else mime = 'image/jpeg'
    }

    const fallbackArrayBuffer = () => {
      if (typeof file.arrayBuffer === 'function') {
        file.arrayBuffer()
          .then((buf) => {
            try {
              resolve(bufferToDataUrl(buf, mime))
            } catch {
              reject(new Error('The payment screenshot could not be read. Please choose it again.'))
            }
          })
          .catch(() => reject(new Error('The payment screenshot could not be read. Please choose it again.')))
      } else {
        reject(new Error('The payment screenshot could not be read. Please choose it again.'))
      }
    }

    try {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          fallbackArrayBuffer()
        }
      }
      reader.onerror = () => {
        fallbackArrayBuffer()
      }
      reader.readAsDataURL(file)
    } catch {
      fallbackArrayBuffer()
    }
  })
}

export function optimizeScreenshot(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const approxBytes = Math.round((dataUrl.length * 3) / 4)
      const maxDimension = 1800
      const isStandardMime = /^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)

      // If already a valid PNG/JPEG/WebP, under 1.8 MB, and within max dimensions, keep pristine
      if (isStandardMime && approxBytes <= 1.8 * 1024 * 1024 && img.width <= maxDimension && img.height <= maxDimension) {
        resolve(dataUrl)
        return
      }

      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width)
          width = maxDimension
        } else {
          width = Math.round((width * maxDimension) / height)
          height = maxDimension
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }

      // Draw white background so transparent areas render cleanly
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      // Encode as JPEG with 0.86 quality (crisp text and numbers, ~150-400 KB)
      const compressed = canvas.toDataURL('image/jpeg', 0.86)
      resolve(compressed)
    }
    img.onerror = () => {
      resolve(dataUrl)
    }
    img.src = dataUrl
  })
}

export async function processScreenshotFile(file: File): Promise<string> {
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name)
  if (!isImage) {
    throw new Error('Upload a PNG, JPEG or WebP screenshot.')
  }
  const raw = await readFileAsDataUrl(file)
  const optimized = await optimizeScreenshot(raw)
  return optimized
}
