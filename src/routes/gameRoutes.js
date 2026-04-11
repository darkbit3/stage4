const express = require('express');
const router = express.Router();

// Mock game data for Stage 4 (Number Calling)
let games = [
  {
    id: 1,
    name: 'Bingo Game 1',
    stage: 'Stage 4',
    status: 'calling',
    settings: {
      autoCallNumbers: true,
      callInterval: 5000,
      winPatterns: ['line', 'full_house', 'four_corners'],
      maxWinners: 3
    },
    currentNumber: null,
    calledNumbers: [],
    callHistory: [],
    startTime: new Date().toISOString(),
    lastCallTime: null
  }
];

// GET /api/games - Get all games
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: games,
    count: games.length,
    stage: 'Stage 4 - Number Calling'
  });
});

// GET /api/games/:id - Get specific game
router.get('/:id', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  res.json({
    success: true,
    data: game
  });
});

// POST /api/games/:id/call-number - Call a new number
router.post('/:id/call-number', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  if (game.status !== 'calling' && game.status !== 'active') {
    return res.status(400).json({
      success: false,
      error: 'Game is not in calling state'
    });
  }
  
  if (game.calledNumbers.length >= 75) {
    return res.status(400).json({
      success: false,
      error: 'All numbers have been called'
    });
  }
  
  // Generate a random number that hasn't been called
  let newNumber;
  do {
    newNumber = Math.floor(Math.random() * 75) + 1;
  } while (game.calledNumbers.includes(newNumber));
  
  // Determine the letter (BINGO)
  let letter;
  if (newNumber <= 15) letter = 'B';
  else if (newNumber <= 30) letter = 'I';
  else if (newNumber <= 45) letter = 'N';
  else if (newNumber <= 60) letter = 'G';
  else letter = 'O';
  
  game.currentNumber = newNumber;
  game.calledNumbers.push(newNumber);
  game.lastCallTime = new Date().toISOString();
  
  const callEntry = {
    number: newNumber,
    letter,
    calledAt: game.lastCallTime,
    callOrder: game.calledNumbers.length
  };
  
  game.callHistory.push(callEntry);
  
  res.json({
    success: true,
    data: callEntry,
    message: `Number ${letter}-${newNumber} called successfully`
  });
});

// GET /api/games/:id/current-number - Get current called number
router.get('/:id/current-number', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  res.json({
    success: true,
    data: {
      currentNumber: game.currentNumber,
      calledNumbers: game.calledNumbers,
      lastCallTime: game.lastCallTime,
      totalCalled: game.calledNumbers.length,
      remaining: 75 - game.calledNumbers.length
    }
  });
});

// GET /api/games/:id/call-history - Get call history
router.get('/:id/call-history', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  res.json({
    success: true,
    data: game.callHistory,
    count: game.callHistory.length
  });
});

// POST /api/games/:id/reset-calls - Reset called numbers
router.post('/:id/reset-calls', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  game.currentNumber = null;
  game.calledNumbers = [];
  game.callHistory = [];
  game.lastCallTime = null;
  
  res.json({
    success: true,
    data: game,
    message: 'Called numbers reset successfully'
  });
});

// POST /api/games/:id/auto-call - Toggle auto-calling
router.post('/:id/auto-call', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const { enabled, interval } = req.body;
  
  if (typeof enabled === 'boolean') {
    game.settings.autoCallNumbers = enabled;
  }
  
  if (interval && interval > 0) {
    game.settings.callInterval = interval;
  }
  
  res.json({
    success: true,
    data: {
      autoCallNumbers: game.settings.autoCallNumbers,
      callInterval: game.settings.callInterval
    },
    message: `Auto-calling ${enabled ? 'enabled' : 'disabled'}`
  });
});

// GET /api/games/:id/statistics - Get game statistics
router.get('/:id/statistics', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const stats = {
    gameId: game.id,
    gameName: game.name,
    totalNumbersCalled: game.calledNumbers.length,
    numbersRemaining: 75 - game.calledNumbers.length,
    averageCallInterval: game.callHistory.length > 1 ? 
      Math.floor((new Date(game.callHistory[game.callHistory.length - 1].calledAt) - 
                  new Date(game.callHistory[0].calledAt)) / game.callHistory.length / 1000) : 0,
    letterDistribution: {
      B: game.calledNumbers.filter(n => n <= 15).length,
      I: game.calledNumbers.filter(n => n > 15 && n <= 30).length,
      N: game.calledNumbers.filter(n => n > 30 && n <= 45).length,
      G: game.calledNumbers.filter(n => n > 45 && n <= 60).length,
      O: game.calledNumbers.filter(n => n > 60).length
    },
    gameDuration: game.startTime ? 
      Math.floor((new Date() - new Date(game.startTime)) / 1000) : null
  };
  
  res.json({
    success: true,
    data: stats
  });
});

module.exports = router;
