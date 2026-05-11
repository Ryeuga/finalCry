import dotenv from 'dotenv';
dotenv.config();

import { Socket } from "socket.io";
import http from "http";
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { UserManager } from "./managers/UserManger";
import { connectDatabase } from "./config/database";
import { logger } from "./config/logger";
import { getRTCConfiguration } from "./config/webrtc";
import authRoutes from "./routes/auth";

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Omegle clone backend server is running',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// WebRTC configuration endpoint
app.get('/api/rtc-config', async (req, res) => {
  try {
    const response = await fetch("https://grandnet.metered.live/api/v1/turn/credentials?apiKey=9k2m34xeXN4lhvGGv3c0rccdPszGkrcCQHIAj5q1756Tb48F");
    const iceServers = await response.json();
    res.json({ config: { iceServers } });
  } catch (error) {
    logger.error(`Error fetching TURN credentials: ${error}`);
    res.json({ config: getRTCConfiguration() }); // fallback to default/env STUN
  }
});

// Auth routes
app.use('/api/auth', authRoutes);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const userManager = new UserManager();

// Socket.io connection handling
io.on('connection', async (socket: Socket) => {
  logger.info(`User connected: ${socket.id}`);
  
  // Wait for user to send their email, name and interests
  socket.on('join', async ({ email, name, interests }: { email: string, name: string, interests?: string[] }) => {
    if (!email || !name || name.trim().length === 0) {
      socket.emit('error', { message: 'Email and name are required' });
      return;
    }
    
    if (name.length > 50) {
      socket.emit('error', { message: 'Name is too long' });
      return;
    }

    // Check if user is verified
    const User = (await import('./models/User')).default;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user || !user.isVerified) {
      socket.emit('error', { message: 'Please verify your college email first' });
      socket.emit('verification-required', { email });
      return;
    }
    
    await userManager.addUser(name.trim(), email, socket, interests);
    logger.info(`User ${name} (${email}) (${socket.id}) joined`);
  });

  socket.on("disconnect", async () => {
    logger.info(`User disconnected: ${socket.id}`);
    await userManager.removeUser(socket.id);
  });

  socket.on('error', (error) => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
});

// Initialize database connection (non-blocking)
connectDatabase().catch((error) => {
  logger.warn('Database connection failed, continuing without database');
});

// Start server regardless of database connection
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🚀 Server listening on port ${PORT}`);
  logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});