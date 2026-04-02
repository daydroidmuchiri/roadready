const { initiateSTKPush, parseCallback } = require('../mpesa');
const { initiateB2CPayout, parseB2CResult, isB2CConfigured } = require('../mpesa_b2c');

module.exports = {
  initiateStkPush: initiateSTKPush,
  processCallback: parseCallback,
  initiateB2CPayout,
  processB2CResult: parseB2CResult,
  isB2CConfigured
};
