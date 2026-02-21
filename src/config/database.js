const knex = require('knex');

const config = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'appasamy_target_setting',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    afterCreate: (conn, done) => {

      conn.query(`SET search_path TO ${process.env.DB_SCHEMA || 'target_setting'}, public;`, (err) => {
        done(err, conn);
      });
    },
  },
  searchPath: [process.env.DB_SCHEMA || 'target_setting', 'public'],
};

const db = knex(config);


const testConnection = async () => {
  try {
    await db.raw('SELECT 1+1 AS result');
    console.log('✅ Database connected successfully');
    const schemaCheck = await db.raw(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`,
      [process.env.DB_SCHEMA || 'target_setting']
    );
    if (schemaCheck.rows.length === 0) {
      console.warn('⚠️  Schema "target_setting" not found. Run the SQL setup script first.');
    }
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = { db, testConnection, config };
