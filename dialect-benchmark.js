const { Sequelize, DataTypes } = require('@sequelize/core');
const { performance } = require('perf_hooks');

// Test configuration
const iterations = 1000;
const testData = Array.from({ length: iterations }, (_, i) => ({
  name: `User ${i}`,
  email: `user${i}@test.com`,
  age: Math.floor(Math.random() * 100)
}));

// Database configurations
const configs = {
  sqlite: {
    dialect: 'sqlite3',
    storage: ':memory:'
  },
  turso: {
    dialect: 'turso',
    storage: ':memory:'
  }
};

// Model definition
const defineUser = (sequelize) => {
  return sequelize.define('User', {
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    age: DataTypes.INTEGER
  });
};

// Benchmark function
async function runBenchmark(dialect, config) {
  console.log(`\nTesting ${dialect}...`);
  const sequelize = new Sequelize(config);
  const User = defineUser(sequelize);
  
  const results = {};
  
  try {
    // Sync
    const syncStart = performance.now();
    await sequelize.sync({ force: true });
    results.sync = performance.now() - syncStart;

    // Bulk Insert
    const insertStart = performance.now();
    await User.bulkCreate(testData);
    results.bulkInsert = performance.now() - insertStart;

    // Read all
    const readStart = performance.now();
    await User.findAll();
    results.readAll = performance.now() - readStart;

    // Single reads
    const singleReadStart = performance.now();
    for (let i = 0; i < 100; i++) {
      await User.findByPk(Math.floor(Math.random() * iterations) + 1);
    }
    results.singleReads = performance.now() - singleReadStart;

    // Update
    const updateStart = performance.now();
    await User.update({ age: 25 }, { where: { age: { [Sequelize.Op.gt]: 50 } } });
    results.update = performance.now() - updateStart;

    // Delete
    const deleteStart = performance.now();
    await User.destroy({ where: { age: 25 } });
    results.delete = performance.now() - deleteStart;

    await sequelize.close();
    return results;
  } catch (error) {
    console.error(`Error in ${dialect}:`, error);
    await sequelize.close();
    return null;
  }
}

// Run benchmarks
async function runTests() {
  const results = {};
  
  for (const [dialect, config] of Object.entries(configs)) {
    results[dialect] = await runBenchmark(dialect, config);
  }

  // Print results
  console.log('\nResults (in milliseconds):\n');
  console.table(results);
}

runTests().catch(console.error);