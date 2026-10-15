import { describe, expect, it } from 'vitest';
import { mayContinue, parseNumbers } from './parseNumbers';

describe('parseNumbers', () => {
  it.each<[string, number[]]>([
    // Required cases from PLAN §5
    ['56', [56]],
    ['Fifty-six.', [56]],
    ['fifty six', [56]],
    ['seven times eight is fifty six', [7, 8, 56]],
    ['one hundred forty four', [144]],
    ['one forty four', [144]],
    ['a hundred and twenty', [120]],
    ['one hundred and eight', [108]],
    ['sixty for', [64]],
    ["I think it's 42", [42]],
    ['81!', [81]],
    // More
    ['', []],
    ['Thank you.', []],
    ['twelve', [12]],
    ['one twelve', [112]],
    ['one hundred', [100]],
    ['a hundred', [100]],
    ['ninety', [90]],
    ['eight', [8]],
    ['ate', [8]],
    ['1,000', [1000]],
    ['7 times 8 is 56', [7, 8, 56]],
    ['forty two forty five', [42, 45]],
    ['twenty twenty', [20, 20]],
    ['six seven', [6, 7]],
    ['zero', [0]],
    ['one hundred twelve', [112]],
    ['um, it is thirty-six', [36]],
    ['Free.', [3]],
    ['twenty free', [23]],
  ])('%j → %j', (input, expected) => {
    expect(parseNumbers(input)).toEqual(expected);
  });
});

describe('mayContinue', () => {
  it.each<[string, boolean]>([
    ['forty', true],
    ['it is forty', true],
    ['one hundred', true],
    ['one hundred and', true],
    ['one', true],
    ['forty two', false],
    ['56', false],
    ['twelve', false],
    ['', false],
  ])('%j → %s', (input, expected) => {
    expect(mayContinue(input)).toBe(expected);
  });
});
