/**
 * RoadReady — Photo Upload Route (Cloudinary)
 *
 * Cloudinary is easier than S3 for this use case:
 *   - Free tier: 25GB storage, 25GB bandwidth/month
 *   - No AWS account, no IAM, no bucket policies
 *   - Auto-optimises images (resize, compress, format)
 *   - Signed uploads — server controls what gets uploaded
 *
 * Setup:
 *   1. Create account at cloudinary.com (free)
 *   2. Copy Cloud Name, API Key, API Secret from dashboard
 *   3. Add to .env (see .env.example)
 *
 * Install: npm install cloudinary multer multer-storage-cloudinary
 *
 * Flow:
 *   Mobile app → POST /api/uploads/sign   → gets signed upload params
 *   Mobile app → POST to Cloudinary CDN   → image stored directly
 *   Mobile app → POST /api/uploads/confirm → saves URL to database
 *
 * This two-step flow means the image goes directly to Cloudinary,
 * never through our server — keeps memory usage low and uploads fast.
 */

const express    = require('express');
const router     = express.Router();
const cloudinary = require('cloudinary').v2;
const crypto     = require('crypto');
const { query }  = require('../db/pool');
const {
  asyncHandler, ValidationError, ExternalServiceError, ForbiddenError, AuthError,
} = require('../errors');

// ─── Cloudinary config ────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

function cloudinaryConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// ─── Allowed upload types ──────────────────────────────────────────────────────

const UPLOAD_TYPES = {
  id_doc:        { folder: 'roadready/provider-ids',       maxSizeMb: 5,  formats: ['jpg','jpeg','png','pdf'] },
  equipment:     { folder: 'roadready/provider-equipment', maxSizeMb: 5,  formats: ['jpg','jpeg','png'] },
  avatar:        { folder: 'roadready/avatars',            maxSizeMb: 2,  formats: ['jpg','jpeg','png'] },
  job_evidence:  { folder: 'roadready/job-evidence',       maxSizeMb: 10, formats: ['jpg','jpeg','png'] },
};

// ─── POST /api/uploads/sign ────────────────────────────────────────────────────
// Step 1: Get a signed upload preset so the client can POST directly to Cloudinary.
// This prevents unauthorized uploads to our Cloudinary account.

router.post('/sign', asyncHandler(async (req, res) => {
  if (!cloudinaryConfigured()) {
    // Dev fallback — return a mock response so the UI doesn't break
    return res.json({
      signature:    'dev-mock-signature',
      timestamp:    Math.floor(Date.now() / 1000),
      cloudName:    'dev-cloud',
      apiKey:       'dev-key',
      folder:       'roadready/dev',
      uploadPreset: null,
      mock:         true,
    });
  }

  const { uploadType } = req.body;
  if (!uploadType || !UPLOAD_TYPES[uploadType]) {
    throw new ValidationError('Validation failed', { uploadType: `must be one of: ${Object.keys(UPLOAD_TYPES).join(', ')}` });
  }

  const config    = UPLOAD_TYPES[uploadType];
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId  = `${req.user.id}_${Date.now()}`;
  const folder    = config.folder;

  // Parameters that get included in the signature
  const paramsToSign = {
    folder,
    public_id:  publicId,
    timestamp,
    // Restrict to allowed formats
    allowed_formats: config.formats.join(','),
    // Auto-resize large images to save storage
    eager: uploadType === 'avatar' ? 'c_fill,w_200,h_200,q_auto' : 'q_auto',
    // Max file size in bytes
    max_file_size: config.maxSizeMb * 1024 * 1024,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

  res.json({
    signature,
    timestamp,
    cloudName:  process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:     process.env.CLOUDINARY_API_KEY,
    folder,
    publicId,
    allowedFormats: config.formats,
    maxSizeMb:  config.maxSizeMb,
  });
}));

// ─── POST /api/uploads/confirm ────────────────────────────────────────────────
// Step 2: After Cloudinary confirms the upload, tell our server the URL
// so we can store it in the database.

router.post('/confirm', asyncHandler(async (req, res) => {
  const { uploadType, publicId, secureUrl } = req.body;

  if (!uploadType || !publicId || !secureUrl) {
    throw new ValidationError('Validation failed', {
      uploadType: uploadType ? undefined : 'required',
      publicId:   publicId  ? undefined : 'required',
      secureUrl:  secureUrl ? undefined : 'required',
    });
  }

  // Verify the URL actually belongs to our Cloudinary account
  const expectedDomain = `res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`;
  if (cloudinaryConfigured() && !secureUrl.includes(expectedDomain)) {
    throw new ForbiddenError('Invalid upload URL — must be from our Cloudinary account');
  }

  // Save the URL based on upload type
  switch (uploadType) {
    case 'id_doc':
      await query('UPDATE provider_profiles SET id_doc_url = $1, updated_at = NOW() WHERE user_id = $2', [secureUrl, req.user.id]);
      break;
    case 'equipment':
      await query('UPDATE provider_profiles SET equipment_doc_url = $1, updated_at = NOW() WHERE user_id = $2', [secureUrl, req.user.id]);
      break;
    case 'avatar':
      await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [secureUrl, req.user.id]);
      break;
    case 'job_evidence':
      // For job evidence — store on the job record
      if (!req.body.jobId) throw new ValidationError('Validation failed', { jobId: 'required for job_evidence uploads' });
      await query('UPDATE jobs SET evidence_url = $1 WHERE id = $2 AND (motorist_id = $3 OR provider_id = $3)', [secureUrl, req.body.jobId, req.user.id]);
      break;
    default:
      throw new ValidationError('Validation failed', { uploadType: 'unknown upload type' });
  }

  // Check if provider onboarding can be auto-advanced
  if (['id_doc', 'equipment'].includes(uploadType)) {
    const { rows } = await query('SELECT id_doc_url, equipment_doc_url FROM provider_profiles WHERE user_id = $1', [req.user.id]);
    const profile = rows[0];
    if (profile?.id_doc_url && profile?.equipment_doc_url) {
      // Both docs submitted — advance to pending review
      await query(`UPDATE provider_profiles SET onboard_status = 'in_progress', updated_at = NOW() WHERE user_id = $1 AND onboard_status = 'pending'`, [req.user.id]);
    }
  }

  res.json({ ok: true, url: secureUrl, uploadType });
}));

// ─── DELETE /api/uploads/:publicId ────────────────────────────────────────────
// Allow users to delete their own uploads (e.g. re-upload ID photo)

router.delete('/:publicId', asyncHandler(async (req, res) => {
  if (!cloudinaryConfigured()) return res.json({ ok: true, mock: true });

  const { publicId } = req.params;
  // Verify the publicId belongs to this user (contains their user ID)
  if (!publicId.startsWith(req.user.id)) {
    throw new ForbiddenError('You can only delete your own uploads');
  }

  await cloudinary.uploader.destroy(publicId);
  res.json({ ok: true });
}));

module.exports = router;
