# Turso Dialect Features

The Sequelize Turso dialect provides full support for Turso databases, including local, remote, and embedded replica configurations.

## Table of Contents

- [Connection Types](#connection-types)
- [Configuration Options](#configuration-options)
- [Advanced Features](#advanced-features)
- [Best Practices](#best-practices)

## Connection Types

### Local Database

```javascript
const { Sequelize } = require('@sequelize/core');
const { TursoDialect } = require('@nxtmd/turso');

const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
  // WAL mode is enabled by default for better concurrency
  enableWal: true,
});
```

### In-Memory Database

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: ':memory:',
  pool: {
    max: 1,
    idle: Infinity,
    maxUses: Infinity,
    maxUsesPerResource: Infinity,
    idleTimeoutMillis: Infinity,
  },
});
```

### Remote Turso Database

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  url: 'libsql://your-database.turso.io',
  authToken: 'your-auth-token-here',
});
```

### Embedded Replicas (Requires @libsql/client)

For full embedded replica support with automatic syncing, use `@libsql/client`:

```bash
npm install @libsql/client
```

```javascript
import { Sequelize } from '@sequelize/core';
import { TursoDialect } from '@nxtmd/turso';
import * as LibSQL from '@libsql/client';

const sequelize = new Sequelize({
  dialect: TursoDialect,
  dialectOptions: {
    tursoModule: LibSQL, // Use @libsql/client for embedded replicas
  },
  storage: './local-replica.db', // Local database file
  syncUrl: 'libsql://db.turso.io', // Remote database to sync with
  authToken: 'your-auth-token', // Authentication
  syncInterval: 60, // Auto-sync every 60 seconds
  encryptionKey: 'your-encryption-key', // Optional: encryption at rest
});
```

## Configuration Options

### Connection Options

| Option          | Type    | Description                                                    |
| --------------- | ------- | -------------------------------------------------------------- |
| `storage`       | string  | Path to local database file or `:memory:` for in-memory        |
| `url`           | string  | Remote Turso database URL (libsql://...)                       |
| `authToken`     | string  | Authentication token for remote database (required with `url`) |
| `syncUrl`       | string  | Remote URL for embedded replicas (requires @libsql/client)     |
| `syncInterval`  | number  | Auto-sync interval in seconds (requires @libsql/client)        |
| `encryptionKey` | string  | Encryption key for database at rest (requires @libsql/client)  |
| `password`      | string  | Password for encrypted local databases (PRAGMA KEY)            |
| `readonly`      | boolean | Open database in readonly mode                                 |
| `enableWal`     | boolean | Enable WAL mode for better concurrency (default: true)         |

### Dialect Options

| Option        | Type    | Description                                                    |
| ------------- | ------- | -------------------------------------------------------------- |
| `foreignKeys` | boolean | Enable/disable foreign key constraints (default: true)         |
| `tursoModule` | object  | Custom Turso module (use @libsql/client for embedded replicas) |

## Advanced Features

### Write-Ahead Logging (WAL) Mode

WAL mode is enabled by default for better concurrency:

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
  enableWal: true, // Default: true
});
```

**Benefits:**

- Concurrent readers while a write is in progress
- Better performance for high-concurrency workloads
- Reduced lock contention

### JSON Support

The Turso dialect fully supports JSON operations:

```javascript
const User = sequelize.define('User', {
  name: DataTypes.STRING,
  metadata: DataTypes.JSON,
});

// Create with JSON
await User.create({
  name: 'John',
  metadata: { age: 30, city: 'NYC' },
});

// Query JSON fields
const users = await User.findAll({
  where: {
    'metadata.age': { [Op.gt]: 25 },
  },
});
```

### Encryption

For local database encryption:

```javascript
// Using PRAGMA KEY (basic)
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './encrypted.db',
  password: 'your-password',
});

// Using encryptionKey (requires @libsql/client)
const sequelize = new Sequelize({
  dialect: TursoDialect,
  dialectOptions: {
    tursoModule: LibSQL,
  },
  storage: './encrypted.db',
  encryptionKey: 'your-encryption-key',
});
```

### Read-Only Mode

Open database in read-only mode to prevent writes:

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
  readonly: true,
});
```

## Best Practices

### 1. Use Embedded Replicas for Low-Latency Reads

```javascript
// Deploy with embedded replica for microsecond read latency
const sequelize = new Sequelize({
  dialect: TursoDialect,
  dialectOptions: {
    tursoModule: LibSQL,
  },
  storage: './local-replica.db',
  syncUrl: 'libsql://db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncInterval: 60, // Sync every minute
});
```

### 2. Enable WAL Mode for High Concurrency

```javascript
// WAL mode is enabled by default, but you can explicitly configure it
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
  enableWal: true,
});
```

### 3. Use Connection Pooling Wisely

For local databases:

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
  pool: {
    max: 5, // Multiple connections for better concurrency with WAL
    min: 1,
    idle: 10000,
  },
});
```

For in-memory databases:

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: ':memory:',
  pool: {
    max: 1, // MUST be 1 to prevent separate in-memory databases
    idle: Infinity,
    maxUses: Infinity,
    idleTimeoutMillis: Infinity,
  },
});
```

### 4. Handle Remote Database Errors

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  url: 'libsql://db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  retry: {
    max: 3, // Retry failed connections
  },
});

sequelize
  .authenticate()
  .then(() => console.log('Connected to Turso'))
  .catch(err => console.error('Connection failed:', err));
```

### 5. Use Environment Variables for Secrets

```javascript
const sequelize = new Sequelize({
  dialect: TursoDialect,
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  encryptionKey: process.env.TURSO_ENCRYPTION_KEY,
});
```

## Feature Comparison

| Feature            | @tursodatabase/database | @libsql/client |
| ------------------ | ----------------------- | -------------- |
| Local databases    | ✅                      | ✅             |
| Remote databases   | ✅                      | ✅             |
| Embedded replicas  | ❌                      | ✅             |
| Auto-sync          | ❌                      | ✅             |
| Encryption at rest | ❌                      | ✅             |
| Offline writes     | ❌                      | ✅             |
| WAL mode           | ✅                      | ✅             |
| JSON support       | ✅                      | ✅             |

## Migration from SQLite3

The Turso dialect is designed to be a drop-in replacement for SQLite3:

```javascript
// Before (SQLite3)
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './my-database.db',
});

// After (Turso)
const sequelize = new Sequelize({
  dialect: TursoDialect,
  storage: './my-database.db',
});
```

All your existing models and queries will work without changes!

## Resources

- [Turso Documentation](https://docs.turso.tech)
- [libSQL Documentation](https://docs.turso.tech/libsql)
- [Embedded Replicas Guide](https://docs.turso.tech/features/embedded-replicas)
- [Sequelize Documentation](https://sequelize.org)
