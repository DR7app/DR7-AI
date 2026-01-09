// Test the parseLocalDate logic
const testDate = "2026-01-07T13:00:00.000Z"

const utcDate = new Date(testDate)
console.log("UTC Date:", utcDate.toISOString())
console.log("UTC getDate():", utcDate.getDate())

// Extract date components in Rome timezone using Intl API
const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
})

const parts = formatter.formatToParts(utcDate)
console.log("Formatter parts:", parts)

const year = parseInt(parts.find(p => p.type === 'year')?.value || '0')
const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1
const day = parseInt(parts.find(p => p.type === 'day')?.value || '0')

console.log(`Extracted: ${year}-${month + 1}-${day}`)

const localDate = new Date(year, month, day, 0, 0, 0, 0)
console.log("Local Date getDate():", localDate.getDate())
