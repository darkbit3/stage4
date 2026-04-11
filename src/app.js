const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const http = require('http');
const socketIo = require('socket.io');
const ioClient = require('socket.io-client');
require('dotenv').config();

// Import gRPC client
const Stage4GrpcClient = require('./grpc/database-client');

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Service URLs
const BIGSERVER_URL = process.env.BIGSERVER_URL || `http://localhost:${process.env.BIGSERVER_PORT || 3000}`;
const DB_MANAGER_LOCAL_URL = `http://localhost:${process.env.DB_MANAGER_PORT || 3007}`;
const DB_MANAGER_REMOTE_URL = process.env.DB_MANAGER_URL || 'https://db-manager-1.onrender.com';
let dbManagerUrl = DB_MANAGER_LOCAL_URL;
let dbManagerFallbackUsed = false;

// Service configuration
const services = {
  bigserver: { url: BIGSERVER_URL, name: 'Big Server', connected: false },
  db_manager: { url: dbManagerUrl, name: 'DB Manager', connected: false, fallbackUsed: false }
};

// Socket.IO client for real-time connection to DB Manager
let dbManagerSocket = null;
let socketConnected = false;

// Simple in-memory cache for game data to reduce DB Manager load
const gameDataCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

const getCachedGameData = (stage) => {
  const cached = gameDataCache.get(stage);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`📋 Stage4: Using cached game data for Stage ${stage.toUpperCase()}`);
    return cached.data;
  }
  return null;
};

const setCachedGameData = (stage, data) => {
  gameDataCache.set(stage, {
    data,
    timestamp: Date.now()
  });
};

// Connection status variables - DEFINED BEFORE USE
let bigserverConnected = false;
let dbManagerConnected = false;

// Initialize gRPC client for high-performance real-time communication
const grpcClient = new Stage4GrpcClient();

// Helper function to extract port from URL
const getPortFromUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  } catch (error) {
    return 'unknown';
  }
};

