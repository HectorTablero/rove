import { describe, expect, it } from 'vitest';
import { applyCase } from './casing';

describe('applyCase', () => {
  it('title-cases an English title, keeping small words down except at the edges', () => {
    expect(applyCase('the wandering earth', 'en', 'title')).toBe('The Wandering Earth');
    expect(applyCase('return of the king', 'en', 'title')).toBe('Return of the King');
    expect(applyCase('what are you looking at', 'en', 'title')).toBe('What Are You Looking At');
    expect(applyCase('ne zha 2: the demon child', 'en', 'title')).toBe('Ne Zha 2: The Demon Child');
  });

  it('leaves acronyms and brands as the engine wrote them, and capitalises hyphenated parts', () => {
    expect(applyCase('IMAX night at McDonald’s', 'en', 'title')).toBe('IMAX Night at McDonald’s');
    expect(applyCase('spider-man in 3D', 'en', 'title')).toBe('Spider-Man in 3D');
  });

  it('uses sentence case for Spanish and Italian titles, and for tags anywhere', () => {
    expect(applyCase('la tierra errante', 'es', 'title')).toBe('La tierra errante');
    expect(applyCase('la terra errante', 'it', 'title')).toBe('La terra errante');
    expect(applyCase('rock music', 'en', 'sentence')).toBe('Rock music');
    expect(applyCase('«exposición»', 'es', 'sentence')).toBe('«Exposición»');
  });

  it('leaves languages without case alone', () => {
    expect(applyCase('流浪地球', 'ja', 'title')).toBe('流浪地球');
    expect(applyCase('流浪地球', 'zh', 'sentence')).toBe('流浪地球');
  });
});
