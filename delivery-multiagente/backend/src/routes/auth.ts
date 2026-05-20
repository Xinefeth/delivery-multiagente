import { Router } from 'express';
import { loginUser } from '../services/authService';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const result = await loginUser(email, password);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
