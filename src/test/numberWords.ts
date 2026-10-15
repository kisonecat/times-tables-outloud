const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0–999 as English words, the way a recognizer might write them: 56 → "fifty six". */
export function toWords(n: number): string {
  if (n >= 100) {
    const rest = n % 100;
    return `${UNITS[Math.floor(n / 100)]} hundred${rest ? ` and ${toWords(rest)}` : ''}`;
  }
  if (n >= 20) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${UNITS[n % 10]}` : ''}`;
  if (n >= 10) return TEENS[n - 10]!;
  return UNITS[n]!;
}
