const express = require('express');

const { asyncHandler, validate, schemas, ValidationError } = require('../errors');
const { callClaude } = require('../services/ai.service');

function createAdminRouter({
  auth,
  requireRole,
  aiLimiter,
  anthropic,
  Analytics,
  Jobs,
  Users,
}) {
  const router = express.Router();

  router.get('/analytics/dashboard', auth, requireRole('admin'), asyncHandler(async (_req, res) => {
    const data = await Analytics.dashboard();
    res.json(data);
  }));

  router.post('/ai/dispatch', auth, requireRole('admin'), aiLimiter, asyncHandler(async (req, res) => {
    validate(req.body, schemas.aiMessage);
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });
    }

    const [activeJobs, availableProviders] = await Promise.all([
      Jobs.listAll({ status: 'searching' }),
      Users.listProviders().then(ps => ps.filter(p => p.status === 'available')),
    ]);

    const response = await callClaude(anthropic, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are RoadReady AI Dispatch. Live data: ${JSON.stringify({ activeJobs, availableProviders, timestamp: new Date().toISOString() })}. Be concise and actionable.`,
      messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
    });
    res.json({ reply: response.content[0].text });
  }));

  return router;
}

module.exports = { createAdminRouter };
const router = express.Router();
const { asyncHandler } = require('../errors');
const { Analytics } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');

router.get('/dashboard', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const data = await Analytics.dashboard();
  res.json(data);
}));

module.exports = router;
