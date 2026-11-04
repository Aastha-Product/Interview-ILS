import { testDatabaseUrl } from "./test-db-url";

// Every integration test talks to the test database, never the dev one.
process.env.DATABASE_URL = testDatabaseUrl();
