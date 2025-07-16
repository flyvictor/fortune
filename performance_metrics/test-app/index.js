/*global require */
const fortuneFactory = require('./fortune-factory');
const express = require('express');

const expressApp = express();

const app = fortuneFactory.createFortune(expressApp);

// Configuration
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));

fortuneFactory.addRoutes(app);

//Start server
app.listen(4000, function () {
  console.log('Express server listening on port %d...', this.address().port);
});
