// Imported first by the demo-site integration test: configure a demo site before core reads config.
process.env.APP_ENV = "demo";
process.env.DEMO_PASSWORD = "demo-password-for-tests";
process.env.STORAGE_DRIVER = "database";
