export type WorkLogSourceAction = {
  label: 'RULEBOOK' | 'PUZZLE BOOK' | 'CARD INDEX' | 'SCENARIO BOOK' | 'SECTION BOOK';
  detail: string;
};

function titleizeSlug(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function displayScenarioNumber(value: string): string {
  return value.replace(/^0+(\d)/, '$1');
}

function removeLeadingArticle(value: string): string {
  return value.replace(/^the\s+/i, '');
}

function humanizeCardRef(ref: string): string | null {
  const match = ref.match(/^card:[^/]+\/([^/]+)\/gloomhavensecretariat:([^/]+)\/(.+)$/);
  if (!match) return null;

  const [, type, sourceKind, path] = match;
  const pathParts = path.split('/').filter(Boolean);
  if (pathParts.length === 0) return null;

  if (type === 'monster-stats' && sourceKind === 'monster-stat') {
    const nameParts = pathParts.slice(0, -1);
    const name = titleizeSlug((nameParts.length > 0 ? nameParts : pathParts).join('-'));
    return `the ${name} stat card`;
  }

  const lastPathPart = pathParts.at(-1);
  const name = titleizeSlug(lastPathPart ?? pathParts.join('-'));
  if (type === 'items')
    return /^\d+$/.test(name) ? `the item ${name} card` : `the ${name} item card`;
  if (type === 'monster-abilities') return `the ${name} monster ability card`;
  if (type === 'character-abilities') return `the ${name} ability card`;
  if (type === 'buildings') return `the ${name} building card`;
  return `the ${name} card`;
}

function sourceActionFromRef(ref: string): WorkLogSourceAction | null {
  const bareSection = ref.match(/^(?:section\s+)?(\d+(?:\.\d+)+)$/i);
  if (bareSection) {
    return {
      label: 'SECTION BOOK',
      detail: `Looked up section ${bareSection[1]!.trim()} in the section book`,
    };
  }

  const bareScenario = ref.match(/^(?:scenario\s+)?(\d+)$/i);
  if (bareScenario) {
    return {
      label: 'SCENARIO BOOK',
      detail: `Looked up scenario ${displayScenarioNumber(bareScenario[1]!.trim())} in the scenario book`,
    };
  }

  const card = humanizeCardRef(ref);
  if (card) return { label: 'CARD INDEX', detail: `Checked ${removeLeadingArticle(card)}` };

  const scenario = ref.match(/^scenario:[^/]+\/(.+)$/);
  if (scenario) {
    return {
      label: 'SCENARIO BOOK',
      detail: `Looked up scenario ${displayScenarioNumber(scenario[1]!.trim())} in the scenario book`,
    };
  }

  const legacyScenario = ref.match(/^gloomhavensecretariat:scenario\/(.+)$/);
  if (legacyScenario) {
    return {
      label: 'SCENARIO BOOK',
      detail: `Looked up scenario ${displayScenarioNumber(legacyScenario[1]!.trim())} in the scenario book`,
    };
  }

  const section = ref.match(/^section:[^/]+\/(.+)$/);
  if (section) {
    return {
      label: 'SECTION BOOK',
      detail: `Looked up section ${section[1]!.trim()} in the section book`,
    };
  }

  const rules = ref.match(/^rules:[^/]+\/(.+)#chunk=\d+$/);
  if (rules) {
    const source = rules[1]!.toLowerCase();
    if (source.includes('puzzle'))
      return { label: 'PUZZLE BOOK', detail: 'Checked the puzzle book' };
    if (source.includes('section'))
      return { label: 'SECTION BOOK', detail: 'Checked the section book' };
    if (source.includes('scenario'))
      return { label: 'SCENARIO BOOK', detail: 'Checked the scenario book' };
    return { label: 'RULEBOOK', detail: 'Checked the rulebook' };
  }

  return null;
}

function searchActionFromBookLabel(label: string): WorkLogSourceAction | null {
  const normalized = removeLeadingArticle(label.trim().toLowerCase());
  if (normalized === 'rulebook') {
    return { label: 'RULEBOOK', detail: 'Searched the rulebook' };
  }
  if (normalized === 'puzzle book') {
    return { label: 'PUZZLE BOOK', detail: 'Searched the puzzle book' };
  }
  if (normalized === 'scenario book') {
    return { label: 'SCENARIO BOOK', detail: 'Searched the scenario book' };
  }
  if (normalized === 'section book') {
    return { label: 'SECTION BOOK', detail: 'Searched the section book' };
  }
  if (normalized === 'card index' || normalized === 'cards') {
    return { label: 'CARD INDEX', detail: 'Searched cards' };
  }
  return null;
}

export function humanizeWorkLogProgressMessage(message: string): string {
  const checkingCard = message.match(/^Checking\s+the\s+(.+\s+card)$/i);
  if (checkingCard) return `Checked ${checkingCard[1]!.trim()}`;

  const lookingUpSectionInBook = message.match(
    /^Looking up\s+section\s+(.+?)\s+in the section book$/i,
  );
  if (lookingUpSectionInBook) {
    return `Looked up section ${lookingUpSectionInBook[1]!.trim()} in the section book`;
  }

  const lookingUpScenarioInBook = message.match(
    /^Looking up\s+scenario\s+(.+?)\s+in the scenario book$/i,
  );
  if (lookingUpScenarioInBook) {
    return `Looked up scenario ${displayScenarioNumber(lookingUpScenarioInBook[1]!.trim())} in the scenario book`;
  }

  if (/^Looking up\s+.+\s+in the rulebook$/i.test(message)) return 'Searched the rulebook';
  if (/^Looking up\s+.+\s+in the puzzle book$/i.test(message)) return 'Searched the puzzle book';
  if (/^Looking up\s+.+\s+in the scenario book$/i.test(message))
    return 'Searched the scenario book';
  if (/^Looking up\s+.+\s+in the section book$/i.test(message)) return 'Searched the section book';

  const opening = message.match(/^Opening\s+(.+)$/i);
  if (opening) {
    const action = sourceActionFromRef(opening[1]!.trim());
    if (action) return action.detail;
  }

  const checkingLinks = message.match(/^Checking links from\s+(.+)$/i);
  if (checkingLinks) {
    const action = sourceActionFromRef(checkingLinks[1]!.trim());
    if (action) return `Followed links from ${action.detail.replace(/^Checked\s+/, '')}`;
  }

  const checking = message.match(/^Checking\s+(.+)$/i);
  if (checking) return `Checked ${checking[1]!.trim()}`;

  const resolvingMonster = message.match(/^Resolving\s+(.+?)\s+monster(?:\s+stat(?:\s+card)?)?$/i);
  if (resolvingMonster) {
    return `Checked ${titleizeSlug(resolvingMonster[1]!.trim())} stat card`;
  }
  const resolvingStats = message.match(/^Resolving\s+(.+?)\s+stats$/i);
  if (resolvingStats) return `Checked ${titleizeSlug(resolvingStats[1]!.trim())} stat card`;
  const resolving = message.match(/^Resolving\s+(.+)$/i);
  if (resolving) return `Looked up ${resolving[1]!.trim()}`;

  const searchingBook = message.match(/^Searching\s+(.+)$/i);
  if (searchingBook) {
    const action = searchActionFromBookLabel(searchingBook[1]!);
    if (action) return action.detail;
    if (searchingBook[1]!.includes(',')) return 'Searched available sources';
  }

  if (message === 'Searching selected sources') return 'Searched available sources';
  if (message === 'Searching knowledge') return 'Searched available sources';
  return message;
}

export function activeWorkLogProgressMessageFromCompleted(message: string): string {
  const checked = message.match(/^Checked\s+(.+)$/i);
  if (checked) return `Checking ${checked[1]!.trim()}`;

  const searched = message.match(/^Searched\s+(.+)$/i);
  if (searched) return `Searching ${searched[1]!.trim()}`;

  const lookedUp = message.match(/^Looked up\s+(.+)$/i);
  if (lookedUp) return `Looking up ${lookedUp[1]!.trim()}`;

  const followedLinks = message.match(/^Followed links from\s+(.+)$/i);
  if (followedLinks) return `Following links from ${followedLinks[1]!.trim()}`;

  const inspected = message.match(/^Inspected\s+(.+)$/i);
  if (inspected) return `Inspecting ${inspected[1]!.trim()}`;

  const ran = message.match(/^Ran\s+(.+)$/i);
  if (ran) return `Running ${ran[1]!.trim()}`;

  return message;
}

export function workLogSourceActionFromProgressMessage(
  message: string,
  sourceLabel?: string | null,
): WorkLogSourceAction | null {
  const detail = humanizeWorkLogProgressMessage(message);
  if (/^Checked .+ card$/i.test(detail) || detail === 'Searched cards') {
    return { label: 'CARD INDEX', detail };
  }
  if (
    detail === 'Searched the rulebook' ||
    detail === 'Checked the rulebook' ||
    / in the rulebook$/i.test(detail)
  ) {
    return { label: 'RULEBOOK', detail };
  }
  if (
    detail === 'Searched the puzzle book' ||
    detail === 'Checked the puzzle book' ||
    / in the puzzle book$/i.test(detail)
  ) {
    return { label: 'PUZZLE BOOK', detail };
  }
  if (
    detail === 'Searched the scenario book' ||
    detail === 'Checked the scenario book' ||
    / in the scenario book$/i.test(detail)
  ) {
    return { label: 'SCENARIO BOOK', detail };
  }
  if (
    detail === 'Searched the section book' ||
    detail === 'Checked the section book' ||
    / in the section book$/i.test(detail)
  ) {
    return { label: 'SECTION BOOK', detail };
  }

  const sectionLookup = detail.match(/^Looked up\s+section\s+(.+)$/i);
  if (sectionLookup) {
    return {
      label: 'SECTION BOOK',
      detail: `Looked up section ${sectionLookup[1]!.trim()} in the section book`,
    };
  }

  const scenarioLookup = detail.match(/^Looked up\s+scenario\s+(.+)$/i);
  if (scenarioLookup) {
    return {
      label: 'SCENARIO BOOK',
      detail: `Looked up scenario ${displayScenarioNumber(scenarioLookup[1]!.trim())} in the scenario book`,
    };
  }

  if (sourceLabel === 'RULEBOOK' && detail !== 'Searched available sources') {
    return { label: 'RULEBOOK', detail: `${detail} in the rulebook` };
  }
  if (sourceLabel === 'PUZZLE BOOK' && detail !== 'Searched available sources') {
    return { label: 'PUZZLE BOOK', detail: `${detail} in the puzzle book` };
  }
  if (sourceLabel === 'CARD INDEX' && detail !== 'Searched available sources') {
    const lookedUpCard = detail.match(/^Looked up\s+(.+\s+card)$/i);
    if (lookedUpCard) {
      return {
        label: 'CARD INDEX',
        detail: `Checked ${removeLeadingArticle(lookedUpCard[1]!.trim())}`,
      };
    }
    return { label: 'CARD INDEX', detail: `${detail} in the card index` };
  }
  if (sourceLabel === 'SCENARIO BOOK' && detail !== 'Searched available sources') {
    return { label: 'SCENARIO BOOK', detail: `${detail} in the scenario book` };
  }
  if (sourceLabel === 'SECTION BOOK' && detail !== 'Searched available sources') {
    return { label: 'SECTION BOOK', detail: `${detail} in the section book` };
  }
  return null;
}
