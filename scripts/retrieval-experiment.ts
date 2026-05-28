import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';

import { createStandaloneDb, shutdownServerPool } from '../src/db.ts';
import {
  VOYAGE_EXPERIMENT_EMBEDDING_VERSION,
  embedVoyageExperiment,
  ensureVoyageExperimentTable,
} from '../src/retrieval-experiment.ts';

interface ChunkRow extends Record<string, unknown> {
  id: string;
  source: string;
  chunk_index: number;
  text: string;
  game: string;
  content_hash: string | null;
}

async function staleVoyageRows(): Promise<ChunkRow[]> {
  const handle = createStandaloneDb({ max: 1 });
  try {
    const rows = await handle.db.execute<ChunkRow>(sql`
      SELECT e.id, e.source, e.chunk_index, e.text, e.game, e.content_hash
      FROM embeddings e
      LEFT JOIN retrieval_experiment_voyage_embeddings v
        ON v.id = e.id
       AND v.embedding_version = ${VOYAGE_EXPERIMENT_EMBEDDING_VERSION}
      WHERE v.id IS NULL
         OR v.content_hash IS DISTINCT FROM e.content_hash
         OR v.text IS DISTINCT FROM e.text
         OR v.source IS DISTINCT FROM e.source
         OR v.chunk_index IS DISTINCT FROM e.chunk_index
         OR v.game IS DISTINCT FROM e.game
      ORDER BY e.game, e.source, e.chunk_index
    `);
    return rows.rows;
  } finally {
    await handle.close();
  }
}

async function upsertVoyageRows(rows: ChunkRow[], embeddings: number[][]): Promise<void> {
  const handle = createStandaloneDb({ max: 1 });
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      await handle.db.execute(sql`
        INSERT INTO retrieval_experiment_voyage_embeddings (
          id,
          source,
          chunk_index,
          text,
          game,
          content_hash,
          embedding_version,
          embedding
        )
        VALUES (
          ${row.id},
          ${row.source},
          ${row.chunk_index},
          ${row.text},
          ${row.game},
          ${row.content_hash},
          ${VOYAGE_EXPERIMENT_EMBEDDING_VERSION},
          ${`[${embeddings[i]!.join(',')}]`}::vector
        )
        ON CONFLICT (id) DO UPDATE SET
          source = EXCLUDED.source,
          chunk_index = EXCLUDED.chunk_index,
          text = EXCLUDED.text,
          game = EXCLUDED.game,
          content_hash = EXCLUDED.content_hash,
          embedding_version = EXCLUDED.embedding_version,
          embedding = EXCLUDED.embedding
      `);
    }
  } finally {
    await handle.close();
  }
}

async function indexVoyage(): Promise<void> {
  await ensureVoyageExperimentTable();
  const rows = await staleVoyageRows();
  console.log(`Voyage experiment index has ${rows.length} stale or missing chunk(s).`);
  const batchSize = 8;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const embeddings = await embedVoyageExperiment(
      batch.map((row) => row.text),
      'document',
    );
    await upsertVoyageRows(batch, embeddings);
    console.log(`Indexed ${Math.min(i + batch.length, rows.length)}/${rows.length}`);
  }
}

async function countVoyage(): Promise<void> {
  await ensureVoyageExperimentTable();
  const handle = createStandaloneDb({ max: 1 });
  try {
    const result = await handle.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM retrieval_experiment_voyage_embeddings
      WHERE embedding_version = ${VOYAGE_EXPERIMENT_EMBEDDING_VERSION}
    `);
    console.log(`Voyage experiment rows: ${result.rows[0]?.count ?? 0}`);
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'index-voyage';
  if (command === 'index-voyage') {
    await indexVoyage();
    return;
  }
  if (command === 'count-voyage') {
    await countVoyage();
    return;
  }
  throw new Error(`Unknown retrieval experiment command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownServerPool();
    });
}