// Enhanced service connection checking with retry logic
const checkServiceConnections = async () => {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  const checkWithRetry = async (serviceName, url, headers = {}, retries = maxRetries) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { timeout: 5000, headers });
        if (response.status === 200) {
          return { success: true, data: response.data };
        }
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        console.log(`⚠️  ${serviceName} connection attempt ${i + 1} failed, retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  };

  try {
    // Check BigServer connection with API key
    try {
      const bigserverResult = await checkWithRetry(
        'BigServer',
        BIGSERVER_URL,
        { 'x-api-key': process.env.BIGSERVER_API_KEY }
      );

      services.bigserver.connected = true;
      bigserverConnected = true;
      console.log('✅ Connected to Big Server with API key');
      console.log('   📊 Big Server Status:', bigserverResult.data.status);
      logger.info(`✅ Big Server is connected`);

    } catch (error) {
      services.bigserver.connected = false;
      bigserverConnected = false;
      console.log('❌ Failed to connect to Big Server:', error.message);
      if (error.response && error.response.status === 401) {
        console.log('🔑 API Key authentication failed - check your API key configuration');
      }
      logger.warn(`❌ Big Server connection error: ${error.message}`);
    }

    // Check DB Manager connection
    const tryDbManager = async (url) => {
      const result = await checkWithRetry('DB Manager', url);
      dbManagerUrl = url;
      services.db_manager.url = url;
      services.db_manager.connected = true;
      services.db_manager.fallbackUsed = url !== DB_MANAGER_LOCAL_URL;
      dbManagerFallbackUsed = services.db_manager.fallbackUsed;
      return result;
    };

    try {
      try {
        const dbManagerResult = await tryDbManager(DB_MANAGER_LOCAL_URL);
        console.log('✅ Connected to local DB Manager on port ' + process.env.DB_MANAGER_PORT || 3007);
        console.log('   📊 DB Manager Status:', dbManagerResult.data.status);
        console.log('   🗄️  Database Status:', dbManagerResult.data.databases?.sqlite?.status || 'Unknown');
        logger.info(`✅ DB Manager is connected locally`);
      } catch (localError) {
        console.warn('⚠️ Local DB Manager failed, switching to remote DB Manager URL:', DB_MANAGER_REMOTE_URL);
        logger.warn(`⚠️ Local DB Manager connection failed, switching to fallback URL ${DB_MANAGER_REMOTE_URL}`);
        const dbManagerResult = await tryDbManager(DB_MANAGER_REMOTE_URL);
        console.log('✅ Connected to DB Manager via remote fallback');
        console.log('   📊 DB Manager Status:', dbManagerResult.data.status);
        console.log('   🗄️  Database Status:', dbManagerResult.data.databases?.sqlite?.status || 'Unknown');
        logger.info(`✅ DB Manager connected via remote fallback URL ${DB_MANAGER_REMOTE_URL}`);
      }
    } catch (error) {
      services.db_manager.connected = false;
      dbManagerConnected = false;
      console.log('❌ Failed to connect to DB Manager:', error.message);
      logger.warn(`❌ DB Manager connection error: ${error.message}`);
    }

    // Enhanced connection summary
    const connectionStatus = {
      bigserver: services.bigserver.connected ? 'connected' : 'disconnected',
      db_manager: services.db_manager.connected ? 'connected' : 'disconnected',
      overall: (services.bigserver.connected && services.db_manager.connected) ? 'healthy' : 'degraded'
    };

    console.log('📊 Connection Status Summary:', connectionStatus);

  } catch (error) {
    console.error('Error checking service connections:', error.message);
    logger.error('Error checking service connections:', error.message);
  }
};

// Initialize Socket.IO connection to DB Manager
const initializeSocketConnection = () => {
  if (dbManagerSocket) {
    dbManagerSocket.disconnect();
  }

  console.log('🔌 Connecting to DB Manager via Socket.IO...');
  logger.info('🔌 Connecting to DB Manager via Socket.IO...');

  dbManagerSocket = ioClient(dbManagerUrl, {
    transports: ['websocket', 'polling'],
    timeout: 5000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  dbManagerSocket.on('connect', () => {
    console.log('✅ Connected to DB Manager via Socket.IO');
    logger.info('✅ Connected to DB Manager via Socket.IO');
    socketConnected = true;

    // Identify as stage4
    dbManagerSocket.emit('stage4-connect', {
      stage: 'stage4',
      timestamp: new Date().toISOString(),
      port: process.env.PORT
    });
  });

  dbManagerSocket.on('db-manager-connected', (data) => {
    console.log('🎯 DB Manager acknowledged connection:', data);
    logger.info('🎯 DB Manager acknowledged connection:', data);
  });

  dbManagerSocket.on('game-data-update', (data) => {
    console.log('📊 Real-time game data update received:', data);
    logger.info('📊 Real-time game data update received:', data);
    // Handle real-time game data updates
    // This can be used to cache data or notify connected clients
  });

  dbManagerSocket.on('bet-update', (data) => {
    console.log('🎯 Real-time bet update received:', data);
    logger.info('🎯 Real-time bet update received:', data);
    // Handle real-time bet notifications
  });

  dbManagerSocket.on('db-status-update', (data) => {
    console.log('🗄️ Real-time DB status update:', data);
    logger.info('🗄️ Real-time DB status update:', data);
  });

  dbManagerSocket.on('connect_error', (error) => {
    console.log('❌ Socket.IO connection error:', error.message);
    logger.warn('❌ Socket.IO connection error:', error.message);
    socketConnected = false;

    if (!dbManagerFallbackUsed && dbManagerUrl === DB_MANAGER_LOCAL_URL) {
      console.warn('⚠️ Local WebSocket failed, switching to remote DB Manager URL and retrying...');
      dbManagerUrl = DB_MANAGER_REMOTE_URL;
      services.db_manager.url = DB_MANAGER_REMOTE_URL;
      dbManagerFallbackUsed = true;
      services.db_manager.fallbackUsed = true;
      dbManagerSocket.disconnect();
      initializeSocketConnection();
    }
  });

  dbManagerSocket.on('disconnect', (reason) => {
    console.log('🔌 Disconnected from DB Manager:', reason);
    logger.info('🔌 Disconnected from DB Manager:', reason);
    socketConnected = false;
  });

  dbManagerSocket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Reconnected to DB Manager after ${attemptNumber} attempts`);
    logger.info(`🔄 Reconnected to DB Manager after ${attemptNumber} attempts`);
    socketConnected = true;
  });
};

