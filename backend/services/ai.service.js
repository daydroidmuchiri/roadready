const { ExternalServiceError } = require('../errors');

async function callClaude(anthropic, params) {
  try {
    return await anthropic.messages.create(params);
  } catch (err) {
    if (err.status === 529 || err.status === 503) {
      throw new ExternalServiceError('AI', 'temporarily overloaded — try again shortly');
    }
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { ExternalServiceError } = require('../errors');

async function callClaude(params) {
  try {
    return await anthropic.messages.create(params);
  } catch (err) {
    if (err.status === 529 || err.status === 503)
      throw new ExternalServiceError('AI', 'temporarily overloaded — try again shortly');
    if (err.status === 401) throw new ExternalServiceError('AI', 'authentication failed');
    if (err.status === 429) throw new ExternalServiceError('AI', 'quota exceeded');
    throw new ExternalServiceError('AI', err.message || 'unknown error');
  }
}

module.exports = { callClaude };
