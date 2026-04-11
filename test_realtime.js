const io = require('socket.io-client');

// Test script for real-time connection between Stage4 and DB Manager
const testRealtimeConnection = () => {
  console.log('🧪 Testing real-time connection between Stage4 and DB Manager...');

  const DB_MANAGER_URL = process.env.DB_MANAGER_URL || 'http://localhost:3007';

  // Connect as a test client
  const socket = io(DB_MANAGER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 5000
  });

  socket.on('connect', () => {
    console.log('✅ Test client connected to DB Manager');

    // Test stage4 connection
    socket.emit('stage4-connect', {
      stage: 'test-stage4',
      timestamp: new Date().toISOString()
    });

    // Test game data request
    setTimeout(() => {
      console.log('📊 Requesting game data...');
      socket.emit('request-game-data', { stage: 'h' });
    }, 1000);

    // Test bet notification
    setTimeout(() => {
      console.log('🎯 Sending test bet notification...');
      socket.emit('bet-placed', {
        stage: 'H',
        gameId: 'TEST101112',
        boardNumber: 300,
        playerId: 'test-player-stage4',
        amount: 50,
        totalPlayers: 15,
        payout: 750
      });
    }, 2000);

    // Disconnect after tests
    setTimeout(() => {
      console.log('🔌 Disconnecting test client...');
      socket.disconnect();
      process.exit(0);
    }, 5000);
  });

  socket.on('db-manager-connected', (data) => {
    console.log('🎯 DB Manager acknowledged test connection:', data);
  });

  socket.on('game-data-update', (data) => {
    console.log('📊 Received game data update:', data);
  });

  socket.on('bet-update', (data) => {
    console.log('🎯 Received bet update:', data);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Test client disconnected');
  });
};

testRealtimeConnection();