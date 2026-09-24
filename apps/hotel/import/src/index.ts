import { Pool } from 'pg';
import { importLegacyData } from './importLegacy';

/**
 * CLI entrypoint, run once per client at cutover:
 *
 *   MYSQL_URL=mysql://user:pass@host/legacy_db \
 *   DATABASE_URL=postgres://hotel:...@host/hotel \
 *   node dist/index.js
 *
 * Both env vars match the names hotel-core and its migration runner already
 * use, rather than inventing new ones for the same idea.
 */
async function main(): Promise<void> {
  const mysqlUrl = process.env.MYSQL_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!mysqlUrl || !databaseUrl) {
    console.error('Usage: MYSQL_URL=<legacy db> DATABASE_URL=<hotel-core db> node dist/index.js');
    process.exit(1);
  }

  const pg = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await importLegacyData(mysqlUrl, pg);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.unmatchedQuestionTexts.length > 0) {
      console.warn(
        `${summary.feedbackSkippedNoQuestionMatch} response(s) skipped: no pulse_questions row matches ` +
          `their legacy question text exactly. Add or edit a question in hotel-admin to match, then re-run ` +
          `(re-running is safe — already-imported responses are left alone).`
      );
    }
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
