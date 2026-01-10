// Test the timezone conversion logic
const testDate = "2026-01-09T22:00:00Z";

console.log("=== TIMEZONE CONVERSION TEST ===\n");
console.log("UTC Input:", testDate);

// Parse as Date
const date = new Date(testDate);
console.log("Date object:", date.toISOString());

// Get Rome timezone components using Intl
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const parts = formatter.formatToParts(date);
console.log("\nRome timezone parts:", parts);

const getValue = (type) => {
  const part = parts.find(p => p.type === type);
  return part ? parseInt(part.value, 10) : 0;
};

const components = {
  year: getValue('year'),
  month: getValue('month'),
  day: getValue('day'),
  hour: getValue('hour'),
  minute: getValue('minute'),
  second: getValue('second')
};

console.log("\nExtracted components (Rome timezone):");
console.log(components);
console.log("\nFormatted Rome time:", formatter.format(date));

// Test with current date
const now = new Date();
console.log("\n=== CURRENT TIME TEST ===");
console.log("Current UTC:", now.toISOString());
console.log("Current Rome:", formatter.format(now));