// Request real-time game data
const requestRealtimeGameData = async (stage = 'h') => {
  if (dbManagerSocket && socketConnected) {
    console.log(`📊 Requesting real-time game data for Stage ${stage.toUpperCase()}`);
    logger.info(`📊 Requesting real-time game data for Stage ${stage.toUpperCase()}`);
    dbManagerSocket.emit('request-game-data', { stage });
    return;
  }

  if (services.db_manager.connected) {
    try {
      console.warn('⚠️ Socket not connected, using HTTP fallback for real-time game data');
      const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/last-game-id`, {
        timeout: 10000
      });

      if (response.data && response.data.success) {
        console.log(`✅ HTTP fallback game data received for Stage ${stage.toUpperCase()}`);
        io.emit('game-data-update', {
          stage: stage.toUpperCase(),
          data: response.data.data,
          timestamp: new Date().toISOString(),
          source: 'db_manager_http_fallback'
        });
      } else {
        console.warn('⚠️ HTTP fallback game data request returned invalid response');
      }
    } catch (error) {
      console.error('❌ HTTP fallback failed for real-time game data:', error.message);
    }
    return;
  }

  console.log('⚠️ No DB Manager connection available for real-time game data');
};

// Send bet placement notification
const notifyBetPlaced = (betData) => {
  if (dbManagerSocket && socketConnected) {
    console.log('🎯 Sending bet placement notification via Socket.IO');
    logger.info('🎯 Sending bet placement notification via Socket.IO');
    dbManagerSocket.emit('bet-placed', betData);
  } else {
    console.log('⚠️ Socket not connected, bet notification not sent');
    logger.warn('⚠️ Socket not connected, bet notification not sent');
  }
};

// Helper function for retrying DB Manager requests with exponential backoff
const retryDbRequest = async (requestFn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;

      if (error.response?.status === 429) {
        // Rate limited - wait longer
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
        console.log(`⏳ DB Manager rate limited (429), retrying in ${Math.round(delay/1000)}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (error.response?.status >= 500) {
        // Server error - retry with shorter delay
        const delay = baseDelay * Math.pow(1.5, attempt);
        console.log(`⏳ DB Manager server error (${error.response.status}), retrying in ${Math.round(delay/1000)}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error
        throw error;
      }
    }
  }

  throw lastError;
};

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.options('*', cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,x-api-key');
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 1000
});
app.use(limiter);

app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
const apiPrefix = '/api/v1';
app.use(`${apiPrefix}/games`, require('./routes/gameRoutes'));
app.use(`${apiPrefix}/numbers`, require('./routes/numberRoutes'));

// Get latest game data with highest game ID and parsed selectedBoard
app.get(`${apiPrefix}/game/latest-data`, async (req, res) => {
  try {
    const { stage = 'i' } = req.query; // Default to stage I

    // Check cache first
    const cachedData = getCachedGameData(stage);
    if (cachedData) {
      console.log(`✅ Stage4: Returning cached game data for Stage ${stage.toUpperCase()}`);
      return res.json({
        success: true,
        data: cachedData,
        source: 'cache',
        stage: 'stage4',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔍 Stage4: Requesting latest game data via gRPC for Stage ${stage.toUpperCase()}...`);

    // Try gRPC first for high-performance real-time data
    const grpcResult = await grpcClient.getGameDataWithFallback(stage);
    
    if (grpcResult.success) {
      const gameData = grpcResult.data;
      console.log(`✅ Stage4: gRPC game data retrieved for Stage ${stage.toUpperCase()}:`, gameData);

      // Check if it's fallback data (no real game)
      if (gameData.gameId && gameData.gameId.startsWith('FALLBACK')) {
        console.log(`🔄 Stage4: Fallback data detected, creating new empty game for Stage ${stage.toUpperCase()}`);
        const newGameData = await createNewGameForStage(stage.toLowerCase());
        
        // Format response for frontend
        const formattedResponse = {
          gameId: newGameData.gameId,
          payout: newGameData.payout,
          players: newGameData.players,
          boards: newGameData.boards,
          totalPlayers: newGameData.totalPlayers,
          stage: newGameData.stage,
          timestamp: newGameData.timestamp
        };

        // Cache the formatted response
        setCachedGameData(stage, formattedResponse);

        console.log(`✅ Stage4: Returning new empty game data for frontend:`, formattedResponse);

        return res.json({
          success: true,
          data: formattedResponse,
          source: 'fallback_created',
          stage: 'stage4',
          timestamp: new Date().toISOString()
        });
      }

      // Parse selectedBoard format: "+251909090909:2,+251909090910:4"
      const parsedData = parseSelectedBoard(gameData.selectedBoard || '');

      // Format response for frontend
      const formattedResponse = {
        gameId: gameData.gameId || '',
        payout: gameData.payout || 0,
        players: parsedData.playerIds,
        boards: parsedData.boards,
        totalPlayers: parsedData.totalPlayers,
        stage: stage.toUpperCase(),
        timestamp: new Date().toISOString()
      };

      // Cache the formatted response
      setCachedGameData(stage, formattedResponse);

      console.log(`✅ Stage4: Returning gRPC game data for frontend:`, formattedResponse);

      res.json({
        success: true,
        data: formattedResponse,
        source: grpcResult.source,
        stage: 'stage4',
        timestamp: new Date().toISOString()
      });
    } else {
      // gRPC failed, return error response
      console.log(`❌ Stage4: Both gRPC and fallback failed for Stage ${stage.toUpperCase()}: ${grpcResult.message}`);
      
      res.json({
        success: false,
        data: null,
        source: grpcResult.source,
        stage: 'stage4',
        message: grpcResult.message,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Stage4: Error getting latest game data:', error.message || error);
    
    res.json({
      success: false,
      data: null,
      source: 'stage4_error',
      stage: 'stage4',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to parse selectedBoard format
function parseSelectedBoard(selectedBoard) {
  try {
    if (!selectedBoard || typeof selectedBoard !== 'string') {
      return {
        playerIds: '',
        boards: '',
        totalPlayers: 0
      };
    }

    console.log('🔍 Stage4: Parsing selectedBoard:', selectedBoard);

    // Split by comma to get individual player:board pairs
    const pairs = selectedBoard.split(',');

    const playerIds = [];
    const boards = [];

    pairs.forEach(pair => {
      if (pair && pair.includes(':')) {
        const parts = pair.split(':');
        if (parts.length >= 2) {
          // Player ID is the first part, board number is the last part
          const playerId = parts[0].trim();
          const boardNum = parts[parts.length - 1].trim();

          if (playerId && boardNum) {
            playerIds.push(playerId);
            boards.push(boardNum);
            console.log(`✅ Stage4: Parsed: ${playerId} → Board ${boardNum}`);
          }
        }
      }
    });

    const result = {
      playerIds: playerIds.join(','),
      boards: boards.join(','),
      totalPlayers: playerIds.length
    };

    console.log('✅ Stage4: Parse result:', result);
    return result;
  } catch (error) {
    console.error('❌ Stage4: Error parsing selectedBoard:', error.message);
    return {
      playerIds: '',
      boards: '',
      totalPlayers: 0
    };
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stage 4 Backend API is running!',
    stage: 'Stage 4',
    port: process.env.PORT,
    connections: {
      bigserver: bigserverConnected,
      db_manager: dbManagerConnected
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    stage: 'Stage 4',
    port: process.env.PORT,
    connections: {
      bigserver: bigserverConnected,
      db_manager: {
        connected: dbManagerConnected,
        realtime: {
          socketConnected: socketConnected,
          socketId: dbManagerSocket ? dbManagerSocket.id : null
        }
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Service status endpoint
app.get('/services', (req, res) => {
  res.json({
    stage: 'Stage 4',
    services: {
      bigserver: {
        url: BIGSERVER_URL,
        connected: bigserverConnected,
        port: process.env.BIGSERVER_PORT
      },
      db_manager: {
        url: dbManagerUrl,
        connected: dbManagerConnected,
        port: process.env.DB_MANAGER_PORT,
        fallbackUsed: dbManagerFallbackUsed
      }
    }
  });
});

// Real-time connection test endpoint
app.get('/api/v1/realtime/status', (req, res) => {
  res.json({
    success: true,
    realtime: {
      socketConnected: socketConnected,
      socketId: dbManagerSocket ? dbManagerSocket.id : null,
      dbManagerUrl: dbManagerUrl,
      fallbackUsed: dbManagerFallbackUsed
    },
    timestamp: new Date().toISOString()
  });
});

// Request real-time game data endpoint
app.get('/api/v1/realtime/game-data/:stage?', (req, res) => {
  const stage = req.params.stage || 'h'; // Stage 4 defaults to stage H

  // Try gRPC streaming first for high-performance real-time data
  if (grpcClient.isClientConnected()) {
    console.log(`📡 Stage4: Starting gRPC game data stream for Stage ${stage.toUpperCase()}`);
    
    grpcClient.streamGameData(stage, null, (error, response) => {
      if (error) {
        console.error('❌ Stage4: gRPC stream error:', error);
        return res.status(500).json({
          success: false,
          error: 'gRPC stream failed',
          message: error.message,
          source: 'grpc',
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`📊 Stage4: gRPC real-time game data received:`, response);
      res.json({
        success: true,
        data: response.gameData,
        source: 'grpc_stream',
        stage: 'stage4',
        timestamp: new Date().toISOString()
      });
    });
    
    return;
  }

  // Fallback to WebSocket if gRPC not available
  if (!socketConnected) {
    return res.status(503).json({
      success: false,
      error: 'Real-time connection not available'
    });
  }

  requestRealtimeGameData(stage);

  res.json({
    success: true,
    message: `Requested real-time game data for Stage ${stage.toUpperCase()}`,
    timestamp: new Date().toISOString()
  });
});

// gRPC streaming endpoint for game data
app.get('/api/v1/grpc/game-data/:stage?', async (req, res) => {
  const stage = req.params.stage || 'h';

  if (!grpcClient.isClientConnected()) {
    return res.status(503).json({
      success: false,
      error: 'gRPC client not connected',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const result = await grpcClient.getGameData(stage);
    res.json({
      success: result.success,
      data: result.data,
      source: result.source,
      stage: 'stage4',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'gRPC request failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// gRPC bet placement endpoint
app.post('/api/v1/grpc/place-bet', async (req, res) => {
  try {
    const { playerId, stage, amount, boardSelection } = req.body;
    
    if (!playerId || !stage || !amount || !boardSelection) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: playerId, stage, amount, boardSelection',
        timestamp: new Date().toISOString()
      });
    }

    const result = await grpcClient.placeBet(playerId, stage, amount, boardSelection);
    
    res.json({
      success: result.success,
      betId: result.betId,
      playerId: result.playerId,
      amount: result.amount,
      status: result.status,
      source: result.source,
      stage: 'stage4',
      message: result.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'gRPC bet placement failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// gRPC status endpoint
app.get('/api/v1/grpc/status', async (req, res) => {
  try {
    const { detailed = false } = req.query;
    
    const result = await grpcClient.getStatus(detailed);
    
    res.json({
      success: result.success,
      status: result.status,
      source: result.source,
      stage: 'stage4',
      message: result.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'gRPC status check failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3002;

// Start server and check connections
server.listen(PORT, async () => {
  console.log(`🚀 Stage 4 Backend API is running on port ${PORT}`);
  console.log(`📋 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 Services Status: http://localhost:${PORT}/services`);
  console.log('---');

  // Check service connections on startup
  await checkServiceConnections();

  // Initialize Socket.IO connection to DB Manager
  initializeSocketConnection();

  // Check connections every 30 seconds
  setInterval(checkServiceConnections, 30000);

  // Request initial game data every 10 seconds
  setInterval(() => {
    requestRealtimeGameData('h'); // Stage 4 defaults to stage H
  }, 10000);
});

module.exports = { app, server, io };

// Helper function to create a new game when no existing DB data is available
async function createNewGameForStage(stage) {
  try {
    const timestamp = Date.now();
    const gameId = `G${timestamp.toString().slice(-5)}`;

    console.log(`🎮 Stage4: No existing game data found for Stage ${stage.toUpperCase()}`);

    // Return empty game state - no sample data
    return {
      gameId: gameId,
      payout: 0,
      players: '',
      boards: '',
      totalPlayers: 0,
      stage: stage.toUpperCase(),
      timestamp: new Date().toISOString(),
      message: 'No active game found. Please place bets to start a new game.'
    };
  } catch (error) {
    console.error('❌ Stage4: Error creating empty game response:', error.message);
    throw error;
  }
}