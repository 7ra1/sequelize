const { connect } = require('@tursodatabase/database');

async function testTursoConnection() {
  console.log('Testing basic Turso connection...');
  
  const db = await connect(':memory:');
  console.log('✅ Connected to :memory: database');

  console.log('\nTesting exec with simple CREATE TABLE...');
  await db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
  console.log('✅ CREATE TABLE executed');

  console.log('\nTesting PRAGMA FOREIGN_KEYS=ON...');
  try {
    await db.exec('PRAGMA FOREIGN_KEYS=ON');
    console.log('✅ PRAGMA FOREIGN_KEYS=ON executed');
  } catch (error) {
    console.error('❌ PRAGMA FOREIGN_KEYS=ON failed:', error.message);
  }

  console.log('\nTesting PRAGMA foreign_keys = ON (with spaces)...');
  try {
    await db.exec('PRAGMA foreign_keys = ON');
    console.log('✅ PRAGMA foreign_keys = ON executed');
  } catch (error) {
    console.error('❌ PRAGMA foreign_keys = ON failed:', error.message);
  }

  console.log('\nTesting db.pragma method...');
  try {
    const result = await db.pragma('foreign_keys = ON');
    console.log('✅ db.pragma("foreign_keys = ON") executed, result:', result);
  } catch (error) {
    console.error('❌ db.pragma("foreign_keys = ON") failed:', error.message);
  }

  console.log('\nTesting PRAGMA TABLE_INFO (uppercase)...');
  try {
    await db.exec('PRAGMA TABLE_INFO(test)');
    console.log('✅ PRAGMA TABLE_INFO(test) executed');
  } catch (error) {
    console.error('❌ PRAGMA TABLE_INFO(test) failed:', error.message);
  }

  console.log('\nTesting PRAGMA table_info (lowercase)...');
  try {
    const stmt = db.prepare('PRAGMA table_info(test)');
    const result = await stmt.all();
    console.log('✅ PRAGMA table_info(test) executed, result:', result);
  } catch (error) {
    console.error('❌ PRAGMA table_info(test) failed:', error.message);
  }

  console.log('\nTesting prepare and run...');
  const stmt = db.prepare('INSERT INTO test (name) VALUES (?)');
  const result = await stmt.run('Test Name');
  console.log('✅ Insert executed, result:', result);

  console.log('\nTesting select all...');
  const all = await db.prepare('SELECT * FROM test').all();
  console.log('✅ Select all:', all);

  await db.close();
  console.log('\n✅ Connection closed');
}

testTursoConnection().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
