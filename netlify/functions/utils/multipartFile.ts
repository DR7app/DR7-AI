/**
 * Parser multipart minimale condiviso dagli upload EMTN (segnalazione e
 * analisi documentale): prende il PRIMO file del body. Per N file il client
 * chiama N volte (1 file per chiamata), cosi' i timeout Netlify non si
 * saturano.
 */
export function extractFirstFile(rawBody: Buffer, boundary: string): { fileName: string; mime: string; data: Buffer } | null {
    const boundaryBuf = Buffer.from(`--${boundary}`)
    const parts: Buffer[] = []
    let idx = 0
    let next = rawBody.indexOf(boundaryBuf, idx)
    while (next !== -1) {
        if (idx > 0) parts.push(rawBody.slice(idx, next - 2)) // strip CRLF before boundary
        idx = next + boundaryBuf.length + 2 // skip CRLF after boundary
        next = rawBody.indexOf(boundaryBuf, idx)
    }
    for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd === -1) continue
        const headerStr = part.slice(0, headerEnd).toString('utf8')
        if (!/Content-Disposition:[^\r\n]*filename="/i.test(headerStr)) continue
        const fileNameMatch = headerStr.match(/filename="([^"]+)"/i)
        const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i)
        const fileName = fileNameMatch ? fileNameMatch[1] : 'upload.bin'
        const mime = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream'
        const data = part.slice(headerEnd + 4)
        return { fileName, mime, data }
    }
    return null
}

