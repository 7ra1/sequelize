const { Sequelize, DataTypes } = require('@sequelize/core');
const { TursoDialect } = require('@sequelize/turso');

async function testTursoDialect() {
  console.log('🧪 Testing Turso Dialect Implementation\n');

  console.log('Test 1: In-Memory Database Connection');
  const sequelizeMemory = new Sequelize({
    dialect: TursoDialect,
    storage: ':memory:',
    logging: (sql) => console.log('[SQL]', sql.substring(0, 150)),
    pool: {
      max: 1,
      idle: Infinity,
      maxUses: Infinity,
      idleTimeoutMillis: Infinity,
      maxUsesPerResource: Infinity,
    },
  });

  try {
    await sequelizeMemory.authenticate();
    console.log('✅ In-memory connection successful\n');
  } catch (error) {
    console.error('❌ In-memory connection failed:', error.message);
    process.exit(1);
  }

  console.log('Test 2: Model Definition and Sync');
  const User = sequelizeMemory.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    age: {
      type: DataTypes.INTEGER,
    },
  });
  let uniqueUser;

  try {
    await sequelizeMemory.sync({ force: true });
    console.log('✅ Model sync successful\n');
  } catch (error) {
    console.error('❌ Model sync failed:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }

  console.log('Test 3: Create Operation');
  try {
    const user1 = await User.create({
      username: 'testuser1',
      email: 'test1@example.com',
      age: 25,
    });
    console.log('✅ Created user:', user1.toJSON());

    const user2 = await User.create({
      username: 'testuser2',
      email: 'test2@example.com',
      age: 30,
    });
    console.log('✅ Created user:', user2.toJSON());
    console.log();
  } catch (error) {
    console.error('❌ Create operation failed:', error.message);
    process.exit(1);
  }

  console.log('Test 4: Read Operation (findAll)');
  try {
    const users = await User.findAll();
    console.log(`✅ Found ${users.length} users:`, users.map(u => u.toJSON()));
    console.log();
  } catch (error) {
    console.error('❌ Read operation failed:', error.message);
    process.exit(1);
  }

  console.log('Test 5: Read Operation (findOne)');
  try {
    const user = await User.findOne({ where: { username: 'testuser1' } });
    console.log('✅ Found user:', user?.toJSON());
    console.log();
  } catch (error) {
    console.error('❌ FindOne operation failed:', error.message);
    process.exit(1);
  }

  console.log('Test 6: Update Operation');
  try {
    const [affectedCount] = await User.update(
      { age: 26 },
      { where: { username: 'testuser1' } }
    );
    console.log(`✅ Updated ${affectedCount} user(s)`);
    
    const updatedUser = await User.findOne({ where: { username: 'testuser1' } });
    console.log('✅ Updated user:', updatedUser?.toJSON());

    await sequelizeMemory.query('UPDATE Users SET age = 26 WHERE username = "testuser1"');
    const directUpdatedUser = await User.findOne({ where: { username: 'testuser1' } });
    console.log('DEBUG_DIRECT_UPDATE_USER', directUpdatedUser?.toJSON());
    console.log();
  } catch (error) {
    console.error('❌ Update operation failed:', error.message);
    process.exit(1);
  }

  console.log('Test 7: Delete Operation');
  try {
    const deletedCount = await User.destroy({ where: { username: 'testuser2' } });
    console.log(`✅ Deleted ${deletedCount} user(s)`);
    
    const remainingUsers = await User.findAll();
    console.log(`✅ Remaining users: ${remainingUsers.length}`);
    console.log();
  } catch (error) {
    console.error('❌ Delete operation failed:', error.message);
    process.exit(1);
  }

  console.log('Test 8: Raw Query Execution');
  try {
    const [results] = await sequelizeMemory.query('SELECT * FROM Users WHERE age > 20');
    console.log('✅ Raw query results:', results);
    console.log();
  } catch (error) {
    console.error('❌ Raw query failed:', error.message);
    process.exit(1);
  }

  console.log('Test 9: Transaction Support');
  try {
    await sequelizeMemory.transaction(async (t) => {
      await User.create({
        username: 'transactionuser',
        email: 'transaction@example.com',
        age: 35,
      }, { transaction: t });

      const users = await User.findAll({ transaction: t });
      console.log(`✅ Users in transaction: ${users.length}`);
    });

    const finalUsers = await User.findAll();
    console.log(`✅ Transaction committed, total users: ${finalUsers.length}`);
    console.log();
  } catch (error) {
    console.error('❌ Transaction failed:', error.message);
    process.exit(1);
  }

  console.log('Test 10: Bulk Create with Returning');
  try {
    const bulkUsers = await User.bulkCreate(
      [
        { username: 'bulkuser1', email: 'bulk1@example.com', age: 28 },
        { username: 'bulkuser2', email: 'bulk2@example.com', age: 31 },
      ],
      { returning: true },
    );
    console.log('✅ Bulk created users:', bulkUsers.map(user => user.toJSON()));
    console.log();
  } catch (error) {
    console.error('❌ Bulk create failed:', error.message);
    process.exit(1);
  }

  console.log('Test 11: Find Or Create');
  try {
    const [user, created] = await User.findOrCreate({
      where: { username: 'uniqueuser' },
      defaults: { email: 'uniqueuser@example.com', age: 33 },
    });
    uniqueUser = user;
    console.log(`✅ FindOrCreate result (created: ${created}):`, user.toJSON());
    console.log();
  } catch (error) {
    console.error('❌ FindOrCreate failed:', error.message);
    process.exit(1);
  }

  console.log('Test 12: Upsert Operation');
  try {
    const [upsertedUser, created] = await User.upsert(
      {
        id: uniqueUser.id,
        username: 'uniqueuser',
        email: 'uniqueuser@example.com',
        age: 36,
      },
      { returning: true },
    );
    console.log(`✅ Upsert completed (created: ${created}):`, upsertedUser?.toJSON?.());
    console.log();
  } catch (error) {
    console.error('❌ Upsert failed:', error.message);
    process.exit(1);
  }

  console.log('Test 13: Named Bind Parameters');
  try {
    const updateResult = await sequelizeMemory.query('UPDATE Users SET age = $age WHERE username = $username', {
      type: Sequelize.QueryTypes.UPDATE,
      bind: { age: 40, username: 'uniqueuser' },
    });
    console.log('DEBUG_NAMED_BIND_METADATA', updateResult);
    const namedBindUser = await User.findOne({ where: { username: 'uniqueuser' } });
    console.log('✅ Named bind update result:', namedBindUser?.toJSON());
    const allUsers = await sequelizeMemory.query('SELECT username, age FROM Users', {
      type: Sequelize.QueryTypes.SELECT,
    });
    console.log('DEBUG_ALL_USERS', allUsers);
    console.log();
  } catch (error) {
    console.error('❌ Named bind query failed:', error.message);
    process.exit(1);
  }

  console.log('Test 14: File-Based Database');
  const sequelizeFile = new Sequelize({
    dialect: TursoDialect,
    storage: './test.db',
    logging: false,
  });

  const FileUser = sequelizeFile.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });

  try {
    await sequelizeFile.sync({ force: true });
    await FileUser.create({ username: 'fileuser' });
    const users = await FileUser.findAll();
    console.log(`✅ File-based database works, users: ${users.length}`);
    await sequelizeFile.close();
    console.log('✅ File-based database connection closed\n');
  } catch (error) {
    console.error('❌ File-based database test failed:', error.message);
    process.exit(1);
  }

  await sequelizeMemory.close();
  console.log('✅ All tests passed! Turso dialect is working correctly.');
}

testTursoDialect().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
