const express = require('express');

const { query } = require('../db/pool');
const { asyncHandler } = require('../errors');
const { parseB2CResult } = require('../mpesa_b2c');

function createPayoutCallbackRouter() {
  const router = express.Router();

  router.post('/payouts/mpesa/result', asyncHandler(async (req, res) => {
    const parsed = parseB2CResult(req.body);
    if (!parsed) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    console.log(JSON.stringify({
      level: 'INFO',
      event: 'b2c_callback',
      conversationId: parsed.conversationId,
      success: parsed.success,
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
    }));

    if (parsed.success) {
      await query(
        `UPDATE payouts
         SET status = 'completed', mpesa_receipt = $1, completed_at = NOW()
         WHERE b2c_conversation_id = $2`,
        [parsed.transactionId, parsed.conversationId],
      );
    } else {
      await query(
        `UPDATE payouts
         SET status = 'failed', failure_reason = $1
         WHERE b2c_conversation_id = $2`,
        [parsed.resultDesc, parsed.conversationId],
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }));

  router.post('/payouts/mpesa/timeout', asyncHandler(async (req, res) => {
    const result = req.body?.Result;
    if (result?.ConversationID) {
      await query(
        `UPDATE payouts
         SET status = 'failed', failure_reason = 'M-Pesa B2C request timed out'
         WHERE b2c_conversation_id = $1`,
        [result.ConversationID],
      );
      console.warn(JSON.stringify({
        level: 'WARN',
        event: 'b2c_timeout',
        conversationId: result.ConversationID,
      }));
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }));

  return router;
}

module.exports = { createPayoutCallbackRouter };
