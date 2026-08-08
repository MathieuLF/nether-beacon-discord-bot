#!/usr/bin/env node

const {
  autocompletePokedex,
  formatAbilitySummary,
  formatMoveSummary,
  formatPokemonSummary,
  formatRandomPokemonSummary,
  formatTypeSummary,
  formatWeaknessSummary,
} = require('../lib/pokedex');

const contentOf = (result) => (typeof result === 'string' ? result : result?.content || '');

const commandChecks = [
  ['pokemon', () => formatPokemonSummary('charizard'), '**🔎 Pokédex: Charizard'],
  ['weakness', () => formatWeaknessSummary('charizard'), '**🛡️ Weaknesses: Charizard**'],
  ['move', () => formatMoveSummary('flamethrower'), '**💥 Move: Flamethrower**'],
  ['ability', () => formatAbilitySummary('intimidate'), '**✨ Ability: Intimidate**'],
  ['type', () => formatTypeSummary('fire'), '**🧬 Type: Fire**'],
  ['random-pokemon', () => formatRandomPokemonSummary(), '**🔎 Pokédex:'],
];

const autocompleteChecks = [
  ['pokemon', 'chari'],
  ['weakness', 'chari'],
  ['move', 'flame'],
  ['ability', 'intim'],
  ['type', 'fi'],
];

const main = async () => {
  for (const [name, run, marker] of commandChecks) {
    const content = contentOf(await run());
    if (!content.includes(marker) || content.length === 0) {
      throw new Error(`${name} returned an invalid response`);
    }
    console.log(`${name}=ok|chars=${content.length}`);
  }

  for (const [name, query] of autocompleteChecks) {
    const choices = await autocompletePokedex(name, query);
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 25) {
      throw new Error(`${name} autocomplete returned ${choices?.length ?? 'invalid'} choices`);
    }
    console.log(`${name}-autocomplete=ok|choices=${choices.length}`);
  }

  console.log('pokedex-live-verification=ok');
};

main().catch((error) => {
  console.error(`pokedex-live-verification=failed|${error.message}`);
  process.exit(1);
});
