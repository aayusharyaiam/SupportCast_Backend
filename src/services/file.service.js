import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const BUCKET = 'chat-files';
let bucketVerified = false;

const ensureBucket = async () => {
  if (bucketVerified) return;

  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === BUCKET);

    if (!exists) {
      const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/*', 'application/pdf', 'text/*'],
      });

      if (error) {
        logger.error({ event: 'bucket_create_failed', bucket: BUCKET, error: error.message });
        throw new AppError('BUCKET_SETUP_FAILED', `Failed to create storage bucket: ${error.message}`, 500);
      }
      logger.info({ event: 'bucket_created', bucket: BUCKET });
    }

    bucketVerified = true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ event: 'bucket_check_failed', bucket: BUCKET, error: err.message });
  }
};

const getSignedUploadUrl = async ({ sessionId, fileName, fileType, fileSize }) => {
  const maxSize = 10 * 1024 * 1024;
  if (fileSize > maxSize) {
    throw new AppError('FILE_TOO_LARGE', 'File must be 10 MB or smaller.', 400);
  }

  const allowedTypes = ['image/', 'application/pdf', 'text/'];
  const isAllowed = allowedTypes.some(t => fileType.startsWith(t) || fileType === t);
  if (!isAllowed) {
    throw new AppError('INVALID_FILE_TYPE', 'File type not allowed. Upload images, PDFs, or text files.', 400);
  }

  await ensureBucket();

  const ext = fileName.split('.').pop();
  const path = `${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, 300);

  if (error || !data) {
    logger.error({ event: 'signed_url_failed', bucket: BUCKET, path, error: error?.message });
    throw new AppError('SIGNED_URL_FAILED', `Could not generate upload URL: ${error?.message || 'Unknown error'}`, 500);
  }

  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  return {
    uploadUrl: data.signedUrl,
    publicUrl,
    path,
    fileName,
    fileSize,
    fileType
  };
};

export const fileService = {
  getSignedUploadUrl
};