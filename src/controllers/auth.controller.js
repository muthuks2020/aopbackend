const AuthService = require('../services/auth.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const AuthController = {
  async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const deviceInfo = req.headers['user-agent'] || null;
      const ipAddress = req.ip;

      const result = await AuthService.login(username, password, deviceInfo, ipAddress);


      if (req.logAudit) {
        req.logAudit({ action: 'login', entityType: 'auth_users', entityId: result.user.id });
      }

      res.json(successResponse({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      }, 'Login successful.'));
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async logout(req, res, next) {
    try {

      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(token);
        if (decoded?.jti) {
          await AuthService.logout(decoded.jti);
        }
      }

      if (req.logAudit) {
        req.logAudit({ action: 'logout', entityType: 'auth_users', entityId: req.user?.id });
      }

      res.json(successResponse({}, 'Logged out successfully.'));
    } catch (err) {
      next(err);
    }
  },

  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refresh(refreshToken);
      res.json(successResponse(result, 'Token refreshed.'));
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },

  async me(req, res, next) {
    try {
      const profile = await AuthService.getProfile(req.user.id);
      res.json(successResponse({ user: profile }));
    } catch (err) {
      if (err.status) return res.status(err.status).json(errorResponse(err.message));
      next(err);
    }
  },
};

module.exports = AuthController;
