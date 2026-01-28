#!/usr/bin/env node
/**
 * Fix NULL or invalid call_datetime values in PostgreSQL
 *
 * This script checks for transcripts with NULL call_datetime
 * and attempts to fix them by:
 * 1. Extracting date from created_at
 * 2. Setting a reasonable default
 *
 * Run on Railway: railway run node scripts/fix-postgres-dates.js
 * Or locally with DATABASE_URL set
 */

require('dotenv').config();
const { Pool } = require('pg');

// Check for DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Set it to your PostgreSQL connection string or run via Railway CLI.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function diagnose() {
  console.log('');
  console.log('='.repeat(60));
  console.log('PostgreSQL Date Diagnostics');
  console.log('='.repeat(60));
  console.log('');

  const client = await pool.connect();

  try {
    // Check total count
    const totalResult = await client.query('SELECT COUNT(*) as count FROM transcripts');
    console.log(`Total transcripts: ${totalResult.rows[0].count}`);

    // Check NULL dates
    const nullResult = await client.query('SELECT COUNT(*) as count FROM transcripts WHERE call_datetime IS NULL');
    console.log(`Transcripts with NULL call_datetime: ${nullResult.rows[0].count}`);

    // Check valid dates
    const validResult = await client.query('SELECT COUNT(*) as count FROM transcripts WHERE call_datetime IS NOT NULL');
    console.log(`Transcripts with valid call_datetime: ${validResult.rows[0].count}`);

    // Sample of NULL dates
    if (parseInt(nullResult.rows[0].count) > 0) {
      console.log('\nSample transcripts with NULL call_datetime:');
      const sampleResult = await client.query(`
        SELECT id, fireflies_id, call_title, created_at
        FROM transcripts
        WHERE call_datetime IS NULL
        LIMIT 5
      `);
      sampleResult.rows.forEach((row, i) => {
        console.log(`  ${i + 1}. "${row.call_title}" (created: ${row.created_at})`);
      });
    }

    // Sample of valid dates
    console.log('\nSample transcripts with valid call_datetime:');
    const validSampleResult = await client.query(`
      SELECT id, call_title, call_datetime, created_at
      FROM transcripts
      WHERE call_datetime IS NOT NULL
      ORDER BY call_datetime DESC
      LIMIT 5
    `);
    validSampleResult.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. "${row.call_title}" (datetime: ${row.call_datetime})`);
    });

    return {
      total: parseInt(totalResult.rows[0].count),
      nullDates: parseInt(nullResult.rows[0].count),
      validDates: parseInt(validResult.rows[0].count)
    };

  } finally {
    client.release();
  }
}

async function fixNullDates() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Fixing NULL call_datetime values');
  console.log('='.repeat(60));
  console.log('');

  const client = await pool.connect();

  try {
    // Get all transcripts with NULL call_datetime
    const nullResult = await client.query(`
      SELECT id, fireflies_id, call_title, created_at
      FROM transcripts
      WHERE call_datetime IS NULL
    `);

    if (nullResult.rows.length === 0) {
      console.log('No transcripts with NULL call_datetime found. Nothing to fix!');
      return { fixed: 0 };
    }

    console.log(`Found ${nullResult.rows.length} transcripts with NULL call_datetime`);
    console.log('');

    let fixed = 0;

    for (const row of nullResult.rows) {
      // Use created_at as fallback for call_datetime
      const fallbackDate = row.created_at;

      if (fallbackDate) {
        await client.query(
          'UPDATE transcripts SET call_datetime = $1 WHERE id = $2',
          [fallbackDate, row.id]
        );
        console.log(`  Fixed: "${row.call_title}" -> ${fallbackDate}`);
        fixed++;
      } else {
        console.log(`  Skipped: "${row.call_title}" (no created_at available)`);
      }
    }

    console.log('');
    console.log(`Fixed ${fixed} of ${nullResult.rows.length} transcripts`);

    return { fixed, total: nullResult.rows.length };

  } finally {
    client.release();
  }
}

async function main() {
  try {
    // First run diagnostics
    const diagResult = await diagnose();

    // Ask user if they want to fix
    if (diagResult.nullDates > 0) {
      console.log('');
      console.log('-'.repeat(60));
      console.log('');

      // Check if --fix flag is passed
      if (process.argv.includes('--fix')) {
        const fixResult = await fixNullDates();
        console.log('');
        console.log('Done! Run the script again without --fix to verify.');
      } else {
        console.log('To fix the NULL dates, run with --fix flag:');
        console.log('  node scripts/fix-postgres-dates.js --fix');
      }
    } else {
      console.log('');
      console.log('All call_datetime values are valid. No action needed.');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
