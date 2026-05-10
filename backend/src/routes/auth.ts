import express from 'express';
import mongoose from 'mongoose';
import { isCollegeEmail, extractCollegeName } from '../utils/emailValidator';
import User from '../models/User';
import { logger } from '../config/logger';

const router = express.Router();

/**
 * POST /api/auth/verify-email
 * Verify email domain and create/update user (no code verification)
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate college email domain
    if (!isCollegeEmail(email)) {
      return res.status(400).json({ 
        error: 'Please use a valid college email address (.edu, .edu.in, .ac.uk, .ac.in, etc.)' 
      });
    }

    // Extract college name
    const collegeName = extractCollegeName(email);

    // Create or update user (automatically verified if college email domain is valid)
    let user;
    try {
      // Check if mongoose is connected
      if (mongoose.connection.readyState === 1) {
        user = await User.findOneAndUpdate(
          { email: email.toLowerCase() },
          {
            email: email.toLowerCase(),
            name: name.trim(),
            college: collegeName,
            isVerified: true, // Auto-verify if college email domain is valid
            lastActive: new Date(),
          },
          { upsert: true, new: true }
        );
      } else {
        // Database not connected, create in-memory user
        logger.warn('Database not connected, using in-memory user');
        user = {
          email: email.toLowerCase(),
          name: name.trim(),
          college: collegeName,
          isVerified: true,
        };
      }
    } catch (dbError) {
      // If database operation fails, create a temporary user object
      logger.warn('Database operation failed, using in-memory user:', dbError);
      user = {
        email: email.toLowerCase(),
        name: name.trim(),
        college: collegeName,
        isVerified: true,
      };
    }

    logger.info(`User verified for ${email} (college email domain validated)`);

    res.json({
      message: 'Email verified successfully',
      user: {
        email: user.email,
        name: user.name,
        college: user.college,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    logger.error('Error verifying email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/check-email
 * Check if email is already verified
 */
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.json({ verified: false });
    }

    res.json({
      verified: user.isVerified,
      name: user.name,
      college: user.college,
    });
  } catch (error) {
    logger.error('Error checking email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/friends
 * Get user friends and requests
 */
router.get('/friends', async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const friends = await User.find({ email: { $in: user.friends || [] } })
                              .select('name email college isVerified');
                              
    const requests = await User.find({ email: { $in: user.friendRequests || [] } })
                               .select('name email college isVerified');

    res.json({ friends, requests });
  } catch (error) {
    logger.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

