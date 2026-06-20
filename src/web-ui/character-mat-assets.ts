import { readFile } from 'node:fs/promises';

export interface CharacterMatArtwork {
  src: string;
  alt: string;
  attribution: string;
}

const GH2E_MAT_FILES_BY_CLASS = new Map<string, string>([
  ['berserker', 'gh2-berserker.jpeg'],
  ['bladeswarm', 'gh2-bladeswarm.jpeg'],
  ['bladewarm', 'gh2-bladeswarm.jpeg'],
  ['bruiser', 'gh2-bruiser.jpeg'],
  ['cragheart', 'gh2-cragheart.jpeg'],
  ['doomstalker', 'gh2-doomstalker.jpeg'],
  ['elementalist', 'gh2-elementalist.jpeg'],
  ['mindthief', 'gh2-mindthief.jpeg'],
  ['nightshroud', 'gh2-nightshroud.jpeg'],
  ['plagueherald', 'gh2-plagueherald.jpeg'],
  ['quartermaster', 'gh2-quartermaster.jpeg'],
  ['sawbones', 'gh2-sawbones.jpeg'],
  ['silentknife', 'gh2-silentknife.jpeg'],
  ['silent-knife', 'gh2-silentknife.jpeg'],
  ['soothsinger', 'gh2-soothsinger.jpeg'],
  ['spellweaver', 'gh2-spellweaver.jpeg'],
  ['sunkeeper', 'gh2-sunkeeper.jpeg'],
  ['tinkerer', 'gh2-tinkerer.jpeg'],
  ['wildfury', 'gh2-wildfury.jpeg'],
]);

const GH2E_ALLOWED_FILES = new Set([
  ...GH2E_MAT_FILES_BY_CLASS.values(),
  'gh2-quartermaster-back.jpeg',
  'gh2-soothsinger-back.jpeg',
]);

const CHARACTER_MAT_ASSET_ROOT = new URL('./character-mat-assets/', import.meta.url);
export const CHARACTER_MAT_ATTRIBUTION =
  'Artwork: Cephalofair Games · mirrored from cmlenius/gloomhaven-card-browser for non-commercial fan use.';

function classKey(className: string): string {
  return className
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function characterMatArtworkFor(
  game: string,
  className: string,
): CharacterMatArtwork | null {
  if (game !== 'gloomhaven-2e') return null;
  const file = GH2E_MAT_FILES_BY_CLASS.get(classKey(className));
  if (!file) return null;
  return {
    src: `/assets/character-mats/gloomhaven-2e/${file}`,
    alt: `${className} character mat artwork`,
    attribution: CHARACTER_MAT_ATTRIBUTION,
  };
}

export async function readCharacterMatAsset(input: {
  game: string;
  file: string;
}): Promise<Buffer | null> {
  if (input.game !== 'gloomhaven-2e') return null;
  if (!GH2E_ALLOWED_FILES.has(input.file)) return null;
  try {
    return await readFile(new URL(`${input.game}/${input.file}`, CHARACTER_MAT_ASSET_ROOT));
  } catch {
    return null;
  }
}
