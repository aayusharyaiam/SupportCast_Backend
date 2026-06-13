import { authService } from '../services/auth.service.js';
import { successResponse } from '../utils/response.js';

const login = async (req, res) => {
  const result = await authService.login(req.validated.body);
  successResponse(res, result);
};

const logout = async (req, res) => {
  const token = req.headers.authorization.slice('Bearer '.length);
  await authService.logout(token);
  successResponse(res, { loggedOut: true });
};

export const authController = {
  login,
  logout
};
