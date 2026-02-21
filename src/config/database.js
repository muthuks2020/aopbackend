/**
 * database.js — PostgreSQL / Knex Configuration
 * 
 * Provides a singleton Knex instance configured for the target_setting schema.
 * All services import { getKnex } to run queries.
 * 
 * @version 1.0.0
 * @author Appasamy Associates - Target Setting PWA
 */

const knex = require('knex');

let knexInstance = null;

function getKnex() {
  if (!knexInstance) {
    knexInstance = knex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'appasamy_target',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
      },
      searchPath: [process.env.DB_SCHEMA || 'target_setting', 'public'],
      pool: {
        min: 2,
        max: 10,
      },
    });
  }
  return knexInstance;
}

async function testConnection() {
  try {
    const knex = getKnex();
    await knex.raw('SELECT 1');
    console.log('[DB] PostgreSQL connection successful');
    return true;
  } catch (error) {
    console.error('[DB] PostgreSQL connection failed:', error.message);
    return false;
  }
}

async function destroy() {
  if (knexInstance) {
    await knexInstance.destroy();
    knexInstance = null;
  }
}

module.exports = {
  getKnex,
  testConnection,
  destroy,
};
