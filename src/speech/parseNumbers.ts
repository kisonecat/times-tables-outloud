/**
 * Spoken-number parsing. Word tables are keyed by language so other languages can be
 * added later; only English exists for now.
 */

interface NumberWords {
  /** 0–9, including common recognizer homophones ("for" → 4, "ate" → 8). */
  units: Record<string, number>;
  /** 10–19. */
  teens: Record<string, number>;
  /** 20, 30, … 90. */
  tens: Record<string, number>;
  hundred: string;
  /** Joiners that are skipped inside a number ("one hundred and eight"). */
  joiners: string[];
  /** Words that end any number in progress ("a hundred" starts a new one). */
  breakers: string[];
}

const EN: NumberWords = {
  units: {
    zero: 0,
    oh: 0,
    one: 1,
    won: 1,
    two: 2,
    to: 2,
    too: 2,
    three: 3,
    free: 3,
    tree: 3, // children often say "free"; Whisper hears it too
    four: 4,
    for: 4,
    fore: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    ate: 8,
    nine: 9,
  },
  teens: {
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  },
  tens: {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fourty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  },
  hundred: 'hundred',
  joiners: ['and'],
  breakers: ['a'],
};

const LANGS: Record<string, NumberWords> = { en: EN };

function wordsFor(lang: string): NumberWords {
  return LANGS[lang.toLowerCase().split('-')[0]!] ?? EN;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * What the number being built can still absorb:
 * - unit:    "seven"          a lone unit; "one" may become a hundreds lead ("one forty four")
 * - tens:    "forty"          can take a unit ("forty two")
 * - hundred: "one hundred"    can take tens, a teen, or a unit
 * - done:    "twelve"         complete
 */
type Slot = 'unit' | 'tens' | 'hundred' | 'done';

/** Every number spoken in `text`, in order: "seven times eight is fifty six" → [7, 8, 56]. */
export function parseNumbers(text: string, lang = 'en'): number[] {
  const w = wordsFor(lang);
  const out: number[] = [];
  // Held in an object so the helpers below can update it without defeating narrowing.
  const st: { cur: number | null; slot: Slot } = { cur: null, slot: 'done' };

  const flush = () => {
    if (st.cur !== null) out.push(st.cur);
    st.cur = null;
  };
  const start = (v: number, slot: Slot) => {
    flush();
    st.cur = v;
    st.slot = slot;
  };
  const extend = (v: number, slot: Slot) => {
    st.cur = (st.cur ?? 0) + v;
    st.slot = slot;
  };

  for (const t of tokenize(text)) {
    const { cur, slot } = st;
    if (/^\d+$/.test(t)) {
      flush();
      out.push(Number(t));
    } else if (t in w.units) {
      const v = w.units[t]!;
      if (cur !== null && (slot === 'tens' || slot === 'hundred')) extend(v, 'done');
      else start(v, 'unit');
    } else if (t in w.teens) {
      const v = w.teens[t]!;
      if (cur !== null && slot === 'hundred') extend(v, 'done');
      else if (cur === 1 && slot === 'unit') {
        st.cur = 100 + v; // "one twelve"
        st.slot = 'done';
      } else start(v, 'done');
    } else if (t in w.tens) {
      const v = w.tens[t]!;
      if (cur !== null && slot === 'hundred') extend(v, 'tens');
      else if (cur === 1 && slot === 'unit') {
        st.cur = 100 + v; // "one forty four"
        st.slot = 'tens';
      } else start(v, 'tens');
    } else if (t === w.hundred) {
      st.cur = (cur ?? 1) * 100;
      st.slot = 'hundred';
    } else if (w.joiners.includes(t)) {
      // "one hundred and eight": keep building
    } else {
      // "a hundred" starts fresh; any other word ends the number in progress.
      flush();
    }
  }
  flush();
  return out;
}

/** True when the speaker may still be mid-number ("forty…", "one hundred…", "one…"). */
export function mayContinue(text: string, lang = 'en'): boolean {
  const w = wordsFor(lang);
  const last = tokenize(text).at(-1);
  return (
    last !== undefined &&
    (last in w.tens || last === w.hundred || w.joiners.includes(last) || w.units[last] === 1)
  );
}

export function lastNumber(text: string, lang = 'en'): number | null {
  return parseNumbers(text, lang).at(-1) ?? null;
}
