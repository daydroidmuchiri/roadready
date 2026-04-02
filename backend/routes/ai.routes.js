const express = require('express');
const router = express.Router();
const { asyncHandler, validate, schemas, ValidationError } = require('../errors');
const { Users, Jobs } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');
const { callClaude } = require('../services/ai.service');
const { aiLimiter } = require('../middleware/rateLimiter.middleware');

router.post('/diagnose', auth, aiLimiter, asyncHandler(async (req, res) => {
  validate(req.body, schemas.aiMessage);
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });
  if (messages.length > 20)
    throw new ValidationError('Validation failed', { messages: 'max 20 messages' });

  const response = await callClaude({
    model: 'claude-sonnet-4-20250514', max_tokens: 400,
    system: `You are RoadReady AI — a friendly roadside assistance diagnostic expert for motorists in Nairobi, Kenya.
When given a breakdown description: 1) identify likely cause 2) give 1-2 safety steps 3) recommend RoadReady service with price in KES 4) add a reassuring sentence. Max 120 words.`,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
  });
  res.json({ reply: response.content[0].text });
}));

router.post('/dispatch', auth, requireRole('admin'), aiLimiter, asyncHandler(async (req, res) => {
  validate(req.body, schemas.aiMessage);
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });

  const [activeJobs, availableProviders] = await Promise.all([
    Jobs.listAll({ status: 'searching' }),
    Users.listProviders().then(ps => ps.filter(p => p.status === 'available')),
  ]);

  const response = await callClaude({
    model: 'claude-sonnet-4-20250514', max_tokens: 600,
    system: `You are RoadReady AI Dispatch. Live data: ${JSON.stringify({ activeJobs, availableProviders, timestamp: new Date().toISOString() })}. Be concise and actionable.`,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
  });
  res.json({ reply: response.content[0].text });
}));

module.exports = router;
