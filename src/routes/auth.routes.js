const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const { validateBody } = require('../middleware/validate');
const { loginSchema, refreshTokenSchema } = require('../validators/schemas');

router.post('/login', validateBody(loginSchema), AuthController.login);
router.post('/logout', authenticate, AuthController.logout);
router.post('/refresh', validateBody(refreshTokenSchema), AuthController.refresh);
router.get('/me', authenticate, AuthController.me);

module.exports = router;
