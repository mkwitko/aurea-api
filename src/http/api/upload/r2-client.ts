import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../../../config/env.js';

let _r2: S3Client | null = null;

export function getR2Client(): S3Client {
  if (_r2) return _r2;

  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured');
  }

  _r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  return _r2;
}
