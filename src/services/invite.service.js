import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';

const generateCustomerToken = ({ sessionId, displayName }) => {
  const customerId = uuidv4();

  return {
    customerId,
    token: jwt.sign(
      {
        type: 'customer',
        role: 'customer',
        sessionId,
        displayName
      },
      env.CUSTOMER_JWT_SECRET,
      {
        subject: customerId,
        expiresIn: env.CUSTOMER_JWT_EXPIRES_IN
      }
    )
  };
};

export const inviteService = {
  generateCustomerToken
};
