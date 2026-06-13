import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const BUCKET = 'chat-files';

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

  const ext = fileName.split('.').pop();
  const path = `${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, 300);

  if (error || !data) {
    throw new AppError('SIGNED_URL_FAILED', 'Could not generate upload URL.', 500);
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