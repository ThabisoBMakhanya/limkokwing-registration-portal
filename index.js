'use strict';
// Vercel's Express adapter uses this root entry for every API route.
require('express');
module.exports = require('./server/app');
