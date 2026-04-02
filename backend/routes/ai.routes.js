const express = require('express');

const { asyncHandler, validate, schemas, ValidationError } = require('../errors');
const { callClaude } = require('../services/ai.service');

function createAiRouter({ auth, aiLimiter, anthropic }) {
  const router = express.Router();

  router.post('/ai/diagnose', auth, aiLimiter, asyncHandler(async (req, res) => {
    validate(req.body, schemas.aiMessage);
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });
    }
    if (messages.length > 20) {
      throw new ValidationError('Validation failed', { messages: 'max 20 messages' });
    }

    const response = await callClaude(anthropic, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are RoadReady AI — a friendly roadside assistance diagnostic expert for motorists in Nairobi, Kenya.
When given a breakdown description: 1) identify likely cause 2) give 1-2 safety steps 3) recommend RoadReady service with price in KES 4) add a reassuring sentence. Max 120 words.`,
      messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
    });
    res.json({ reply: response.content[0].text });
  }));

  return router;
}

module.exports = { createAiRouter };
