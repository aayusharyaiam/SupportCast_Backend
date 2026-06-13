import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export const authenticate = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('NO_TOKEN', 'Authentication token is required.', 401);
    }

    const token = authHeader.slice('Bearer '.length);
    const customer = verifyCustomerToken(token);

    if (customer) {
      req.user = customer;
      return next();
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      throw new AppError('INVALID_TOKEN', 'Authentication token is invalid or expired.', 401);
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.role || 'agent',
      type: 'agent'
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

export const verifySocketToken = async (token) => {
  if (!token) {
    throw new AppError('AUTH_REQUIRED', 'Socket authentication token is required.', 401);
  }

  const customer = verifyCustomerToken(token);
  if (customer) {
    return customer;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw new AppError('INVALID_TOKEN', 'Socket authentication token is invalid.', 401);
  }

  return {
    id: data.user.id,
    email: data.user.email,
    displayName: data.user.user_metadata?.display_name || data.user.user_metadata?.displayName || null,
    role: data.user.user_metadata?.role || 'agent',
    type: 'agent'
  };
};

const verifyCustomerToken = (token) => {
  try {
    const decoded = jwt.verify(token, env.CUSTOMER_JWT_SECRET);
    if (decoded.type !== 'customer') {
      return null;
    }

    return {
      id: decoded.sub,
      role: 'customer',
      type: 'customer',
      sessionId: decoded.sessionId,
      displayName: decoded.displayName
    };
  } catch {
    return null;
  }
};
